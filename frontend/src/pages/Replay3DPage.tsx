import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { replayApi } from '../features/replays/api'
import { minecraftAssetApi } from '../features/replays/minecraftAssets'
import { ReplayScene3D } from '../features/replays/ReplayScene3D'
import type {
  CameraMode,
  PlayerSample,
  ReplayEvent,
  ReplayPlayerFrame,
  WorldChunkData,
} from '../features/replays/types'
import {
  applyWorldAtTime,
  expandWorldChunkAnchors,
  expandWorldChunks,
  flattenEvents,
  worldEventRevision,
} from '../features/replays/voxel'
import '../styles/replay3d.css'

function formatDuration(value: number) {
  const total = Math.max(0, value)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = Math.floor(total % 1000)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function lerpAngle(a: number, b: number, amount: number) {
  const delta = ((b - a + 540) % 360) - 180
  return a + delta * amount
}

function interpolateTrack(track: PlayerSample[], time: number): ReplayPlayerFrame | null {
  if (track.length === 0) return null
  if (time <= track[0].t) return track[0]
  if (time >= track[track.length - 1].t) {
    const last = track[track.length - 1]
    return time - last.t <= 2500 || last.subject ? last : null
  }

  let low = 0
  let high = track.length - 1
  while (low + 1 < high) {
    const mid = (low + high) >> 1
    if (track[mid].t <= time) low = mid
    else high = mid
  }

  const before = track[low]
  const after = track[high]
  if (!before.subject && time - before.t > 2500 && after.t - time > 2500) return null
  const span = Math.max(1, after.t - before.t)
  const amount = clamp((time - before.t) / span, 0, 1)

  return {
    ...before,
    position: {
      x: before.position.x + (after.position.x - before.position.x) * amount,
      y: before.position.y + (after.position.y - before.position.y) * amount,
      z: before.position.z + (after.position.z - before.position.z) * amount,
    },
    rotation: {
      yaw: lerpAngle(before.rotation.yaw, after.rotation.yaw, amount),
      pitch: before.rotation.pitch + (after.rotation.pitch - before.rotation.pitch) * amount,
    },
    on_ground: amount < 0.5 ? before.on_ground : after.on_ground,
    sneaking: amount < 0.5 ? before.sneaking : after.sneaking,
    sprinting: amount < 0.5 ? before.sprinting : after.sprinting,
    held_item: amount < 0.5 ? before.held_item : after.held_item,
  }
}

function eventLabel(event: ReplayEvent & { t?: number }) {
  const detail = event.block ?? event.item ?? event.projectile ?? (event.enabled === undefined ? '' : event.enabled ? 'ON' : 'OFF')
  return detail ? `${event.type} · ${String(detail)}` : event.type
}

export function Replay3DPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow')
  const [showHitboxes, setShowHitboxes] = useState(true)
  const stageRef = useRef<HTMLDivElement>(null)

  const list = useQuery({
    queryKey: ['replays', '3d-library'],
    queryFn: () => replayApi.list(),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (selectedId !== null || !list.data?.replays.length) return
    setSelectedId(list.data.replays[0].id)
  }, [list.data, selectedId])

  const manifest = useQuery({
    queryKey: ['replay', selectedId, 'manifest'],
    queryFn: () => replayApi.manifest(selectedId as number),
    enabled: selectedId !== null,
  })

  const worldContext = manifest.data?.world_snapshot?.context
  const assetPackId = worldContext?.resource_pack_id || worldContext?.minecraft_version || null
  const assetPackQuery = useQuery({
    queryKey: ['minecraft-assets', assetPackId],
    queryFn: () => minecraftAssetApi.catalog(assetPackId as string),
    enabled: Boolean(assetPackId),
    staleTime: Infinity,
    retry: false,
  })

  const replayChunkQueries = useQueries({
    queries: (manifest.data?.chunks ?? []).map((chunk) => ({
      queryKey: ['replay', selectedId, 'chunk', chunk.seq],
      queryFn: () => replayApi.chunk(selectedId as number, chunk.seq),
      staleTime: Infinity,
      gcTime: 10 * 60_000,
    })),
  })

  const frames = useMemo(() => replayChunkQueries
    .flatMap((query) => query.data?.frames ?? [])
    .sort((a, b) => a.t - b.t), [replayChunkQueries])

  const tracks = useMemo(() => {
    const result = new Map<string, PlayerSample[]>()
    for (const frame of frames) {
      for (const player of frame.players) {
        const track = result.get(player.uuid) ?? []
        track.push({ ...player, t: frame.t })
        result.set(player.uuid, track)
      }
    }
    return result
  }, [frames])

  const players = useMemo(() => {
    const current: ReplayPlayerFrame[] = []
    for (const track of tracks.values()) {
      const player = interpolateTrack(track, playhead)
      if (player) current.push(player)
    }
    return current
  }, [tracks, playhead])

  const subject = players.find((player) => player.subject)
    ?? players.find((player) => player.uuid === manifest.data?.player_uuid)
    ?? null

  const origin = useMemo(() => {
    const subjectTrack = manifest.data ? tracks.get(manifest.data.player_uuid) : undefined
    const first = subjectTrack?.[0]
    if (!first) return { x: 0, y: 0, z: 0 }
    return {
      x: Math.floor(first.position.x),
      y: Math.floor(first.position.y),
      z: Math.floor(first.position.z),
    }
  }, [manifest.data, tracks])

  const duration = Math.max(
    manifest.data?.duration_ms ?? 0,
    manifest.data?.chunks.at(-1)?.end_ms ?? 0,
    frames.at(-1)?.t ?? 0,
  )

  useEffect(() => {
    setPlaying(false)
    setPlayhead(0)
  }, [selectedId])

  useEffect(() => {
    if (!playing || duration <= 0) return
    let frameId = 0
    let previous = performance.now()

    const tick = (now: number) => {
      const elapsed = now - previous
      previous = now
      setPlayhead((current) => {
        const next = current + elapsed * speed
        if (next >= duration) {
          queueMicrotask(() => setPlaying(false))
          return duration
        }
        return next
      })
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [playing, speed, duration])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      } else if (event.code === 'ArrowLeft') {
        setPlayhead((value) => clamp(value - 1000, 0, duration))
      } else if (event.code === 'ArrowRight') {
        setPlayhead((value) => clamp(value + 1000, 0, duration))
      } else if (event.key === '1') setCameraMode('free')
      else if (event.key === '2') setCameraMode('follow')
      else if (event.key === '3') setCameraMode('pov')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [duration])

  const visibleWorldChunks = useMemo(() => {
    const all = manifest.data?.world_snapshot?.chunks ?? []
    if (all.length === 0) return []
    if (!subject) return all.slice(0, 25)

    const centerX = Math.floor(subject.position.x / 16)
    const centerZ = Math.floor(subject.position.z / 16)
    const sameWorld = all.filter((chunk) => chunk.world === subject.world)
    const nearby = sameWorld
      .filter((chunk) => Math.abs(chunk.chunk_x - centerX) <= 2 && Math.abs(chunk.chunk_z - centerZ) <= 2)
      .sort((a, b) => {
        const ad = Math.abs(a.chunk_x - centerX) + Math.abs(a.chunk_z - centerZ)
        const bd = Math.abs(b.chunk_x - centerX) + Math.abs(b.chunk_z - centerZ)
        return ad - bd
      })
    return nearby.slice(0, 25)
  }, [manifest.data, subject?.world, subject?.position.x, subject?.position.z])

  const worldChunkQueries = useQueries({
    queries: visibleWorldChunks.map((chunk) => ({
      queryKey: ['replay', selectedId, 'world', chunk.world, chunk.chunk_x, chunk.chunk_z],
      queryFn: () => replayApi.worldChunk(selectedId as number, chunk.chunk_x, chunk.chunk_z, chunk.world),
      staleTime: Infinity,
      gcTime: 20 * 60_000,
    })),
  })

  const loadedWorldChunks = useMemo(() => worldChunkQueries
    .map((query) => query.data)
    .filter((chunk): chunk is WorldChunkData => Boolean(chunk)), [worldChunkQueries])

  const baseWorld = useMemo(() => expandWorldChunks(loadedWorldChunks), [loadedWorldChunks])
  const worldAnchors = useMemo(() => expandWorldChunkAnchors(loadedWorldChunks), [loadedWorldChunks])
  const events = useMemo(() => flattenEvents(frames), [frames])
  const anchor = manifest.data?.world_snapshot?.anchor_ms ?? manifest.data?.trigger_offset_ms ?? 0
  const revision = worldEventRevision(events, playhead, anchor, worldAnchors)
  // The map only changes when a block event boundary is crossed. Omitting playhead
  // from the dependency list avoids rebuilding voxel geometry every animation frame.
  const world = useMemo(
    () => applyWorldAtTime(baseWorld, events, playhead, anchor, worldAnchors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseWorld, events, anchor, worldAnchors, revision],
  )

  const currentEvents = useMemo(() => events.filter((event) => Math.abs(event.t - playhead) <= 650).slice(-12), [events, playhead])
  const triggerOffset = manifest.data?.trigger_offset_ms ?? 0
  const triggerPercent = duration > 0 ? clamp((triggerOffset / duration) * 100, 0, 100) : 0
  const allReplayChunksLoaded = replayChunkQueries.length > 0 && replayChunkQueries.every((query) => query.isSuccess)
  const worldLoading = worldChunkQueries.some((query) => query.isLoading)
  const assetPack = assetPackQuery.data && assetPackId
    ? { id: assetPackId, catalog: assetPackQuery.data.catalog }
    : null

  async function fullscreen() {
    if (!stageRef.current) return
    if (document.fullscreenElement === stageRef.current) await document.exitFullscreen()
    else await stageRef.current.requestFullscreen()
  }

  return (
    <div className="replay3d-page">
      <header className="page-heading replay3d-heading">
        <div>
          <span className="page-heading__section">Operations / Replays / 3D</span>
          <h1>Replay investigation</h1>
          <p>Recorded Minecraft chunks, block states, players and evidence reconstructed as a navigable 3D scene.</p>
        </div>
        <div className="replay3d-shortcuts"><span>SPACE play</span><span>← → seek</span><span>1 / 2 / 3 camera</span></div>
      </header>

      <section className="replay3d-workbench">
        <aside className="replay3d-library">
          <div className="replay3d-panel-title"><span>Replay library</span><small>{list.data?.total ?? 0} captured</small></div>
          <div className="replay3d-library-list">
            {list.isLoading && <div className="replay3d-message">Loading replay index…</div>}
            {list.isError && <div className="replay3d-message replay3d-message--error">Replay index unavailable.</div>}
            {list.data?.replays.map((replay) => (
              <button
                type="button"
                key={replay.id}
                className={`replay3d-library-item${selectedId === replay.id ? ' replay3d-library-item--active' : ''}`}
                onClick={() => setSelectedId(replay.id)}
              >
                <span className="replay3d-library-id">#{replay.id}</span>
                <strong>{replay.player_name}</strong>
                <small>{replay.server_name} · {replay.trigger_type}</small>
                <time>{new Date(replay.started_at).toLocaleString()}</time>
              </button>
            ))}
          </div>
        </aside>

        <div className="replay3d-center">
          <div className="replay3d-stage" ref={stageRef}>
            {manifest.isLoading && <div className="replay3d-stage-overlay">Loading replay manifest…</div>}
            {manifest.isError && <div className="replay3d-stage-overlay replay3d-stage-overlay--error">Replay could not be loaded.</div>}
            {manifest.data && (
              <>
                <ReplayScene3D
                  world={world}
                  players={players}
                  subject={subject}
                  origin={origin}
                  cameraMode={cameraMode}
                  showHitboxes={showHitboxes}
                  assetPack={assetPack}
                  worldContext={worldContext}
                />
                <div className="replay3d-hud replay3d-hud--top">
                  <span>REPLAY #{manifest.data.id}</span>
                  <span>{manifest.data.server_name}</span>
                  <span>{assetPack ? `RESOURCE ${assetPack.id}` : 'PROCEDURAL FALLBACK'}</span>
                  <span>{subject ? `${subject.position.x.toFixed(2)} ${subject.position.y.toFixed(2)} ${subject.position.z.toFixed(2)}` : 'waiting for frames'}</span>
                </div>
                <div className="replay3d-hud replay3d-hud--bottom">
                  <span>{manifest.data.world_snapshot?.available ? `${loadedWorldChunks.length}/${visibleWorldChunks.length} local chunk keyframes` : 'world snapshot unavailable'}</span>
                  {worldLoading && <span>streaming world…</span>}
                  <span>{world.size.toLocaleString()} recorded blocks</span>
                </div>
                {assetPackId && assetPackQuery.isError && (
                  <div className="replay3d-asset-warning">
                    Render pack <strong>{assetPackId}</strong> is not installed. The scene is using the diagnostic fallback renderer.
                  </div>
                )}
              </>
            )}
          </div>

          <div className="replay3d-controls">
            <button type="button" onClick={() => setPlaying((value) => !value)} disabled={!manifest.data}>{playing ? '❚❚' : '▶'}</button>
            <span className="replay3d-time">{formatDuration(playhead)}</span>
            <div className="replay3d-timeline-wrap">
              <input
                aria-label="Replay timeline"
                type="range"
                min={0}
                max={Math.max(1, duration)}
                step={10}
                value={clamp(playhead, 0, Math.max(1, duration))}
                onChange={(event) => {
                  setPlaying(false)
                  setPlayhead(Number(event.target.value))
                }}
              />
              <button
                className="replay3d-trigger-marker"
                style={{ left: `${triggerPercent}%` }}
                title={`Jump to trigger at ${formatDuration(triggerOffset)}`}
                type="button"
                onClick={() => setPlayhead(triggerOffset)}
              />
            </div>
            <span className="replay3d-time">{formatDuration(duration)}</span>
            <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Playback speed">
              <option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
            </select>
          </div>
        </div>

        <aside className="replay3d-inspector">
          <div className="replay3d-panel-title"><span>Investigation</span><small>{allReplayChunksLoaded ? 'timeline ready' : 'loading timeline'}</small></div>

          <section className="replay3d-inspector-section">
            <label>Camera</label>
            <div className="replay3d-segmented">
              {(['free', 'follow', 'pov'] as CameraMode[]).map((mode) => (
                <button type="button" key={mode} onClick={() => setCameraMode(mode)} className={cameraMode === mode ? 'active' : ''}>{mode}</button>
              ))}
            </div>
            <div className="replay3d-toggle-row"><span>Hitboxes</span><button type="button" className={showHitboxes ? 'active' : ''} onClick={() => setShowHitboxes((value) => !value)}>{showHitboxes ? 'ON' : 'OFF'}</button></div>
            <button className="replay3d-wide-button" type="button" onClick={fullscreen}>Fullscreen scene</button>
          </section>

          <section className="replay3d-inspector-section">
            <label>Subject</label>
            <strong>{manifest.data?.player_name ?? '—'}</strong>
            <dl>
              <div><dt>Yaw</dt><dd>{subject ? `${subject.rotation.yaw.toFixed(1)}°` : '—'}</dd></div>
              <div><dt>Pitch</dt><dd>{subject ? `${subject.rotation.pitch.toFixed(1)}°` : '—'}</dd></div>
              <div><dt>Ground</dt><dd>{subject?.on_ground === undefined ? '—' : subject.on_ground ? 'yes' : 'no'}</dd></div>
              <div><dt>Pose</dt><dd>{subject?.sneaking ? 'sneaking' : subject?.sprinting ? 'sprinting' : 'standing'}</dd></div>
              <div><dt>Held</dt><dd>{subject?.held_item ?? '—'}</dd></div>
            </dl>
          </section>

          <section className="replay3d-inspector-section replay3d-event-section">
            <label>Events near playhead</label>
            {currentEvents.length === 0 && <div className="replay3d-no-events">No recorded event in ±650 ms.</div>}
            {currentEvents.map((event, index) => (
              <button type="button" className="replay3d-event" key={`${event.t}-${event.type}-${index}`} onClick={() => setPlayhead(event.t)}>
                <time>{formatDuration(event.t)}</time>
                <span>{eventLabel(event)}</span>
              </button>
            ))}
          </section>

          <section className="replay3d-inspector-section replay3d-meta">
            <label>Capture</label>
            <dl>
              <div><dt>Trigger</dt><dd>{formatDuration(triggerOffset)}</dd></div>
              <div><dt>Frames</dt><dd>{frames.length.toLocaleString()}</dd></div>
              <div><dt>Players</dt><dd>{tracks.size}</dd></div>
              <div><dt>Minecraft</dt><dd>{worldContext?.minecraft_version ?? 'unknown'}</dd></div>
              <div><dt>Dimension</dt><dd>{worldContext?.environment ?? 'unknown'}</dd></div>
              <div><dt>Render pack</dt><dd>{assetPack ? assetPack.id : assetPackId ? `${assetPackId} missing` : 'not recorded'}</dd></div>
              <div><dt>Replay data</dt><dd>{formatBytes(manifest.data?.size_bytes ?? 0)}</dd></div>
              <div><dt>World data</dt><dd>{formatBytes(manifest.data?.world_snapshot?.size_bytes ?? 0)}</dd></div>
            </dl>
            {manifest.data?.world_snapshot?.anchor_precision === 'exact_per_chunk' ? (
              <p>Each captured chunk is a complete block-state keyframe with its own exact replay timestamp.</p>
            ) : manifest.data?.world_snapshot?.anchor_precision === 'trigger_estimate' ? (
              <p>This older replay has no per-chunk capture timestamps; trigger time is used as the world-keyframe estimate.</p>
            ) : null}
            {assetPackId && assetPackQuery.isError && (
              <p>Install the matching local client/resource pack with <code>php artisan hg:assets:import … --id={assetPackId}</code> for Minecraft-faithful block models and textures.</p>
            )}
          </section>
        </aside>
      </section>
    </div>
  )
}
