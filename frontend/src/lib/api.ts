import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'

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
})

// ---------------------------------------------------------------------------
// Auth token management (in-memory only — never localStorage)
// ---------------------------------------------------------------------------

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

// Attach Bearer header when a token exists
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// ---------------------------------------------------------------------------
// Response interceptor — unwrap data, surface errors
// ---------------------------------------------------------------------------

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError<ApiErrorBody>) => {
    if (error.response?.data?.error) {
      const { status } = error.response
      const body = error.response.data.error
      return Promise.reject(new ApiRequestError(status, body))
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
