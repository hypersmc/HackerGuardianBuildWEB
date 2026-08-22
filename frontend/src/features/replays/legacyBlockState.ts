import type { MinecraftAssetCatalog } from './minecraftAssets'
import type { TimedReplayEvent } from './voxel'
import { normalizeState } from './voxel'

/**
 * Older replay events stored only a Bukkit Material name (for example
 * `GRASS_BLOCK`) instead of the complete BlockData string. The evidence cannot
 * recover the missing properties, but the renderer can choose a deterministic
 * valid variant from the matching Minecraft blockstate so the block still uses
 * the real model/textures instead of the diagnostic grey cube.
 *
 * New replays containing explicit `[property=value]` BlockData are never changed.
 */
export function resolveLegacyRenderState(raw: string, catalog: MinecraftAssetCatalog) {
  const normalized = normalizeState(raw)
  if (normalized.includes('[')) return normalized

  const definition = catalog.blockstates[normalized]
  if (!definition?.variants) return normalized

  const keys = Object.keys(definition.variants)
  if (keys.length === 0 || keys.includes('')) return normalized

  const condition = [...keys].sort((a, b) => legacyVariantScore(b) - legacyVariantScore(a))[0]
  if (!condition) return normalized
  return `${normalized}[${condition}]`
}

export function normalizeLegacyReplayEvents(events: TimedReplayEvent[], catalog: MinecraftAssetCatalog) {
  let changed = false
  const result = events.map((event) => {
    let block = event.block
    let previousBlock = event.previous_block

    if (typeof block === 'string') {
      const resolved = resolveLegacyRenderState(block, catalog)
      if (resolved !== block) {
        block = resolved
        changed = true
      }
    }

    if (typeof previousBlock === 'string') {
      const resolved = resolveLegacyRenderState(previousBlock, catalog)
      if (resolved !== previousBlock) {
        previousBlock = resolved
        changed = true
      }
    }

    if (block === event.block && previousBlock === event.previous_block) return event
    return { ...event, block, previous_block: previousBlock }
  })

  return changed ? result : events
}

function legacyVariantScore(condition: string) {
  let score = 0
  for (const token of condition.split(',')) {
    const [, rawValue = ''] = token.split('=', 2)
    const value = rawValue.toLowerCase()
    if (value === 'false') score += 100
    else if (value === 'none') score += 90
    else if (value === 'bottom') score += 80
    else if (value === 'lower') score += 80
    else if (value === 'straight') score += 70
    else if (value === 'y') score += 65
    else if (value === 'north') score += 60
    else if (value === '0') score += 55
    else score += 1
  }
  // Prefer concrete variants with fewer assumptions when scores tie.
  score -= Math.max(0, condition.split(',').length - 1)
  return score
}
