import { api } from './client'

export type HgMeta = {
  api_version: number
  time_ms: number
}

export type HgSuccess<T> = {
  ok: true
  data: T
  meta: HgMeta
}

export type HgFailure = {
  ok: false
  error: {
    code: string
    message: string
  }
  meta: HgMeta
}

export async function hg<T>(path: string): Promise<T> {
  const envelope = await api<HgSuccess<T> | HgFailure>(path)
  if (!envelope.ok) throw new Error(envelope.error.message)
  return envelope.data
}
