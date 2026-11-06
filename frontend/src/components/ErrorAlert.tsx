import { Alert, AlertTitle } from '@mui/material';
import { ApiError } from '../api/client';

/**
 * Shows a failed request the way the server described it: its error code and message (the server
 * is the authority on business rules), field problems if any, and the request ID for support.
 */
export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  if (!(error instanceof ApiError)) {
    return <Alert severity="error">{title ?? 'Something went wrong. Please try again.'}</Alert>;
  }
  const fields = error.details.filter(
    (detail): detail is { path: string; message: string } =>
      typeof detail === 'object' && detail !== null && 'path' in detail && 'message' in detail,
  );
  return (
    <Alert severity="error">
      <AlertTitle>{title ?? error.code}</AlertTitle>
      {error.message}
      {fields.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
          {fields.map((field) => (
            <li key={field.path}>
              {field.path}: {field.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
