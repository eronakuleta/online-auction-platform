// Why a token was rejected. authenticate() maps every reason to the same generic 401, so callers
// learn nothing more.

export type TokenRejectionReason = 'MISSING' | 'MALFORMED' | 'EXPIRED' | 'INVALID';

export class TokenVerificationError extends Error {
  readonly reason: TokenRejectionReason;

  constructor(reason: TokenRejectionReason, message: string) {
    super(message);
    this.name = 'TokenVerificationError';
    this.reason = reason;
  }
}
