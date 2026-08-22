import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import {
  Color,
  DataTexture,
  LinearMipmapLinearFilter,
  MathUtils,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import { MinecraftWorldMesh } from './MinecraftWorldMesh'
import type { CameraMode, ReplayPlayerFrame, ReplayWorldContext } from './types'
import { buildWorldGeometry, type VoxelWorld } from './voxel'

type Origin = { x: number; y: number; z: number }

type Props = {
  world: VoxelWorld
  players: ReplayPlayerFrame[]
  subject: ReplayPlayerFrame | null
  origin: Origin
  cameraMode: CameraMode
  showHitboxes: boolean
  assetPack?: { id: string; catalog: MinecraftAssetCatalog } | null
  worldContext?: ReplayWorldContext
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

function voxelTexture() {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1
      const hash = ((x * 37 + y * 71 + x * y * 13) ^ (x << 3) ^ (y << 5)) & 31
      const value = edge ? 202 + (hash >> 2) : 224 + hash
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
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

function ProceduralWorldMesh({ world, origin }: { world: VoxelWorld; origin: Origin }) {
  const opaque = useMemo(() => buildWorldGeometry(world, false), [world])
  const transparent = useMemo(() => buildWorldGeometry(world, true), [world])
  const texture = useMemo(() => voxelTexture(), [])

  useEffect(() => () => {
    opaque.dispose()
    transparent.dispose()
  }, [opaque, transparent])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group position={[-origin.x, -origin.y, -origin.z]}>
      <mesh geometry={opaque} receiveShadow castShadow>
        <meshStandardMaterial map={texture} vertexColors roughness={0.92} metalness={0} />
      </mesh>
      <mesh geometry={transparent}>
        <meshStandardMaterial map={texture} vertexColors transparent opacity={0.58} depthWrite={false} roughness={0.65} />
      </mesh>
    </group>
  )
}

function PlayerModel({ player, origin, showHitbox }: { player: ReplayPlayerFrame; origin: Origin; showHitbox: boolean }) {
  const subject = player.subject
  const body = subject ? '#2fd5c4' : '#63a9ec'
  const dark = subject ? '#1b8f87' : '#376d9e'
  const x = player.position.x - origin.x
  const y = player.position.y - origin.y
  const z = player.position.z - origin.z
  const yaw = -MathUtils.degToRad(player.rotation.yaw)
  const crouch = player.sneaking ? -0.12 : 0
  const eyeHeight = player.sneaking ? 1.5 : 1.62
  const eye = new Vector3(x, y + eyeHeight, z)
  const aim = direction(player).multiplyScalar(subject ? 4 : 2.2)

  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <group position={[0, crouch, 0]} rotation={[player.sneaking ? 0.18 : 0, 0, 0]}>
        <mesh position={[0, 1.55, 0]} castShadow><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color={body} /></mesh>
        <mesh position={[0, 0.98, 0]} castShadow><boxGeometry args={[0.56, 0.72, 0.3]} /><meshStandardMaterial color={dark} /></mesh>
        <mesh position={[-0.39, 1.0, 0]} castShadow><boxGeometry args={[0.18, 0.7, 0.22]} /><meshStandardMaterial color={body} /></mesh>
        <mesh position={[0.39, 1.0, 0]} castShadow><boxGeometry args={[0.18, 0.7, 0.22]} /><meshStandardMaterial color={body} /></mesh>
        <mesh position={[-0.16, 0.36, 0]} castShadow><boxGeometry args={[0.22, 0.72, 0.25]} /><meshStandardMaterial color={dark} /></mesh>
        <mesh position={[0.16, 0.36, 0]} castShadow><boxGeometry args={[0.22, 0.72, 0.25]} /><meshStandardMaterial color={dark} /></mesh>
      </group>
      {showHitbox && <mesh position={[0, 0.9, 0]}><boxGeometry args={[0.62, 1.8, 0.62]} /><meshBasicMaterial color={subject ? '#58f3e5' : '#8bc9ff'} wireframe transparent opacity={0.65} /></mesh>}
      <Html position={[0, 2.05 + crouch, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
        <div className={`replay3d-nameplate${subject ? ' replay3d-nameplate--subject' : ''}`}>
          {player.name}{subject ? ' · SUBJECT' : ''}
        </div>
      </Html>
      <Line
        points={[
          [eye.x - x, eye.y - y, eye.z - z],
          [eye.x - x + aim.x, eye.y - y + aim.y, eye.z - z + aim.z],
        ]}
        color={subject ? '#38e2d0' : '#6baee8'}
        lineWidth={subject ? 1.6 : 0.8}
        transparent
        opacity={0.7}
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

function Scene({ world, players, subject, origin, cameraMode, showHitboxes, assetPack, worldContext }: Props) {
  const target: [number, number, number] = subject
    ? [subject.position.x - origin.x, subject.position.y - origin.y + 1, subject.position.z - origin.z]
    : [0, 1, 0]
  const env = environment(worldContext)

  return (
    <>
      <color attach="background" args={[env.sky]} />
      <fog attach="fog" args={[env.fog, 70, 220]} />
      <ambientLight intensity={env.ambient} />
      <directionalLight position={[28, 45, 18]} intensity={env.sun} castShadow shadow-mapSize={[2048, 2048]} />
      <hemisphereLight args={[env.hemiSky, env.hemiGround, 0.4]} />

      {assetPack ? (
        <Suspense fallback={<ProceduralWorldMesh world={world} origin={origin} />}>
          <MinecraftWorldMesh world={world} origin={origin} packId={assetPack.id} catalog={assetPack.catalog} />
        </Suspense>
      ) : <ProceduralWorldMesh world={world} origin={origin} />}

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
    </>
  )
}

export function ReplayScene3D(props: Props) {
  const subject = props.subject
  const initialPosition: [number, number, number] = subject
    ? [
        subject.position.x - props.origin.x + 7,
        subject.position.y - props.origin.y + 5,
        subject.position.z - props.origin.z + 7,
      ]
    : [8, 7, 8]

  return (
    <Canvas
      className="replay3d-canvas"
      shadows
      dpr={[1, 1.75]}
      camera={{ position: initialPosition, fov: 70, near: 0.03, far: 700 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      <Scene {...props} />
    </Canvas>
  )
}
