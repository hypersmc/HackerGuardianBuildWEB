import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { replayApi } from '../features/replays/api'
import { minecraftAssetApi, type MinecraftAssetManifest } from '../features/replays/minecraftAssets'
import { ReplayScene3D } from '../features/replays/ReplayScene3D'
import { buildPlayerTracks, findSubjectTrack, samplePlayerTrack } from '../features/replays/replayActors'
import { ReplayPlaybackClock, useReplayClock } from '../features/replays/replayClock'
import { collectReplayTextureAssets, loadReplayTextures } from '../features/replays/replayPreload'
import {
  collectRecordedBlockStates,
  countRecordedBlocks,
  decodeReplayWorldSections,
  indexBlockEventsBySection,
} from '../features/replays/replaySections'
import type {
  CameraMode,
  ReplayEvent,
  WorldChunkData,
} from '../features/replays/types'
import { flattenEvents } from '../features/replays/voxel'
import '../styles/replay3d.css'
import '../styles/replay-preload.css'

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

function eventLabel(event: ReplayEvent & { t?: number }) {
  const detail = event.block ?? event.item ?? event.projectile ?? (event.enabled === undefined ? '' : event.enabled ? 'ON' : 'OFF')
  return detail ? `${event.type} · ${String(detail)}` : event.type
}

type GateState = 'waiting' | 'loading' | 'ready' | 'degraded' | 'error'
type GateRow = { label: string; state: GateState; detail: string }
type PackSource = 'recorded' | 'manual' | 'inferred' | 'none'

function ReplayLoadGate({
  rows,
  progress,
  packId,
  recordedPackId,
  packs,
  onPackSelect,
}: {
  rows: GateRow[]
  progress: number
  packId: string | null
  recordedPackId: string | null
  packs: MinecraftAssetManifest[]
  onPackSelect: (id: string | null) => void
}) {
  const failed = rows.some((row) => row.state === 'error')
  const canChooseLegacyPack = !recordedPackId && packs.length > 0

  return (
    <div className={`replay-preload${failed ? ' replay-preload--error' : ''}`}>
      <div className="replay-preload__card">
        <div className="replay-preload__eyebrow">{failed ? 'REPLAY BLOCKED' : 'PREPARING REPLAY'}</div>
        <h2>{failed ? 'Required replay data is unavailable' : 'Loading complete replay state'}</h2>
        <p>
          {failed
            ? 'Playback stays locked until every required component is available.'
            : 'Timeline, full recorded chunk keyframes, render assets, actor tracks and the first GPU frame must all be ready before playback unlocks.'}
        </p>
        <div className="replay-preload__progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="replay-preload__rows">
          {rows.map((row) => (
            <div className="replay-preload__row" key={row.label}>
              <span>{row.label}</span>
              <strong className={`replay-preload__state replay-preload__state--${row.state}`}>{row.state}</strong>
              <small>{row.detail}</small>
            </div>
          ))}
        </div>
        {canChooseLegacyPack && (
          <div className="replay-preload__pack-picker">
            <label htmlFor="legacy-replay-pack">Legacy replay render pack</label>
            <select
              id="legacy-replay-pack"
              value={packId ?? ''}
              onChange={(event) => onPackSelect(event.target.value || null)}
            >
              <option value="">Select imported Minecraft assets…</option>
              {packs.map((pack) => (
                <option key={pack.id} value={pack.id}>{pack.id} · Minecraft {pack.version}</option>
              ))}
            </select>
            <small>This replay did not record a Minecraft/render-pack id. Choosing one here is an explicit render-only override and does not alter replay evidence.</small>
          </div>
        )}
        {failed && packId && rows.some((row) => row.label === 'Render pack' && row.state === 'error') && (
          <code>php artisan hg:assets:import &lt;minecraft-client.jar&gt; --id={packId} --minecraft-version={packId}</code>
        )}
      </div>
    </div>
  )
}

export function Replay3DPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [manualPackId, setManualPackId] = useState<string | null>(null)
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow')
  const [showHitboxes, setShowHitboxes] = useState(true)
  const [sceneReady, setSceneReady] = useState(false)
  const [textureProgress, setTextureProgress] = useState({ loaded: 0, total: 0 })
  const stageRef = useRef<HTMLDivElement>(null)

  // One clock per selected replay. The WebGPU scene owns advancement; React only
  // observes a throttled 20 Hz UI snapshot for controls and inspector text.
  const clock = useMemo(() => new ReplayPlaybackClock(), [selectedId])
  const playback = useReplayClock(clock)
  const playhead = playback.timeMs

  const list = useQuery({
    queryKey: ['replays', '3d-library'],
    queryFn: () => replayApi.list(),
    refetchInterval: 30_000,
  })

  const assetPacksQuery = useQuery({
    queryKey: ['minecraft-assets', 'packs'],
    queryFn: () => minecraftAssetApi.list(),
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => {
    if (selectedId !== null || !list.data?.replays.length) return
    setSelectedId(list.data.replays[0].id)
  }, [list.data, selectedId])

  useEffect(() => {
    setManualPackId(null)
    if (selectedId === null) return
    const stored = window.localStorage.getItem(`hg.replay.render-pack.${selectedId}`)
    if (stored) setManualPackId(stored)
  }, [selectedId])

  const manifest = useQuery({
    queryKey: ['replay', selectedId, 'manifest'],
    queryFn: () => replayApi.manifest(selectedId as number),
    enabled: selectedId !== null,
  })

  const worldContext = manifest.data?.world_snapshot?.context
  const recordedPackId = worldContext?.resource_pack_id || worldContext?.minecraft_version || null
  const installedPacks = assetPacksQuery.data?.packs ?? []
  const inferredPackId = !recordedPackId && !manualPackId && assetPacksQuery.isSuccess && installedPacks.length === 1
    ? installedPacks[0].id
    : null
  const assetPackId = manualPackId || recordedPackId || inferredPackId
  const packSource: PackSource = manualPackId
    ? 'manual'
    : recordedPackId
      ? 'recorded'
      : inferredPackId
        ? 'inferred'
        : 'none'

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
      gcTime: 30 * 60_000,
      retry: 2,
    })),
  })

  const worldChunkMetas = manifest.data?.world_snapshot?.chunks ?? []
  const worldChunkQueries = useQueries({
    queries: worldChunkMetas.map((chunk) => ({
      queryKey: ['replay', selectedId, 'world', chunk.world, chunk.chunk_x, chunk.chunk_z],
      queryFn: () => replayApi.worldChunk(selectedId as number, chunk.chunk_x, chunk.chunk_z, chunk.world),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: 2,
    })),
  })

  const frames = useMemo(() => replayChunkQueries
    .flatMap((query) => query.data?.frames ?? [])
    .sort((a, b) => a.t - b.t), [replayChunkQueries])

  const loadedWorldChunks = useMemo(() => worldChunkQueries
    .map((query) => query.data)
    .filter((chunk): chunk is WorldChunkData => Boolean(chunk)), [worldChunkQueries])

  const events = useMemo(() => flattenEvents(frames), [frames])

  const replayChunksTotal = manifest.data?.chunks.length ?? 0
  const replayChunksLoaded = replayChunkQueries.filter((query) => query.isSuccess).length
  const replayChunksFailed = replayChunkQueries.some((query) => query.isError)
  const replayManifestInvalid = manifest.isSuccess && replayChunksTotal === 0
  const allReplayChunksLoaded = manifest.isSuccess
    && replayChunksTotal > 0
    && replayChunksLoaded === replayChunksTotal
    && !replayChunksFailed

  const worldSnapshotAvailable = Boolean(manifest.data?.world_snapshot?.available)
  const worldChunksTotal = worldChunkMetas.length
  const worldChunksLoaded = worldChunkQueries.filter((query) => query.isSuccess).length
  const worldChunksFailed = worldChunkQueries.some((query) => query.isError)
  const worldManifestInvalid = manifest.isSuccess && worldSnapshotAvailable && worldChunksTotal === 0
  const allWorldChunksLoaded = manifest.isSuccess && (
    !worldSnapshotAvailable
    || (worldChunksTotal > 0 && worldChunksLoaded === worldChunksTotal && !worldChunksFailed)
  )

  const worldSections = useMemo(
    () => allWorldChunksLoaded ? decodeReplayWorldSections(loadedWorldChunks) : [],
    [allWorldChunksLoaded, loadedWorldChunks],
  )
  const defaultWorld = manifest.data?.world?.name || worldContext?.world || loadedWorldChunks[0]?.world || 'world'
  const eventsBySection = useMemo(
    () => indexBlockEventsBySection(events, defaultWorld),
    [events, defaultWorld],
  )

  const replayBlockStates = useMemo(() => {
    if (!allWorldChunksLoaded) return new Set<string>()
    const states = collectRecordedBlockStates(loadedWorldChunks)
    for (const event of events) {
      if (typeof event.block === 'string') states.add(event.block)
      if (typeof event.previous_block === 'string') states.add(event.previous_block)
    }
    return states
  }, [allWorldChunksLoaded, loadedWorldChunks, events])

  const recordedBlockCount = useMemo(
    () => allWorldChunksLoaded ? countRecordedBlocks(loadedWorldChunks) : 0,
    [allWorldChunksLoaded, loadedWorldChunks],
  )

  const requiredTextureAssets = useMemo(() => {
    if (!assetPackQuery.data || !allReplayChunksLoaded || !allWorldChunksLoaded) return []
    return collectReplayTextureAssets(replayBlockStates, assetPackQuery.data.catalog)
  }, [assetPackQuery.data, allReplayChunksLoaded, allWorldChunksLoaded, replayBlockStates])

  const textureQuery = useQuery({
    queryKey: ['minecraft-assets', assetPackId, 'replay-textures', requiredTextureAssets],
    queryFn: () => loadReplayTextures(
      assetPackId as string,
      requiredTextureAssets,
      setTextureProgress,
    ),
    enabled: Boolean(assetPackId && assetPackQuery.isSuccess && allReplayChunksLoaded && allWorldChunksLoaded),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  })

  const tracks = useMemo(() => buildPlayerTracks(frames), [frames])
  const subjectTrack = findSubjectTrack(tracks, manifest.data?.player_uuid)
  const subject = samplePlayerTrack(subjectTrack, playhead)
  const armSwingTimes = useMemo(
    () => events.filter((event) => event.type === 'ARM_SWING').map((event) => event.t),
    [events],
  )

  const origin = useMemo(() => {
    const first = findSubjectTrack(tracks, manifest.data?.player_uuid)?.[0]
    if (!first) return { x: 0, y: 0, z: 0 }
    return {
      x: Math.floor(first.position.x),
      y: Math.floor(first.position.y),
      z: Math.floor(first.position.z),
    }
  }, [manifest.data?.player_uuid, tracks])

  const duration = Math.max(
    manifest.data?.duration_ms ?? 0,
    manifest.data?.chunks.at(-1)?.end_ms ?? 0,
    frames.at(-1)?.t ?? 0,
  )

  useEffect(() => {
    clock.setDuration(duration)
  }, [clock, duration])

  const packChoiceRequired = Boolean(
    manifest.isSuccess
    && worldSnapshotAvailable
    && !recordedPackId
    && assetPacksQuery.isSuccess
    && installedPacks.length > 1
    && !manualPackId,
  )
  const noRenderPackAvailable = assetPacksQuery.isSuccess && installedPacks.length === 0
  const packDiscoveryReady = Boolean(recordedPackId) || assetPacksQuery.isSuccess
  const assetReady = packDiscoveryReady
    && !packChoiceRequired
    && (assetPackId ? assetPackQuery.isSuccess && textureQuery.isSuccess : noRenderPackAvailable || !worldSnapshotAvailable)
  const dataReady = manifest.isSuccess && allReplayChunksLoaded && allWorldChunksLoaded && assetReady
  const canStart = dataReady && sceneReady
  const assetPack = useMemo(() => (
    assetPackQuery.data && assetPackId && textureQuery.data
      ? { id: assetPackId, catalog: assetPackQuery.data.catalog, textures: textureQuery.data }
      : null
  ), [assetPackQuery.data, assetPackId, textureQuery.data])
  const sceneToken = `${selectedId ?? 'none'}:${assetPackId ?? 'fallback'}:${frames.length}:${worldSections.length}:${requiredTextureAssets.length}`

  const currentEvents = useMemo(() => events.filter((event) => Math.abs(event.t - playhead) <= 650).slice(-12), [events, playhead])
  const triggerOffset = manifest.data?.trigger_offset_ms ?? 0
  const triggerPercent = duration > 0 ? clamp((triggerOffset / duration) * 100, 0, 100) : 0
  const texturesLoaded = textureQuery.isSuccess ? requiredTextureAssets.length : textureProgress.loaded

  const renderPackRow: GateRow = !manifest.isSuccess
    ? { label: 'Render pack', state: 'waiting', detail: 'waiting for replay metadata' }
    : !worldSnapshotAvailable
      ? { label: 'Render pack', state: 'degraded', detail: 'world snapshot not recorded' }
      : assetPacksQuery.isError && !recordedPackId
        ? { label: 'Render pack', state: 'error', detail: 'could not read locally imported render packs' }
        : packChoiceRequired
          ? { label: 'Render pack', state: 'waiting', detail: `legacy replay; choose one of ${installedPacks.length} imported packs` }
          : !assetPackId
            ? assetPacksQuery.isLoading
              ? { label: 'Render pack', state: 'loading', detail: 'checking locally imported Minecraft assets' }
              : { label: 'Render pack', state: 'degraded', detail: 'no imported render pack is available' }
            : assetPackQuery.isError
              ? { label: 'Render pack', state: 'error', detail: `${assetPackId} is not installed` }
              : assetPackQuery.isSuccess
                ? { label: 'Render pack', state: packSource === 'inferred' ? 'degraded' : 'ready', detail: `${assetPackId} · ${packSource}` }
                : { label: 'Render pack', state: 'loading', detail: `loading ${assetPackId}` }

  const textureRow: GateRow = !worldSnapshotAvailable
    ? { label: 'Textures', state: 'degraded', detail: 'no world geometry to texture' }
    : packChoiceRequired
      ? { label: 'Textures', state: 'waiting', detail: 'waiting for render-pack selection' }
      : !assetPackId
        ? { label: 'Textures', state: noRenderPackAvailable ? 'degraded' : 'waiting', detail: noRenderPackAvailable ? 'diagnostic renderer only' : 'waiting for render pack' }
        : textureQuery.isError
          ? { label: 'Textures', state: 'error', detail: 'one or more replay textures failed to decode' }
          : textureQuery.isSuccess
            ? { label: 'Textures', state: 'ready', detail: `${requiredTextureAssets.length}/${requiredTextureAssets.length} decoded` }
            : assetPackQuery.isSuccess
              ? { label: 'Textures', state: 'loading', detail: `${texturesLoaded}/${requiredTextureAssets.length} decoded` }
              : { label: 'Textures', state: 'waiting', detail: 'waiting for render pack' }

  const preloadRows: GateRow[] = [
    {
      label: 'Manifest',
      state: manifest.isError ? 'error' : manifest.isSuccess ? 'ready' : 'loading',
      detail: manifest.isSuccess ? `replay #${manifest.data.id}` : manifest.isError ? 'manifest request failed' : 'loading replay definition',
    },
    {
      label: 'Timeline',
      state: replayManifestInvalid || replayChunksFailed ? 'error' : allReplayChunksLoaded ? 'ready' : manifest.isSuccess ? 'loading' : 'waiting',
      detail: replayManifestInvalid ? 'replay contains no timeline chunks' : `${replayChunksLoaded}/${replayChunksTotal} chunks`,
    },
    {
      label: 'World keyframes',
      state: worldManifestInvalid || worldChunksFailed ? 'error' : !worldSnapshotAvailable && manifest.isSuccess ? 'degraded' : allWorldChunksLoaded ? 'ready' : manifest.isSuccess ? 'loading' : 'waiting',
      detail: !worldSnapshotAvailable && manifest.isSuccess ? 'not recorded; world reconstruction unavailable' : `${worldChunksLoaded}/${worldChunksTotal} full chunks`,
    },
    renderPackRow,
    textureRow,
    {
      label: 'GPU scene',
      state: sceneReady ? 'ready' : dataReady ? 'loading' : 'waiting',
      detail: sceneReady ? `${worldSections.length} section meshes + ${tracks.size} actor tracks ready` : dataReady ? 'building section meshes, actor runtime and compiling shaders' : 'waiting for replay data/assets',
    },
  ]

  const loadFailed = preloadRows.some((row) => row.state === 'error')
  const completedGateRows = preloadRows.filter((row) => row.state === 'ready' || row.state === 'degraded').length
  const preloadProgress = Math.round((completedGateRows / preloadRows.length) * 100)

  useEffect(() => {
    setSceneReady(false)
    setTextureProgress({ loaded: 0, total: 0 })
  }, [selectedId])

  useEffect(() => {
    setSceneReady(false)
    setTextureProgress({ loaded: 0, total: 0 })
  }, [assetPackId])

  useEffect(() => {
    if (!dataReady) setSceneReady(false)
  }, [dataReady])

  useEffect(() => {
    if (!canStart) clock.setPlaying(false)
  }, [canStart, clock])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (canStart) clock.toggle()
      } else if (event.code === 'ArrowLeft' && canStart) {
        clock.step(-1000)
      } else if (event.code === 'ArrowRight' && canStart) {
        clock.step(1000)
      } else if (event.key === '1') setCameraMode('free')
      else if (event.key === '2') setCameraMode('follow')
      else if (event.key === '3') setCameraMode('pov')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canStart, clock])

  function setLegacyPack(id: string | null) {
    setManualPackId(id)
    if (selectedId === null) return
    const key = `hg.replay.render-pack.${selectedId}`
    if (id) window.localStorage.setItem(key, id)
    else window.localStorage.removeItem(key)
  }

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
            {manifest.data && dataReady && (
              <ReplayScene3D
                sections={worldSections}
                eventsBySection={eventsBySection}
                tracks={tracks}
                subjectUuid={manifest.data.player_uuid}
                armSwingTimes={armSwingTimes}
                clock={clock}
                origin={origin}
                cameraMode={cameraMode}
                showHitboxes={showHitboxes}
                assetPack={assetPack}
                worldContext={worldContext}
                readyToken={sceneToken}
                onSceneReady={() => setSceneReady(true)}
              />
            )}
            {manifest.data && canStart && (
              <>
                <div className="replay3d-hud replay3d-hud--top">
                  <span>REPLAY #{manifest.data.id}</span>
                  <span>{manifest.data.server_name}</span>
                  <span>{assetPack ? `RESOURCE ${assetPack.id}` : 'PROCEDURAL FALLBACK'}</span>
                  <span>{subject ? `${subject.position.x.toFixed(2)} ${subject.position.y.toFixed(2)} ${subject.position.z.toFixed(2)}` : 'waiting for frames'}</span>
                </div>
                <div className="replay3d-hud replay3d-hud--bottom">
                  <span>{worldSnapshotAvailable ? `${loadedWorldChunks.length}/${worldChunksTotal} chunks · ${worldSections.length} sections` : 'world snapshot unavailable'}</span>
                  <span>{requiredTextureAssets.length.toLocaleString()} replay textures resident</span>
                  <span>{recordedBlockCount.toLocaleString()} recorded blocks</span>
                </div>
              </>
            )}
            {manifest.data && !canStart && (
              <ReplayLoadGate
                rows={preloadRows}
                progress={preloadProgress}
                packId={assetPackId}
                recordedPackId={recordedPackId}
                packs={installedPacks}
                onPackSelect={setLegacyPack}
              />
            )}
          </div>

          <div className="replay3d-controls">
            <button type="button" onClick={() => clock.toggle()} disabled={!canStart}>{playback.playing ? '❚❚' : '▶'}</button>
            <span className="replay3d-time">{formatDuration(playhead)}</span>
            <div className="replay3d-timeline-wrap">
              <input
                aria-label="Replay timeline"
                type="range"
                min={0}
                max={Math.max(1, duration)}
                step={10}
                value={clamp(playhead, 0, Math.max(1, duration))}
                disabled={!canStart}
                onChange={(event) => {
                  clock.setPlaying(false)
                  clock.seek(Number(event.target.value))
                }}
              />
              <button
                className="replay3d-trigger-marker"
                style={{ left: `${triggerPercent}%` }}
                title={`Jump to trigger at ${formatDuration(triggerOffset)}`}
                type="button"
                disabled={!canStart}
                onClick={() => clock.seek(triggerOffset)}
              />
            </div>
            <span className="replay3d-time">{formatDuration(duration)}</span>
            <select value={playback.speed} onChange={(event) => clock.setSpeed(Number(event.target.value))} aria-label="Playback speed">
              <option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
            </select>
          </div>
        </div>

        <aside className="replay3d-inspector">
          <div className="replay3d-panel-title"><span>Investigation</span><small>{canStart ? 'ready' : loadFailed ? 'blocked' : 'preloading'}</small></div>

          <section className="replay3d-inspector-section">
            <label>Camera</label>
            <div className="replay3d-segmented">
              {(['free', 'follow', 'pov'] as CameraMode[]).map((mode) => (
                <button type="button" key={mode} onClick={() => setCameraMode(mode)} className={cameraMode === mode ? 'active' : ''}>{mode}</button>
              ))}
            </div>
            <div className="replay3d-toggle-row"><span>Hitboxes</span><button type="button" className={showHitboxes ? 'active' : ''} onClick={() => setShowHitboxes((value) => !value)}>{showHitboxes ? 'ON' : 'OFF'}</button></div>
            <button className="replay3d-wide-button" type="button" onClick={fullscreen} disabled={!dataReady}>Fullscreen scene</button>
          </section>

          {!recordedPackId && installedPacks.length > 0 && (
            <section className="replay3d-inspector-section replay3d-pack-section">
              <label>Legacy render pack</label>
              <select value={assetPackId ?? ''} onChange={(event) => setLegacyPack(event.target.value || null)}>
                <option value="">Select imported pack…</option>
                {installedPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.id} · {pack.version}</option>)}
              </select>
              <p>Explicit render-only override. Replay evidence is unchanged.</p>
            </section>
          )}

          <section className="replay3d-inspector-section">
            <label>Subject</label>
            <strong>{manifest.data?.player_name ?? '—'}</strong>
            <dl>
              <div><dt>Yaw</dt><dd>{subject ? `${subject.rotation.yaw.toFixed(1)}°` : '—'}</dd></div>
              <div><dt>Pitch</dt><dd>{subject ? `${subject.rotation.pitch.toFixed(1)}°` : '—'}</dd></div>
              <div><dt>Ground</dt><dd>{subject?.on_ground === undefined ? '—' : subject.on_ground ? 'yes' : 'no'}</dd></div>
              <div><dt>Pose</dt><dd>{subject?.sneaking ? 'sneaking' : subject?.sprinting ? 'sprinting' : 'standing'}</dd></div>
              <div><dt>Held</dt><dd>{subject?.held_item ?? '—'}</dd></div>
              <div><dt>Speed</dt><dd>{subject ? `${subject.horizontal_speed.toFixed(2)} b/s` : '—'}</dd></div>
            </dl>
          </section>

          <section className="replay3d-inspector-section replay3d-event-section">
            <label>Events near playhead</label>
            {currentEvents.length === 0 && <div className="replay3d-no-events">No recorded event in ±650 ms.</div>}
            {currentEvents.map((event, index) => (
              <button type="button" className="replay3d-event" key={`${event.t}-${event.type}-${index}`} onClick={() => canStart && clock.seek(event.t)} disabled={!canStart}>
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
              <div><dt>Actor clock</dt><dd>WebGPU render loop</dd></div>
              <div><dt>UI clock</dt><dd>20 Hz</dd></div>
              <div><dt>Minecraft</dt><dd>{worldContext?.minecraft_version ?? 'not recorded'}</dd></div>
              <div><dt>Dimension</dt><dd>{worldContext?.environment ?? 'unknown'}</dd></div>
              <div><dt>Render pack</dt><dd>{assetPackId ? `${assetPackId} · ${packSource}` : 'not selected'}</dd></div>
              <div><dt>Section meshes</dt><dd>{worldSections.length.toLocaleString()}</dd></div>
              <div><dt>Timeline load</dt><dd>{replayChunksLoaded}/{replayChunksTotal}</dd></div>
              <div><dt>World load</dt><dd>{worldChunksLoaded}/{worldChunksTotal}</dd></div>
              <div><dt>Texture load</dt><dd>{texturesLoaded}/{requiredTextureAssets.length}</dd></div>
              <div><dt>Replay data</dt><dd>{formatBytes(manifest.data?.size_bytes ?? 0)}</dd></div>
              <div><dt>World data</dt><dd>{formatBytes(manifest.data?.world_snapshot?.size_bytes ?? 0)}</dd></div>
            </dl>
            {manifest.data?.world_snapshot?.anchor_precision === 'exact_per_chunk' ? (
              <p>Each captured chunk is a complete block-state keyframe with its own exact replay timestamp.</p>
            ) : manifest.data?.world_snapshot?.anchor_precision === 'trigger_estimate' ? (
              <p>This older replay has no per-chunk capture timestamps; trigger time is used as the world-keyframe estimate.</p>
            ) : null}
            {packSource === 'manual' && <p>The selected render pack is a manual visualization override because this legacy replay did not record one.</p>}
            {assetPackId && assetPackQuery.isError && (
              <p>Playback is intentionally blocked until <code>{assetPackId}</code> is installed locally. HackerGuardian will not silently start a fidelity replay with missing textures.</p>
            )}
          </section>
        </aside>
      </section>
    </div>
  )
}
