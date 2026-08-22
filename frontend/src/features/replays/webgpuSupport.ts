import { WebGPURenderer } from 'three/webgpu'

export type WebGpuProbe =
  | {
      supported: true
      adapterLabel: string | null
      featureLevel: 'core' | 'compatibility'
    }
  | {
      supported: false
      code: 'insecure-context' | 'api-unavailable' | 'adapter-unavailable' | 'probe-failed'
      message: string
    }

type NavigatorGpu = {
  requestAdapter(options?: unknown): Promise<unknown | null>
}

type NavigatorWithGpu = Navigator & {
  gpu?: NavigatorGpu
}

type AdapterInfo = {
  info?: {
    vendor?: string
    architecture?: string
    device?: string
    description?: string
  }
  features?: {
    has(feature: string): boolean
  }
}

let probePromise: Promise<WebGpuProbe> | null = null

/**
 * Probe the browser/runtime rather than browser-sniffing. Three r183+ deliberately
 * requests WebGPU compatibility mode first and upgrades to core capabilities when
 * the selected adapter exposes them. Mirror that behavior here instead of requiring
 * a core/high-performance adapter up front; Chromium on Linux can expose a valid
 * hardware WebGPU compatibility adapter while a core request returns null.
 */
export function probeRequiredWebGpu(): Promise<WebGpuProbe> {
  if (probePromise) return probePromise

  probePromise = (async () => {
    if (!window.isSecureContext) {
      return {
        supported: false,
        code: 'insecure-context',
        message: 'WebGPU requires a secure context. Use HTTPS (localhost is allowed for development).',
      }
    }

    const gpu = (navigator as NavigatorWithGpu).gpu
    if (!gpu) {
      return {
        supported: false,
        code: 'api-unavailable',
        message: 'This browser/OS does not expose WebGPU. Use a WebGPU-capable browser with hardware acceleration enabled.',
      }
    }

    try {
      // featureLevel=compatibility is intentionally the lowest WebGPU feature level
      // the replay renderer can start from. On modern Vulkan/D3D/Metal adapters the
      // returned adapter still exposes core-features-and-limits and Three upgrades
      // to the core path. On Chromium/Linux this also permits Dawn's hardware GLES
      // compatibility backend when Vulkan is not the active browser graphics path.
      const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' })
      if (!adapter) {
        return {
          supported: false,
          code: 'adapter-unavailable',
          message: 'WebGPU is exposed, but Chromium did not return even a compatibility-level GPU adapter. Check chrome://gpu, browser GPU flags and hardware acceleration.',
        }
      }

      const typedAdapter = adapter as AdapterInfo
      const info = typedAdapter.info
      const label = [info?.vendor, info?.architecture, info?.device]
        .filter((value): value is string => Boolean(value))
        .join(' · ')
      const featureLevel = typedAdapter.features?.has('core-features-and-limits') ? 'core' : 'compatibility'

      return {
        supported: true,
        adapterLabel: label || info?.description || null,
        featureLevel,
      }
    } catch (error) {
      return {
        supported: false,
        code: 'probe-failed',
        message: error instanceof Error ? error.message : 'WebGPU adapter probing failed.',
      }
    }
  })()

  return probePromise
}

const rendererPromises = new WeakMap<HTMLCanvasElement, Promise<WebGPURenderer>>()

/**
 * React Three Fiber can invoke an async renderer factory more than once while the
 * first factory call is still awaiting WebGPU initialization. Cache the promise by
 * canvas so one canvas can never end up with two competing GPU renderers.
 */
export async function createRequiredWebGpuRenderer(defaults: Record<string, unknown>) {
  const canvas = defaults.canvas
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('HackerGuardian replay renderer did not receive a valid canvas.')
  }

  const existing = rendererPromises.get(canvas)
  if (existing) return existing

  const promise = (async () => {
    const probe = await probeRequiredWebGpu()
    if (!probe.supported) throw new Error(probe.message)

    const renderer = new WebGPURenderer({
      ...defaults,
      canvas,
      antialias: false,
      alpha: false,
    } as ConstructorParameters<typeof WebGPURenderer>[0])

    try {
      await renderer.init()
      const backend = (renderer as unknown as {
        backend?: { isWebGPUBackend?: boolean }
      }).backend

      // WebGPURenderer can use a WebGL2 backend. HackerGuardian deliberately does
      // not accept that fallback for the fidelity replay path. Compatibility mode
      // is still WebGPU and therefore passes this check; only Three's WebGL backend
      // is rejected.
      if (backend?.isWebGPUBackend !== true) {
        renderer.dispose()
        throw new Error('WebGPU initialization fell back to a non-WebGPU backend. WebGL fallback is disabled for 3D replay evidence.')
      }

      return renderer
    } catch (error) {
      renderer.dispose()
      throw error
    }
  })()

  rendererPromises.set(canvas, promise)
  try {
    return await promise
  } catch (error) {
    rendererPromises.delete(canvas)
    throw error
  }
}
