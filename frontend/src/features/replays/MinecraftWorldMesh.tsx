import { memo, useEffect, useMemo } from 'react'
import type { Texture } from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import { buildMinecraftGeometry } from './minecraftModels'
import {
  applySectionAtTime,
  sectionWorldRevision,
  type ReplayWorldSection,
} from './replaySections'
import type { TimedReplayEvent } from './voxel'

type Origin = { x: number; y: number; z: number }

type Props = {
  sections: ReplayWorldSection[]
  eventsBySection: ReadonlyMap<string, TimedReplayEvent[]>
  playhead: number
  origin: Origin
  catalog: MinecraftAssetCatalog
  textures: ReadonlyMap<string, Texture>
}

const NO_EVENTS: TimedReplayEvent[] = []

export const MinecraftWorldMesh = memo(function MinecraftWorldMesh({ sections, eventsBySection, playhead, origin, catalog, textures }: Props) {
  return (
    <group position={[-origin.x, -origin.y, -origin.z]}>
      {sections.map((section) => (
        <MinecraftSectionMesh
          key={section.key}
          section={section}
          events={eventsBySection.get(section.key) ?? NO_EVENTS}
          playhead={playhead}
          catalog={catalog}
          textures={textures}
        />
      ))}
    </group>
  )
})

function MinecraftSectionMesh({
  section,
  events,
  playhead,
  catalog,
  textures,
}: {
  section: ReplayWorldSection
  events: TimedReplayEvent[]
  playhead: number
  catalog: MinecraftAssetCatalog
  textures: ReadonlyMap<string, Texture>
}) {
  const revision = sectionWorldRevision(events, playhead, section.anchorMs)
  const world = useMemo(
    () => applySectionAtTime(section.blocks, events, playhead, section.anchorMs),
    // playhead intentionally does not participate directly: a section is rebuilt
    // only when its visible block-event revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section.blocks, events, section.anchorMs, revision],
  )
  const groups = useMemo(() => buildMinecraftGeometry(world, catalog), [world, catalog])

  useEffect(() => () => {
    for (const group of groups) group.geometry.dispose()
  }, [groups])

  return (
    <group>
      {groups.map((group) => {
        const texture = group.texture ? textures.get(group.texture) : null
        return (
          <mesh
            key={group.key}
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
    </group>
  )
}
