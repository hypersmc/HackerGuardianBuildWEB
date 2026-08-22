import { WebGPURenderer } from 'three/webgpu'

export type WebGpuProbe =
  | {
      supported: true
      adapterLabel: string | null
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
}

let probePromise: Promise<WebGpuProbe> | null = null

/**
 * Probe the browser/runtime rather than browser-sniffing. The replay renderer is
 * intentionally WebGPU-only; an available WebGL2 context is not accepted as a
 * substitute because large evidence replays need the modern renderer path.
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
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter) {
        return {
          supported: false,
          code: 'adapter-unavailable',
          message: 'WebGPU is exposed, but no usable GPU adapter could be acquired. Check browser GPU/hardware-acceleration settings.',
        }
      }

      const info = (adapter as AdapterInfo).info
      const label = [info?.vendor, info?.architecture, info?.device]
        .filter((value): value is string => Boolean(value))
        .join(' · ')

      return {
        supported: true,
        adapterLabel: label || info?.description || null,
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
      // not accept that fallback for the fidelity replay path. Check Three's stable
      // backend capability flag rather than constructor names, which minifiers can
      // rewrite in production builds.
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
