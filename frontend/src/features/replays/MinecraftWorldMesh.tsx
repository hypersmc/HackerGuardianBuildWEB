import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  LinearMipmapLinearFilter,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import { minecraftAssetApi } from './minecraftAssets'
import { buildMinecraftGeometry } from './minecraftModels'
import type { VoxelWorld } from './voxel'

type Origin = { x: number; y: number; z: number }

type Props = {
  world: VoxelWorld
  origin: Origin
  packId: string
  catalog: MinecraftAssetCatalog
}

export function MinecraftWorldMesh({ world, origin, packId, catalog }: Props) {
  const groups = useMemo(() => buildMinecraftGeometry(world, catalog), [world, catalog])

  useEffect(() => () => {
    for (const group of groups) group.geometry.dispose()
  }, [groups])

  const textured = groups.filter((group) => group.texture !== null)
  const fallback = groups.filter((group) => group.texture === null)

  return (
    <group position={[-origin.x, -origin.y, -origin.z]}>
      {textured.length > 0 && <TexturedGroups groups={textured} packId={packId} />}
      {fallback.map((group) => (
        <mesh key={group.key} geometry={group.geometry} receiveShadow castShadow={group.layer !== 'translucent'}>
          <meshStandardMaterial
            vertexColors
            roughness={0.88}
            transparent={group.layer === 'translucent'}
            opacity={group.layer === 'translucent' ? 0.62 : 1}
            depthWrite={group.layer !== 'translucent'}
          />
        </mesh>
      ))}
    </group>
  )
}

function TexturedGroups({ groups, packId }: { groups: ReturnType<typeof buildMinecraftGeometry>; packId: string }) {
  const urls = groups.map((group) => minecraftAssetApi.textureUrl(packId, group.texture as string))
  const textures = useLoader(TextureLoader, urls)

  for (const texture of textures) {
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = NearestFilter
    texture.minFilter = LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
  }

  return groups.map((group, index) => (
    <mesh
      key={group.key}
      geometry={group.geometry}
      receiveShadow
      castShadow={group.layer !== 'translucent'}
      renderOrder={group.layer === 'translucent' ? 2 : group.layer === 'cutout' ? 1 : 0}
    >
      <meshStandardMaterial
        map={textures[index]}
        vertexColors
        roughness={0.9}
        metalness={0}
        alphaTest={group.layer === 'cutout' ? 0.1 : 0}
        transparent={group.layer === 'translucent'}
        opacity={group.layer === 'translucent' ? 0.76 : 1}
        depthWrite={group.layer !== 'translucent'}
      />
    </mesh>
  ))
}
