import axios, {
  type AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

// ---------------------------------------------------------------------------
// Types matching the backend envelope shapes
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface ListMeta {
  page: number
  pageSize: number
  total: number
}

export interface ListResponse<T> {
  data: T[]
  meta: ListMeta
}

export class ApiRequestError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.code = body.code
    this.status = status
    this.details = body.details
  }
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// ---------------------------------------------------------------------------
// Auth token management (in-memory only — never localStorage)
// ---------------------------------------------------------------------------

let accessToken: string | null = null
let tokenExpiresAt: number | null = null
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null

export function setAccessToken(token: string | null, expiresIn?: number) {
  accessToken = token

  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer)
    proactiveRefreshTimer = null
  }

  if (token && expiresIn) {
    tokenExpiresAt = Date.now() + expiresIn * 1000
    scheduleProactiveRefresh(expiresIn)
  } else {
    tokenExpiresAt = null
  }
}

export function getAccessToken(): string | null {
  return accessToken
}

function scheduleProactiveRefresh(expiresIn: number) {
  const refreshInMs = Math.max((expiresIn - 60) * 1000, 0)
  proactiveRefreshTimer = setTimeout(() => {
    proactiveRefreshTimer = null
    silentRefresh().catch(() => {
      // Proactive refresh failed — the response interceptor will handle
      // the next 401 or the session-expired flow will kick in.
    })
  }, refreshInMs)
}

// ---------------------------------------------------------------------------
// Silent refresh logic
// ---------------------------------------------------------------------------

let refreshPromise: Promise<string> | null = null
let onSessionExpired: (() => void) | null = null
let onAccountDisabled: (() => void) | null = null

export function setOnSessionExpired(cb: () => void) {
  onSessionExpired = cb
}

export function setOnAccountDisabled(cb: () => void) {
  onAccountDisabled = cb
}

const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/register']
function isAuthRequest(url: string | undefined): boolean {
  if (!url) return false
  return AUTH_PATHS.some((p) => url.endsWith(p))
}

async function silentRefresh(): Promise<string> {
  const res = await api.post<{ accessToken: string; expiresIn: number }>('/auth/refresh')
  const { accessToken: newToken, expiresIn } = res.data
  setAccessToken(newToken, expiresIn)
  return newToken
}

function doRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = silentRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

// Attach Bearer header when a token exists
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// ---------------------------------------------------------------------------
// Response interceptor — silent refresh on 401, then surface errors
// ---------------------------------------------------------------------------

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const originalConfig = error.config
    const status = error.response?.status
    const code = error.response?.data?.error?.code

    if (
      status === 401 &&
      originalConfig &&
      !isAuthRequest(originalConfig.url) &&
      !(originalConfig as InternalAxiosRequestConfig & { _retried?: boolean })._retried
    ) {
      (originalConfig as InternalAxiosRequestConfig & { _retried?: boolean })._retried = true

      try {
        const newToken = await doRefresh()
        originalConfig.headers.Authorization = `Bearer ${newToken}`
        return api(originalConfig)
      } catch (refreshError) {
        const refreshErr = refreshError as AxiosError<ApiErrorBody>
        const refreshCode = refreshErr?.response?.data?.error?.code
          ?? (refreshError instanceof ApiRequestError ? (refreshError as ApiRequestError).code : undefined)

        if (refreshCode === 'REFRESH_TOKEN_INVALID') {
          setAccessToken(null)
          onSessionExpired?.()
        }

        return Promise.reject(refreshError)
      }
    }

    if (status === 403 && code === 'ACCOUNT_DISABLED') {
      setAccessToken(null)
      onAccountDisabled?.()
    }

    if (error.response?.data?.error) {
      const body = error.response.data.error
      return Promise.reject(new ApiRequestError(status!, body))
    }
    return Promise.reject(error)
  },
)

// ---------------------------------------------------------------------------
// Typed request helpers
// ---------------------------------------------------------------------------

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<T>(url, { params })
  return res.data
}

export async function getList<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<ListResponse<T>> {
  const res = await api.get<ListResponse<T>>(url, { params })
  return res.data
}

export async function post<T>(url: string, data?: unknown): Promise<T> {
  const res = await api.post<T>(url, data)
  return res.data
}

export async function put<T>(url: string, data?: unknown): Promise<T> {
  const res = await api.put<T>(url, data)
  return res.data
}

export async function patch<T>(url: string, data?: unknown): Promise<T> {
  const res = await api.patch<T>(url, data)
  return res.data
}

export async function del(url: string): Promise<void> {
  await api.delete(url)
}

export default api
