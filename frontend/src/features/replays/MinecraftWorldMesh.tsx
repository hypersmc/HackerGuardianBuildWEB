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
        const translucent = group.layer === 'translucent'
        return (
          <mesh
            key={`${prefix}:${group.key}`}
            geometry={group.geometry}
            renderOrder={translucent ? 2 : group.layer === 'cutout' ? 1 : 0}
          >
            <meshStandardMaterial
              map={texture ?? undefined}
              vertexColors
              roughness={texture ? 0.9 : 0.88}
              metalness={0}
              // Minecraft has many alpha-cut textures whose block id is not enough
              // to infer the render layer (poppy/dandelion are common examples).
              // Apply an alpha discard to every ordinary textured surface: fully
              // opaque terrain is unaffected while transparent PNG pixels no longer
              // render as black quads.
              alphaTest={texture ? (translucent ? 0.01 : 0.5) : 0}
              transparent={translucent}
              // Preserve the resource-pack alpha instead of applying an arbitrary
              // scene-wide 0.76 opacity to glass/water textures.
              opacity={1}
              depthWrite={!translucent}
            />
          </mesh>
        )
      })}
    </>
  )
}
