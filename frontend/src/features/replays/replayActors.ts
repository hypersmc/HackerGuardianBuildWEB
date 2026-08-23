import type { PlayerSample, ReplayFrame, ReplayPlayerFrame } from './types'

export type SampledReplayActor = ReplayPlayerFrame & {
  sample_time_ms: number
  horizontal_speed: number
  vertical_speed: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function lerpAngle(a: number, b: number, amount: number) {
  const delta = ((b - a + 540) % 360) - 180
  return a + delta * amount
}

function copySample(sample: PlayerSample): SampledReplayActor {
  return {
    ...sample,
    position: { ...sample.position },
    rotation: { ...sample.rotation },
    sample_time_ms: sample.t,
    horizontal_speed: 0,
    vertical_speed: 0,
  }
}

/**
 * Builds immutable per-player tracks once after the replay timeline is loaded.
 * The render loop samples these tracks directly; React does not create a new actor
 * object for every screen refresh anymore.
 */
export function buildPlayerTracks(frames: ReplayFrame[]) {
  const tracks = new Map<string, PlayerSample[]>()
  for (const frame of frames) {
    for (const player of frame.players) {
      const track = tracks.get(player.uuid) ?? []
      track.push({ ...player, t: frame.t })
      tracks.set(player.uuid, track)
    }
  }
  return tracks
}

/**
 * Evidence-preserving interpolation between recorded snapshots.
 *
 * Position remains on the straight segment between the two recorded samples and
 * yaw uses shortest-path angle interpolation. Large discontinuities/world changes
 * are treated as teleports and are never visually swept across the world.
 */
export function samplePlayerTrack(track: PlayerSample[] | undefined, timeMs: number): SampledReplayActor | null {
  if (!track?.length) return null
  if (timeMs <= track[0].t) return copySample(track[0])

  const last = track[track.length - 1]
  if (timeMs >= last.t) {
    if (!last.subject && timeMs - last.t > 2500) return null
    return copySample(last)
  }

  let low = 0
  let high = track.length - 1
  while (low + 1 < high) {
    const mid = (low + high) >> 1
    if (track[mid].t <= timeMs) low = mid
    else high = mid
  }

  const before = track[low]
  const after = track[high]
  if (!before.subject && timeMs - before.t > 2500 && after.t - timeMs > 2500) return null

  const spanMs = Math.max(1, after.t - before.t)
  const dx = after.position.x - before.position.x
  const dy = after.position.y - before.position.y
  const dz = after.position.z - before.position.z
  const distanceSq = dx * dx + dy * dy + dz * dz

  // A replay may contain a teleport/world transfer. Interpolating through the
  // intervening blocks would fabricate movement that never happened.
  if (before.world !== after.world || distanceSq > 16 * 16) {
    return copySample(timeMs - before.t < after.t - timeMs ? before : after)
  }

  const amount = clamp((timeMs - before.t) / spanMs, 0, 1)
  const seconds = spanMs / 1000
  const discrete = amount >= 1 ? after : before

  return {
    ...before,
    position: {
      x: before.position.x + dx * amount,
      y: before.position.y + dy * amount,
      z: before.position.z + dz * amount,
    },
    rotation: {
      yaw: lerpAngle(before.rotation.yaw, after.rotation.yaw, amount),
      pitch: before.rotation.pitch + (after.rotation.pitch - before.rotation.pitch) * amount,
    },
    // Discrete evidence must not change halfway between samples. Keep the previous
    // recorded state until the next sample timestamp is actually reached.
    on_ground: discrete.on_ground,
    sneaking: discrete.sneaking,
    sprinting: discrete.sprinting,
    held_item: discrete.held_item,
    sample_time_ms: timeMs,
    horizontal_speed: Math.hypot(dx, dz) / seconds,
    vertical_speed: dy / seconds,
  }
}

export function findSubjectTrack(tracks: ReadonlyMap<string, PlayerSample[]>, subjectUuid?: string | null) {
  if (subjectUuid) {
    const exact = tracks.get(subjectUuid)
    if (exact?.length) return exact
  }
  for (const track of tracks.values()) {
    if (track.some((sample) => sample.subject)) return track
  }
  return undefined
}

export function latestEventProgress(eventTimes: number[], timeMs: number, durationMs: number) {
  if (!eventTimes.length || durationMs <= 0) return 0
  let low = 0
  let high = eventTimes.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (eventTimes[mid] <= timeMs) low = mid + 1
    else high = mid
  }
  const index = low - 1
  if (index < 0) return 0
  const age = timeMs - eventTimes[index]
  if (age < 0 || age > durationMs) return 0
  return clamp(age / durationMs, 0, 1)
}
