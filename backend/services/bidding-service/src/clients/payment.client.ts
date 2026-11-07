// The synchronous funds check against payment-service (B-10, decision Q10 in docs/requirements.md):
//   GET /internal/funds-check?userId=<uuid>&amountCents=<int>
//   200 { userId, amountCents, balanceCents, sufficient } | 404 WALLET_NOT_FOUND | 400
// It runs before the bid transaction, so the row lock is never held during a network call.
import {
  REQUEST_ID_HEADER,
  ServiceUnavailableError,
  getCorrelationId,
  type Logger,
} from '@auction/shared-common';

export type FundsCheckResult = 'SUFFICIENT' | 'INSUFFICIENT' | 'NO_WALLET';

export interface PaymentClient {
  /** Throws ServiceUnavailableError if payment-service cannot answer. */
  checkFunds(userId: string, amountCents: number): Promise<FundsCheckResult>;
}

/** Errors worth one more try: the request never reached a healthy service. */
class RetryableError extends Error {}

export function createPaymentClient(options: {
  baseUrl: string;
  timeoutMs: number;
  logger: Logger;
  /** Attempts in total. A second attempt only follows a quick failure, never a timeout. */
  attempts?: number;
}): PaymentClient {
  const { baseUrl, timeoutMs, logger, attempts = 2 } = options;

  const attempt = async (userId: string, amountCents: number): Promise<FundsCheckResult> => {
    const url = new URL('/internal/funds-check', baseUrl);
    url.searchParams.set('userId', userId);
    url.searchParams.set('amountCents', String(amountCents));
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { [REQUEST_ID_HEADER]: getCorrelationId() ?? '' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // A timeout already used the whole budget, so it is not retried: the bidder would wait twice.
      if ((err as Error).name === 'TimeoutError') {
        throw err;
      }
      throw new RetryableError((err as Error).message);
    }
    if (response.status === 200) {
      const body = (await response.json()) as { sufficient?: unknown };
      if (typeof body.sufficient !== 'boolean') {
        throw new Error('funds check answered without "sufficient"');
      }
      return body.sufficient ? 'SUFFICIENT' : 'INSUFFICIENT';
    }
    if (response.status === 404) {
      return 'NO_WALLET';
    }
    if (response.status >= 500) {
      throw new RetryableError(`payment-service answered ${response.status}`);
    }
    throw new Error(`unexpected funds check answer ${response.status}`);
  };

  return {
    async checkFunds(userId, amountCents) {
      for (let i = 1; ; i += 1) {
        try {
          return await attempt(userId, amountCents);
        } catch (err) {
          if (err instanceof RetryableError && i < attempts) {
            logger.warn({ err, userId, attempt: i }, 'funds check failed, trying once more');
            continue;
          }
          logger.warn({ err, userId, amountCents }, 'funds check unavailable');
          throw new ServiceUnavailableError('Payment service is unavailable, please try again');
        }
      }
    },
  };
}
