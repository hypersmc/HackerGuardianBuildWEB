import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Color,
  MathUtils,
  Quaternion,
  type Texture,
  Vector3,
} from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import { MinecraftWorldMesh } from './MinecraftWorldMesh'
import {
  disposeReplayMeshWorld,
  preloadReplayMeshWorld,
  type PreparedReplayMeshWorld,
  type ReplayMeshProgress,
} from './replayMeshPreload'
import type { ReplayWorldSection } from './replaySections'
import type { CameraMode, ReplayPlayerFrame, ReplayWorldContext } from './types'
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
  playhead: number
  players: ReplayPlayerFrame[]
  subject: ReplayPlayerFrame | null
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

function direction(player: ReplayPlayerFrame) {
  const yaw = MathUtils.degToRad(player.rotation.yaw)
  const pitch = MathUtils.degToRad(player.rotation.pitch)
  const cosPitch = Math.cos(pitch)
  return new Vector3(
    -Math.sin(yaw) * cosPitch,
    -Math.sin(pitch),
    Math.cos(yaw) * cosPitch,
  ).normalize()
}

function CameraRig({ subject, origin, mode }: { subject: ReplayPlayerFrame | null; origin: Origin; mode: CameraMode }) {
  const { camera } = useThree()
  const desired = useMemo(() => new Vector3(), [])
  const lookAt = useMemo(() => new Vector3(), [])

  useFrame((_, delta) => {
    if (!subject || mode === 'free') return

    const local = new Vector3(
      subject.position.x - origin.x,
      subject.position.y - origin.y,
      subject.position.z - origin.z,
    )
    const aim = direction(subject)
    const eyeHeight = subject.sneaking ? 1.5 : 1.62

    if (mode === 'pov') {
      desired.copy(local).add(new Vector3(0, eyeHeight, 0))
      lookAt.copy(desired).addScaledVector(aim, 10)
      camera.position.lerp(desired, 1 - Math.exp(-delta * 18))
      camera.lookAt(lookAt)
      return
    }

    const horizontal = aim.clone().setY(0)
    if (horizontal.lengthSq() < 0.001) horizontal.set(0, 0, 1)
    horizontal.normalize()
    desired.copy(local).add(new Vector3(0, 2.3, 0)).addScaledVector(horizontal, -5.4)
    lookAt.copy(local).add(new Vector3(0, 1.05, 0))
    camera.position.lerp(desired, 1 - Math.exp(-delta * 7))
    camera.lookAt(lookAt)
  })

  return null
}

function DirectionRay({
  start,
  vector,
  color,
  radius,
}: {
  start: Vector3
  vector: Vector3
  color: string
  radius: number
}) {
  const length = vector.length()
  if (length <= 0.0001) return null
  const midpoint = start.clone().addScaledVector(vector, 0.5)
  const quaternion = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    vector.clone().normalize(),
  )
  const position = midpoint.toArray() as [number, number, number]

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 5, 1, false]} />
      <meshBasicMaterial color={color} transparent opacity={0.72} depthWrite={false} />
    </mesh>
  )
}

function PlayerModel({ player, origin, showHitbox }: { player: ReplayPlayerFrame; origin: Origin; showHitbox: boolean }) {
  const isSubject = player.subject
  const body = isSubject ? '#2fd5c4' : '#63a9ec'
  const dark = isSubject ? '#1b8f87' : '#376d9e'
  const x = player.position.x - origin.x
  const y = player.position.y - origin.y
  const z = player.position.z - origin.z
  const yaw = -MathUtils.degToRad(player.rotation.yaw)
  const crouch = player.sneaking ? -0.12 : 0
  const eyeHeight = player.sneaking ? 1.5 : 1.62
  const aim = direction(player).multiplyScalar(isSubject ? 4 : 2.2)

  return (
    <group position={[x, y, z]}>
      <group rotation={[0, yaw, 0]}>
        <group position={[0, crouch, 0]} rotation={[player.sneaking ? 0.18 : 0, 0, 0]}>
          <mesh position={[0, 1.55, 0]}><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color={body} /></mesh>
          <mesh position={[0, 0.98, 0]}><boxGeometry args={[0.56, 0.72, 0.3]} /><meshStandardMaterial color={dark} /></mesh>
          <mesh position={[-0.39, 1.0, 0]}><boxGeometry args={[0.18, 0.7, 0.22]} /><meshStandardMaterial color={body} /></mesh>
          <mesh position={[0.39, 1.0, 0]}><boxGeometry args={[0.18, 0.7, 0.22]} /><meshStandardMaterial color={body} /></mesh>
          <mesh position={[-0.16, 0.36, 0]}><boxGeometry args={[0.22, 0.72, 0.25]} /><meshStandardMaterial color={dark} /></mesh>
          <mesh position={[0.16, 0.36, 0]}><boxGeometry args={[0.22, 0.72, 0.25]} /><meshStandardMaterial color={dark} /></mesh>
        </group>
      </group>
      {showHitbox && <mesh position={[0, 0.9, 0]}><boxGeometry args={[0.62, 1.8, 0.62]} /><meshBasicMaterial color={isSubject ? '#58f3e5' : '#8bc9ff'} wireframe transparent opacity={0.65} /></mesh>}
      <Html position={[0, 2.05 + crouch, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
        <div className={`replay3d-nameplate${isSubject ? ' replay3d-nameplate--subject' : ''}`}>
          {player.name}{isSubject ? ' · SUBJECT' : ''}
        </div>
      </Html>
      <DirectionRay
        start={new Vector3(0, eyeHeight, 0)}
        vector={aim}
        color={isSubject ? '#38e2d0' : '#6baee8'}
        radius={isSubject ? 0.012 : 0.007}
      />
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
  playhead,
  players,
  subject,
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
  const target: [number, number, number] = subject
    ? [subject.position.x - origin.x, subject.position.y - origin.y + 1, subject.position.z - origin.z]
    : [0, 1, 0]
  const env = environment(worldContext)

  return (
    <>
      <color attach="background" args={[env.sky]} />
      <fog attach="fog" args={[env.fog, 70, 220]} />
      <ambientLight intensity={env.ambient} />
      <directionalLight position={[28, 45, 18]} intensity={env.sun} />
      <hemisphereLight args={[env.hemiSky, env.hemiGround, 0.4]} />

      <MinecraftWorldMesh world={preparedWorld} playhead={playhead} origin={origin} textures={textures} />
      {players.map((player) => <PlayerModel key={player.uuid} player={player} origin={origin} showHitbox={showHitboxes} />)}

      <CameraRig subject={subject} origin={origin} mode={cameraMode} />
      <OrbitControls
        enabled={cameraMode === 'free'}
        target={target}
        makeDefault
        enableDamping
        dampingFactor={0.08}
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
  if (progress.phase === 'combining') return `Combining static world geometry · ${progress.revisions} dynamic revisions prepared`
  if (progress.phase === 'hydrating') return `Preparing GPU buffers ${progress.completed}/${progress.total} · ${progress.revisions} dynamic revisions`
  return `Meshing sections ${progress.completed}/${progress.total} · ${progress.revisions} dynamic revisions`
}

export function ReplayScene3D(props: Props) {
  const [probe, setProbe] = useState<WebGpuProbe | null>(null)
  const [preparedWorld, setPreparedWorld] = useState<PreparedReplayMeshWorld | null>(null)
  const [meshProgress, setMeshProgress] = useState<ReplayMeshProgress | null>(null)
  const [meshError, setMeshError] = useState<string | null>(null)
  const [rendererError, setRendererError] = useState<string | null>(null)
  const [rendererReady, setRendererReady] = useState(false)
  const catalog = props.assetPack?.catalog ?? null

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
    if (!probe?.supported || !catalog) return
    const controller = new AbortController()
    let ownedWorld: PreparedReplayMeshWorld | null = null
    let cancelled = false

    setPreparedWorld(null)
    setMeshProgress(null)
    setMeshError(null)

    void preloadReplayMeshWorld(
      props.sections,
      props.eventsBySection,
      catalog,
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
  }, [probe?.supported, catalog, props.sections, props.eventsBySection, props.readyToken])

  if (!probe) return <EngineOverlay title="Checking WebGPU" detail="Probing for a hardware-accelerated WebGPU adapter…" />
  if (!probe.supported) return <EngineOverlay error title="WebGPU required" detail={probe.message} />
  if (!props.assetPack) {
    return <EngineOverlay error title="Minecraft render pack required" detail="Install or select the Minecraft asset pack for this replay. The fidelity viewer will not fall back to WebGL or a diagnostic block renderer." />
  }
  if (meshError) return <EngineOverlay error title="Replay mesh preparation failed" detail={meshError} />
  if (!preparedWorld) return <EngineOverlay title="Preparing Minecraft geometry" detail={meshProgressText(meshProgress)} />
  if (rendererError) return <EngineOverlay error title="WebGPU renderer failed" detail={rendererError} />

  const subject = props.subject
  const initialPosition: [number, number, number] = subject
    ? [subject.position.x - props.origin.x + 7, subject.position.y - props.origin.y + 5, subject.position.z - props.origin.z + 7]
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
