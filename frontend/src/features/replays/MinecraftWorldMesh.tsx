import { memo } from 'react'
import type { Texture } from 'three'
import { sectionWorldRevision } from './replaySections'
import type {
  PreparedDynamicReplaySection,
  PreparedReplayGeometry,
  PreparedReplayMeshWorld,
} from './replayMeshPreload'

type Origin = { x: number; y: number; z: number }

type Props = {
  world: PreparedReplayMeshWorld
  playhead: number
  origin: Origin
  textures: ReadonlyMap<string, Texture>
}

export const MinecraftWorldMesh = memo(function MinecraftWorldMesh({ world, playhead, origin, textures }: Props) {
  return (
    <group position={[-origin.x, -origin.y, -origin.z]}>
      <GeometryGroups groups={world.staticGroups} textures={textures} prefix="static" />
      {world.dynamicSections.map((section) => (
        <DynamicSection
          key={section.key}
          section={section}
          playhead={playhead}
          textures={textures}
        />
      ))}
    </group>
  )
})

function DynamicSection({
  section,
  playhead,
  textures,
}: {
  section: PreparedDynamicReplaySection
  playhead: number
  textures: ReadonlyMap<string, Texture>
}) {
  const revision = sectionWorldRevision(section.events, playhead, section.anchorMs)
  const groups = section.revisions[revision] ?? section.revisions.base ?? []
  return <GeometryGroups groups={groups} textures={textures} prefix={`${section.key}:${revision}`} />
}

function GeometryGroups({
  groups,
  textures,
  prefix,
}: {
  groups: PreparedReplayGeometry[]
  textures: ReadonlyMap<string, Texture>
  prefix: string
}) {
  return (
    <>
      {groups.map((group) => {
        const texture = group.texture ? textures.get(group.texture) : null
        return (
          <mesh
            key={`${prefix}:${group.key}`}
            geometry={group.geometry}
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
    </>
  )
}
