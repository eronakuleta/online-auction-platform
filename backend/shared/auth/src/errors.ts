// Why a token was rejected. The HTTP middleware (added once the shared error classes from
// B-02 exist) maps every reason to 401 with a generic message, so callers learn nothing more.

export type TokenRejectionReason = 'MISSING' | 'MALFORMED' | 'EXPIRED' | 'INVALID';

export class TokenVerificationError extends Error {
  readonly reason: TokenRejectionReason;

  constructor(reason: TokenRejectionReason, message: string) {
    super(message);
    this.name = 'TokenVerificationError';
    this.reason = reason;
  }
}
