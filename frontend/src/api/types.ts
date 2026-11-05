// Shapes shared by every backend service (see CLAUDE.md, API conventions).

/** Standard error body returned by the shared backend error handler. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown[];
    requestId?: string;
  };
}

/** Standard paginated list response: `?page=1&size=20`. */
export interface Page<T> {
  data: T[];
  page: number;
  size: number;
  total: number;
}

/** Money is always integer cents plus a currency code. */
export interface Money {
  amountCents: number;
  currency: string;
}
