import { useEffect, useState, type ReactNode } from 'react'
import { probeRequiredWebGpu, type WebGpuProbe } from '../features/replays/webgpuSupport'
import '../styles/replay-engine.css'

export function WebGpuRouteGuard({ children }: { children: ReactNode }) {
  const [probe, setProbe] = useState<WebGpuProbe | null>(null)

  useEffect(() => {
    let cancelled = false
    void probeRequiredWebGpu().then((result) => {
      if (!cancelled) setProbe(result)
    })
    return () => { cancelled = true }
  }, [])

  if (!probe) {
    return (
      <div className="webgpu-route-guard">
        <span>REPLAY ENGINE</span>
        <h1>Checking WebGPU</h1>
        <p>HackerGuardian is probing for a hardware-accelerated WebGPU adapter before loading replay evidence.</p>
      </div>
    )
  }

  if (!probe.supported) {
    return (
      <div className="webgpu-route-guard webgpu-route-guard--blocked">
        <span>3D REPLAY UNAVAILABLE</span>
        <h1>WebGPU is required</h1>
        <p>{probe.message}</p>
        <div className="webgpu-route-guard__note">
          The rest of HackerGuardian remains available. Only the Minecraft-faithful 3D replay viewer requires WebGPU; WebGL fallback is intentionally disabled.
        </div>
      </div>
    )
  }

  return children
}
