import { useSyncExternalStore } from 'react'

export type ReplayClockSnapshot = {
  timeMs: number
  durationMs: number
  playing: boolean
  speed: number
}

const UI_PUBLISH_INTERVAL_MS = 50
const MAX_ADVANCE_PER_FRAME_MS = 100

/**
 * Render-loop-owned replay clock.
 *
 * The WebGPU scene advances this clock directly from useFrame(). React subscribes
 * to a throttled snapshot for controls/labels only, so the page no longer needs to
 * rerender at monitor refresh rate just to move actors and cameras.
 */
export class ReplayPlaybackClock {
  private timeMs = 0
  private durationMs = 0
  private playing = false
  private speed = 1
  private uiAccumulatorMs = 0
  private listeners = new Set<() => void>()
  private snapshot: ReplayClockSnapshot = {
    timeMs: 0,
    durationMs: 0,
    playing: false,
    speed: 1,
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  getTimeMs() {
    return this.timeMs
  }

  getDurationMs() {
    return this.durationMs
  }

  isPlaying() {
    return this.playing
  }

  reset(durationMs = 0) {
    this.timeMs = 0
    this.durationMs = Math.max(0, durationMs)
    this.playing = false
    this.speed = 1
    this.uiAccumulatorMs = 0
    this.publish()
  }

  setDuration(durationMs: number) {
    const next = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0)
    if (next === this.durationMs) return
    this.durationMs = next
    if (this.timeMs > next) this.timeMs = next
    if (next <= 0) this.playing = false
    this.publish()
  }

  setPlaying(playing: boolean) {
    const next = Boolean(playing && this.durationMs > 0 && this.timeMs < this.durationMs)
    if (next === this.playing) return
    this.playing = next
    this.uiAccumulatorMs = 0
    this.publish()
  }

  toggle() {
    if (this.timeMs >= this.durationMs && this.durationMs > 0) this.timeMs = 0
    this.setPlaying(!this.playing)
  }

  setSpeed(speed: number) {
    const next = Math.min(8, Math.max(0.05, Number.isFinite(speed) ? speed : 1))
    if (next === this.speed) return
    this.speed = next
    this.publish()
  }

  seek(timeMs: number) {
    const next = Math.min(this.durationMs, Math.max(0, Number.isFinite(timeMs) ? timeMs : 0))
    if (next === this.timeMs) return
    this.timeMs = next
    if (this.timeMs >= this.durationMs) this.playing = false
    this.uiAccumulatorMs = 0
    this.publish()
  }

  step(deltaMs: number) {
    this.seek(this.timeMs + deltaMs)
  }

  /** Called once per WebGPU/R3F frame. */
  advance(realDeltaMs: number) {
    if (!this.playing || this.durationMs <= 0) return

    // Evidence playback must never jump forward by the full length of a browser or
    // GPU stall. If a frame is late, slow the replay rather than silently skipping
    // recorded movement/evidence.
    const boundedRealDelta = Math.min(
      MAX_ADVANCE_PER_FRAME_MS,
      Math.max(0, Number.isFinite(realDeltaMs) ? realDeltaMs : 0),
    )

    this.timeMs = Math.min(this.durationMs, this.timeMs + boundedRealDelta * this.speed)
    this.uiAccumulatorMs += boundedRealDelta

    if (this.timeMs >= this.durationMs) {
      this.playing = false
      this.publish()
      return
    }

    if (this.uiAccumulatorMs >= UI_PUBLISH_INTERVAL_MS) {
      this.uiAccumulatorMs %= UI_PUBLISH_INTERVAL_MS
      this.publish()
    }
  }

  private publish() {
    this.snapshot = {
      timeMs: this.timeMs,
      durationMs: this.durationMs,
      playing: this.playing,
      speed: this.speed,
    }
    for (const listener of this.listeners) listener()
  }
}

export function useReplayClock(clock: ReplayPlaybackClock) {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
}
