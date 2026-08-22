import { useEffect, useMemo } from 'react'
import type { Texture } from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import { buildMinecraftGeometry } from './minecraftModels'
import type { VoxelWorld } from './voxel'

type Origin = { x: number; y: number; z: number }

type Props = {
  world: VoxelWorld
  origin: Origin
  catalog: MinecraftAssetCatalog
  textures: ReadonlyMap<string, Texture>
}

export function MinecraftWorldMesh({ world, origin, catalog, textures }: Props) {
  const groups = useMemo(() => buildMinecraftGeometry(world, catalog), [world, catalog])

  useEffect(() => () => {
    for (const group of groups) group.geometry.dispose()
  }, [groups])

  return (
    <group position={[-origin.x, -origin.y, -origin.z]}>
      {groups.map((group) => {
        const texture = group.texture ? textures.get(group.texture) : null
        return (
          <mesh
            key={group.key}
            geometry={group.geometry}
            receiveShadow
            castShadow={group.layer !== 'translucent'}
            renderOrder={group.layer === 'translucent' ? 2 : group.layer === 'cutout' ? 1 : 0}
          >
            <meshStandardMaterial
              map={texture ?? undefined}
              vertexColors
              roughness={texture ? 0.9 : 0.88}
              metalness={0}
              alphaTest={group.layer === 'cutout' ? 0.1 : 0}
              transparent={group.layer === 'translucent'}
              opacity={group.layer === 'translucent' ? 0.76 : 1}
              depthWrite={group.layer !== 'translucent'}
            />
          </mesh>
        )
      })}
    </group>
  )
}
