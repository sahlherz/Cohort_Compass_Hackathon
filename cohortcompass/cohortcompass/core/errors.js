// One consistent error shape (schemas/error.schema.json) for core, HTTP and MCP.
export class CCError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}
export const notFound = (what, id) => new CCError('NOT_FOUND', `${what} not found: ${id}`);
export const badRequest = (message, extra) => new CCError('BAD_REQUEST', message, extra);
export function toErrorJSON(e) {
  if (e instanceof CCError) return e.toJSON();
  return { error: { code: 'INTERNAL', message: String(e?.message || e), retryable: false } };
}
