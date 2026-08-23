import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Color,
  Group,
  MathUtils,
  Quaternion,
  type Texture,
  Vector3,
} from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import { MinecraftWorldMesh } from './MinecraftWorldMesh'
import { findSubjectTrack, latestEventProgress, samplePlayerTrack } from './replayActors'
import type { ReplayPlaybackClock } from './replayClock'
import {
  disposeReplayMeshWorld,
  preloadReplayMeshWorld,
  type PreparedReplayMeshWorld,
  type ReplayMeshProgress,
} from './replayMeshPreload'
import type { ReplayWorldSection } from './replaySections'
import type { CameraMode, PlayerSample, ReplayWorldContext } from './types'
import type { TimedReplayEvent } from './voxel'
import {
  createRequiredWebGpuRenderer,
  probeRequiredWebGpu,
  type WebGpuProbe,
} from './webgpuSupport'
import '../../styles/replay-engine.css'

type Origin = { x: number; y: number; z: number }

type Props = {
  sections: ReplayWorldSection[]
  eventsBySection: ReadonlyMap<string, TimedReplayEvent[]>
  tracks: ReadonlyMap<string, PlayerSample[]>
  subjectUuid: string
  armSwingTimes: number[]
  clock: ReplayPlaybackClock
  origin: Origin
  cameraMode: CameraMode
  showHitboxes: boolean
  assetPack?: {
    id: string
    catalog: MinecraftAssetCatalog
    textures: ReadonlyMap<string, Texture>
  } | null
  worldContext?: ReplayWorldContext
  readyToken?: string
  onSceneReady?: () => void
}

const UP = new Vector3(0, 1, 0)

function direction(yawDegrees: number, pitchDegrees: number, target = new Vector3()) {
  const yaw = MathUtils.degToRad(yawDegrees)
  const pitch = MathUtils.degToRad(pitchDegrees)
  const cosPitch = Math.cos(pitch)
  return target.set(
    -Math.sin(yaw) * cosPitch,
    -Math.sin(pitch),
    Math.cos(yaw) * cosPitch,
  ).normalize()
}

/** Advances evidence time from the same render loop that consumes actor poses. */
function PlaybackDriver({ clock }: { clock: ReplayPlaybackClock }) {
  useFrame((_, delta) => {
    clock.advance(delta * 1000)
  }, -100)
  return null
}

function CameraRig({
  track,
  clock,
  origin,
  mode,
}: {
  track: PlayerSample[] | undefined
  clock: ReplayPlaybackClock
  origin: Origin
  mode: CameraMode
}) {
  const { camera } = useThree()
  const local = useMemo(() => new Vector3(), [])
  const desired = useMemo(() => new Vector3(), [])
  const lookAt = useMemo(() => new Vector3(), [])
  const aim = useMemo(() => new Vector3(), [])
  const horizontal = useMemo(() => new Vector3(), [])

  useFrame((_, delta) => {
    if (mode === 'free') return
    const subject = samplePlayerTrack(track, clock.getTimeMs())
    if (!subject) return

    local.set(
      subject.position.x - origin.x,
      subject.position.y - origin.y,
      subject.position.z - origin.z,
    )
    direction(subject.rotation.yaw, subject.rotation.pitch, aim)
    const eyeHeight = subject.sneaking ? 1.5 : 1.62

    if (mode === 'pov') {
      // POV consumes the exact same render-frame sample as the player actor. There
      // is deliberately no second interpolation/damping layer here.
      desired.copy(local).y += eyeHeight
      lookAt.copy(desired).addScaledVector(aim, 10)
      camera.position.copy(desired)
      camera.lookAt(lookAt)
      return
    }

    horizontal.copy(aim).setY(0)
    if (horizontal.lengthSq() < 0.001) horizontal.set(0, 0, 1)
    horizontal.normalize()
    desired.copy(local).y += subject.sneaking ? 2.0 : 2.3
    desired.addScaledVector(horizontal, -5.4)
    lookAt.copy(local).y += subject.sneaking ? 0.9 : 1.05

    // Follow remains intentionally cinematic, but its target pose is sampled at
    // render rate rather than following a throttled React actor object.
    camera.position.lerp(desired, 1 - Math.exp(-delta * 18))
    camera.lookAt(lookAt)
  }, -50)

  return null
}

function PlayerActor({
  track,
  clock,
  origin,
  isSubject,
  showHitbox,
  armSwingTimes,
}: {
  track: PlayerSample[]
  clock: ReplayPlaybackClock
  origin: Origin
  isSubject: boolean
  showHitbox: boolean
  armSwingTimes: number[]
}) {
  const root = useRef<Group>(null)
  const bodyYaw = useRef<Group>(null)
  const poseRoot = useRef<Group>(null)
  const head = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)
  const leftLeg = useRef<Group>(null)
  const rightLeg = useRef<Group>(null)
  const hitbox = useRef<Group>(null)
  const aimRay = useRef<Group>(null)
  const aim = useMemo(() => new Vector3(), [])
  const midpoint = useMemo(() => new Vector3(), [])
  const rayQuaternion = useMemo(() => new Quaternion(), [])

  const name = track[0]?.name ?? 'Player'
  const body = isSubject ? '#2fd5c4' : '#63a9ec'
  const dark = isSubject ? '#1b8f87' : '#376d9e'

  useFrame(() => {
    const actor = samplePlayerTrack(track, clock.getTimeMs())
    if (!root.current) return
    if (!actor) {
      root.current.visible = false
      return
    }
    root.current.visible = true

    root.current.position.set(
      actor.position.x - origin.x,
      actor.position.y - origin.y,
      actor.position.z - origin.z,
    )

    if (bodyYaw.current) bodyYaw.current.rotation.y = -MathUtils.degToRad(actor.rotation.yaw)

    const crouching = Boolean(actor.sneaking)
    if (poseRoot.current) {
      poseRoot.current.position.y = crouching ? -0.12 : 0
      poseRoot.current.rotation.x = crouching ? 0.18 : 0
    }

    if (head.current) head.current.rotation.x = MathUtils.degToRad(actor.rotation.pitch)

    // Visual locomotion is derived from the recorded segment velocity. It never
    // changes the actor's evidence position; only limb pose is animated between
    // snapshots so 10/20 Hz recordings do not look like sliding mannequins.
    const movement = Math.min(1, actor.horizontal_speed / (actor.sprinting ? 5.6 : 4.3))
    const moving = movement > 0.015
    const gaitFrequency = actor.sprinting ? 0.016 : 0.013
    const gait = moving ? Math.sin(clock.getTimeMs() * gaitFrequency) : 0
    const stride = gait * movement * (actor.sprinting ? 1.05 : 0.82)

    const swingProgress = isSubject ? latestEventProgress(armSwingTimes, clock.getTimeMs(), 320) : 0
    const attackSwing = swingProgress > 0 ? Math.sin(swingProgress * Math.PI) * 1.55 : 0

    if (leftArm.current) leftArm.current.rotation.x = stride
    if (rightArm.current) rightArm.current.rotation.x = -stride - attackSwing
    if (leftLeg.current) leftLeg.current.rotation.x = -stride
    if (rightLeg.current) rightLeg.current.rotation.x = stride

    if (hitbox.current) {
      const height = crouching ? 1.5 : 1.8
      hitbox.current.visible = showHitbox
      hitbox.current.position.y = height / 2
      hitbox.current.scale.y = height
    }

    if (aimRay.current) {
      const eyeHeight = crouching ? 1.5 : 1.62
      const length = isSubject ? 4 : 2.2
      direction(actor.rotation.yaw, actor.rotation.pitch, aim)
      midpoint.copy(aim).multiplyScalar(length / 2).add(new Vector3(0, eyeHeight, 0))
      rayQuaternion.setFromUnitVectors(UP, aim)
      aimRay.current.position.copy(midpoint)
      aimRay.current.quaternion.copy(rayQuaternion)
      aimRay.current.scale.set(1, length, 1)
    }
  })

  return (
    <group ref={root}>
      <group ref={bodyYaw}>
        <group ref={poseRoot}>
          <group ref={head} position={[0, 1.55, 0]}>
            <mesh><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color={body} /></mesh>
          </group>
          <mesh position={[0, 0.98, 0]}><boxGeometry args={[0.56, 0.72, 0.3]} /><meshStandardMaterial color={dark} /></mesh>
          <group ref={leftArm} position={[-0.39, 1.28, 0]}>
            <mesh position={[0, -0.28, 0]}><boxGeometry args={[0.18, 0.7, 0.22]} /><meshStandardMaterial color={body} /></mesh>
          </group>
          <group ref={rightArm} position={[0.39, 1.28, 0]}>
            <mesh position={[0, -0.28, 0]}><boxGeometry args={[0.18, 0.7, 0.22]} /><meshStandardMaterial color={body} /></mesh>
          </group>
          <group ref={leftLeg} position={[-0.16, 0.72, 0]}>
            <mesh position={[0, -0.36, 0]}><boxGeometry args={[0.22, 0.72, 0.25]} /><meshStandardMaterial color={dark} /></mesh>
          </group>
          <group ref={rightLeg} position={[0.16, 0.72, 0]}>
            <mesh position={[0, -0.36, 0]}><boxGeometry args={[0.22, 0.72, 0.25]} /><meshStandardMaterial color={dark} /></mesh>
          </group>
        </group>
      </group>

      <group ref={hitbox} visible={showHitbox}>
        <mesh><boxGeometry args={[0.62, 1, 0.62]} /><meshBasicMaterial color={isSubject ? '#58f3e5' : '#8bc9ff'} wireframe transparent opacity={0.65} /></mesh>
      </group>

      <Html position={[0, 2.05, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
        <div className={`replay3d-nameplate${isSubject ? ' replay3d-nameplate--subject' : ''}`}>
          {name}{isSubject ? ' · SUBJECT' : ''}
        </div>
      </Html>

      <group ref={aimRay}>
        <mesh>
          <cylinderGeometry args={[isSubject ? 0.012 : 0.007, isSubject ? 0.012 : 0.007, 1, 5, 1, false]} />
          <meshBasicMaterial color={isSubject ? '#38e2d0' : '#6baee8'} transparent opacity={0.72} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}

function environment(context?: ReplayWorldContext) {
  const dimension = context?.environment?.toUpperCase() ?? 'NORMAL'
  if (dimension.includes('NETHER')) {
    return { sky: '#2a0805', fog: '#330a08', ambient: 0.42, sun: 0.55, hemiSky: '#5f251d', hemiGround: '#170402' }
  }
  if (dimension.includes('END')) {
    return { sky: '#08050f', fog: '#0d0818', ambient: 0.55, sun: 0.4, hemiSky: '#6b5888', hemiGround: '#130e1c' }
  }

  const time = ((context?.game_time ?? 6000) % 24000 + 24000) % 24000
  const daylight = Math.max(0.08, (Math.cos(((time - 6000) / 24000) * Math.PI * 2) + 1) / 2)
  const stormFactor = context?.storm ? 0.58 : 1
  const sky = new Color('#78a7d8').multiplyScalar(Math.max(0.18, daylight * stormFactor))
  const fog = sky.clone().lerp(new Color('#6f7880'), context?.storm ? 0.48 : 0.08)
  return {
    sky: `#${sky.getHexString()}`,
    fog: `#${fog.getHexString()}`,
    ambient: 0.28 + daylight * 0.55 * stormFactor,
    sun: 0.25 + daylight * 1.05 * stormFactor,
    hemiSky: '#a9cae7',
    hemiGround: '#182113',
  }
}

function SceneReady({ token, onReady }: { token: string; onReady?: () => void }) {
  const { gl, scene, camera } = useThree()
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    let cancelled = false
    let frame: number | null = null
    const warm = async () => {
      try {
        await gl.compileAsync(scene, camera)
      } catch {
        // The first real WebGPU draw is still the authoritative fallback warm-up.
      }
      if (cancelled) return
      frame = requestAnimationFrame(() => {
        if (!cancelled) onReadyRef.current?.()
      })
    }
    void warm()
    return () => {
      cancelled = true
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [token, gl, scene, camera])

  return null
}

function Scene({
  preparedWorld,
  tracks,
  subjectUuid,
  armSwingTimes,
  clock,
  origin,
  cameraMode,
  showHitboxes,
  textures,
  worldContext,
  readyToken,
  onSceneReady,
}: Omit<Props, 'sections' | 'eventsBySection' | 'assetPack'> & {
  preparedWorld: PreparedReplayMeshWorld
  textures: ReadonlyMap<string, Texture>
}) {
  const subjectTrack = findSubjectTrack(tracks, subjectUuid)
  const firstSubject = subjectTrack?.[0]
  const target: [number, number, number] = firstSubject
    ? [firstSubject.position.x - origin.x, firstSubject.position.y - origin.y + 1, firstSubject.position.z - origin.z]
    : [0, 1, 0]
  const env = environment(worldContext)

  return (
    <>
      <color attach="background" args={[env.sky]} />
      <fog attach="fog" args={[env.fog, 70, 220]} />
      <ambientLight intensity={env.ambient} />
      <directionalLight position={[28, 45, 18]} intensity={env.sun} />
      <hemisphereLight args={[env.hemiSky, env.hemiGround, 0.4]} />

      <PlaybackDriver clock={clock} />
      <MinecraftWorldMesh world={preparedWorld} clock={clock} origin={origin} textures={textures} />
      {[...tracks.entries()].map(([uuid, track]) => (
        <PlayerActor
          key={uuid}
          track={track}
          clock={clock}
          origin={origin}
          isSubject={uuid === subjectUuid || track.some((sample) => sample.subject)}
          showHitbox={showHitboxes}
          armSwingTimes={armSwingTimes}
        />
      ))}

      <CameraRig track={subjectTrack} clock={clock} origin={origin} mode={cameraMode} />
      <OrbitControls
        enabled={cameraMode === 'free'}
        target={target}
        makeDefault
        enableDamping={false}
        rotateSpeed={0.85}
        zoomSpeed={1.1}
        panSpeed={1}
        maxDistance={160}
        minDistance={0.4}
      />
      <SceneReady token={readyToken ?? ''} onReady={onSceneReady} />
    </>
  )
}

class RendererBoundary extends Component<{
  children: ReactNode
  onError: (message: string) => void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : String(error))
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function webGpuRendererFactory(defaults: unknown) {
  return createRequiredWebGpuRenderer(defaults as Record<string, unknown>)
}

function EngineOverlay({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return (
    <div className={`replay3d-engine-overlay${error ? ' replay3d-engine-overlay--error' : ''}`}>
      <div>
        <span>{error ? '3D REPLAY BLOCKED' : 'REPLAY ENGINE'}</span>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function meshProgressText(progress: ReplayMeshProgress | null) {
  if (!progress) return 'Starting off-main-thread Minecraft mesh preparation…'
  if (progress.detail) return progress.detail
  switch (progress.phase) {
    case 'starting': return 'Starting replay mesh worker…'
    case 'transferring': return `Sending ${progress.total} compressed world sections to the worker…`
    case 'catalog': return 'Loading Minecraft model catalog inside the worker…'
    case 'decoding': return `Expanding recorded sections ${progress.completed}/${progress.total}`
    case 'dynamic': return `Preparing block-event revisions ${progress.completed}/${progress.total}`
    case 'meshing': return `Meshing recorded chunks ${progress.completed}/${progress.total}`
    case 'combining': return `Combining static world geometry ${progress.completed}/${progress.total}`
    case 'hydrating': return `Preparing GPU buffers ${progress.completed}/${progress.total}`
  }
}

export function ReplayScene3D(props: Props) {
  const [probe, setProbe] = useState<WebGpuProbe | null>(null)
  const [preparedWorld, setPreparedWorld] = useState<PreparedReplayMeshWorld | null>(null)
  const [meshProgress, setMeshProgress] = useState<ReplayMeshProgress | null>(null)
  const [meshError, setMeshError] = useState<string | null>(null)
  const [rendererError, setRendererError] = useState<string | null>(null)
  const [rendererReady, setRendererReady] = useState(false)
  const assetPackId = props.assetPack?.id ?? null

  useEffect(() => {
    let cancelled = false
    void probeRequiredWebGpu().then((result) => {
      if (!cancelled) setProbe(result)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setRendererReady(false)
    setRendererError(null)
  }, [props.readyToken])

  useEffect(() => {
    if (!probe?.supported || !assetPackId) return
    const controller = new AbortController()
    let ownedWorld: PreparedReplayMeshWorld | null = null
    let cancelled = false

    setPreparedWorld(null)
    setMeshProgress(null)
    setMeshError(null)

    void preloadReplayMeshWorld(
      props.sections,
      props.eventsBySection,
      assetPackId,
      (progress) => {
        if (!cancelled) setMeshProgress(progress)
      },
      controller.signal,
    ).then((world) => {
      if (cancelled) {
        disposeReplayMeshWorld(world)
        return
      }
      ownedWorld = world
      setPreparedWorld(world)
    }).catch((error) => {
      if (!cancelled) setMeshError(error instanceof Error ? error.message : String(error))
    })

    return () => {
      cancelled = true
      controller.abort()
      if (ownedWorld) disposeReplayMeshWorld(ownedWorld)
    }
    // readyToken is the immutable replay/render-input identity. Depending directly
    // on useQueries-derived array/Map identities can abort and restart the worker
    // even when the evidence content itself has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe?.supported, assetPackId, props.readyToken])

  if (!probe) return <EngineOverlay title="Checking WebGPU" detail="Probing for a hardware-accelerated WebGPU adapter…" />
  if (!probe.supported) return <EngineOverlay error title="WebGPU required" detail={probe.message} />
  if (!props.assetPack) {
    return <EngineOverlay error title="Minecraft render pack required" detail="Install or select the Minecraft asset pack for this replay. The fidelity viewer will not fall back to WebGL or a diagnostic block renderer." />
  }
  if (meshError) return <EngineOverlay error title="Replay mesh preparation failed" detail={meshError} />
  if (!preparedWorld) return <EngineOverlay title="Preparing Minecraft geometry" detail={meshProgressText(meshProgress)} />
  if (rendererError) return <EngineOverlay error title="WebGPU renderer failed" detail={rendererError} />

  const subjectTrack = findSubjectTrack(props.tracks, props.subjectUuid)
  const firstSubject = subjectTrack?.[0]
  const initialPosition: [number, number, number] = firstSubject
    ? [firstSubject.position.x - props.origin.x + 7, firstSubject.position.y - props.origin.y + 5, firstSubject.position.z - props.origin.z + 7]
    : [8, 7, 8]

  const ready = () => {
    if (rendererReady) return
    setRendererReady(true)
    props.onSceneReady?.()
  }

  return (
    <RendererBoundary key={props.readyToken ?? 'replay'} onError={setRendererError}>
      <Canvas
        className="replay3d-canvas"
        dpr={[1, 1.5]}
        camera={{ position: initialPosition, fov: 70, near: 0.03, far: 700 }}
        gl={webGpuRendererFactory}
      >
        <Scene
          {...props}
          preparedWorld={preparedWorld}
          textures={props.assetPack.textures}
          onSceneReady={ready}
        />
      </Canvas>
      {!rendererReady && <div className="replay3d-engine-badge">WEBGPU · compiling replay scene</div>}
    </RendererBoundary>
  )
}
