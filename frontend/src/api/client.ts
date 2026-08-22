export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function cookie(name: string): string | null {
  const prefix = `${name}=`
  const value = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)

  return value ? decodeURIComponent(value) : null
}

async function csrf(): Promise<string> {
  const response = await fetch('/sanctum/csrf-cookie', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new ApiError(response.status, 'Unable to initialize the secure session')
  }

  const token = cookie('XSRF-TOKEN')
  if (!token) {
    throw new ApiError(419, 'Secure session token was not issued')
  }

  return token
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const xsrfToken = stateChanging ? await csrf() : null

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : {}),
      ...(init.headers ?? {}),
    },
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(response.status, body.message ?? 'Request failed')
  }

  return body as T
}
