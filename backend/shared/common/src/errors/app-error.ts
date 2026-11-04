// Errors a service throws on purpose. The error handler turns them into the standard error body
// (docs/events.md section 9), so controllers and services never build error responses themselves.

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
    requestId: string;
  };
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];

  constructor(status: number, code: string, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(requestId: string): ErrorBody {
    return {
      error: { code: this.code, message: this.message, details: this.details, requestId },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', details: ErrorDetail[] = [], code = 'VALIDATION_ERROR') {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to do this', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

/** A state conflict. The code is required, because clients switch on it (`BID_TOO_LOW`, ...). */
export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMITED') {
    super(429, code, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A required service is unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}
