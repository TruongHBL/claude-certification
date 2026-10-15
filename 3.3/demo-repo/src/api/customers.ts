// Handler API khách hàng.
export interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string; requestId: string } | null;
  meta: Record<string, unknown>;
}

export function getCustomer(id: string, requestId: string): Envelope<{ id: string }> {
  if (!/^CUS-\d{4}$/.test(id)) {
    return { data: null, error: { code: "VALIDATION", message: "id sai định dạng", requestId }, meta: {} };
  }
  return { data: { id }, error: null, meta: {} };
}
