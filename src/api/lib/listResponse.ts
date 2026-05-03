/**
 * Helper to shape collection responses per api_design §5.1.
 *
 * Single-resource reads are bare `<T>`; this module is only relevant to list
 * endpoints, which always emit `{ data, meta: { page, pageSize, total } }`.
 */

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}

export function buildListResponse<T>(
  rows: T[],
  meta: ListMeta,
): ListResponse<T> {
  return { data: rows, meta };
}
