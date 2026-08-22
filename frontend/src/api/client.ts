export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function csrf(): Promise<void> {
  await fetch('/sanctum/csrf-cookie', { credentials: 'include' })
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) await csrf()

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(response.status, body.message ?? 'Request failed')
  }

  return body as T
}
