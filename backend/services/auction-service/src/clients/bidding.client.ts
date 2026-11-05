// The synchronous call to bidding-service for cancelling a published auction (docs/events.md §8).
import {
  ConflictError,
  REQUEST_ID_HEADER,
  ServiceUnavailableError,
  getCorrelationId,
  type Logger,
} from '@auction/shared-common';

export interface BiddingClient {
  /**
   * Asks bidding-service to stop the auction. Bidding decides under the same row lock as place-bid,
   * so a cancel and a bid arriving together cannot both succeed.
   * Throws ConflictError if bidding refuses, and ServiceUnavailableError if it cannot answer.
   */
  cancelAuction(
    auctionId: string,
    request: { cancelledBy: string; isAdmin: boolean },
  ): Promise<void>;
}

const REFUSALS: Record<string, string> = {
  AUCTION_HAS_BIDS: 'This auction already has bids, so it can no longer be cancelled',
  AUCTION_CLOSED: 'This auction is already closed',
};

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

export function createBiddingClient(options: {
  baseUrl: string;
  timeoutMs: number;
  logger: Logger;
}): BiddingClient {
  const { baseUrl, timeoutMs, logger } = options;
  const unavailable = () => new ServiceUnavailableError('Bidding service is unavailable');

  return {
    async cancelAuction(auctionId, request) {
      let response: Response;
      try {
        response = await fetch(new URL(`/internal/auctions/${auctionId}/cancel`, baseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [REQUEST_ID_HEADER]: getCorrelationId() ?? '',
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        logger.warn({ err, auctionId }, 'bidding-service did not answer the cancel call');
        throw unavailable();
      }

      // 404: bidding has not seen auction.published yet, so no bid can exist (docs/events.md §8).
      if (response.status === 204 || response.status === 404) {
        return;
      }
      const code = response.status === 409 ? await readErrorCode(response) : undefined;
      const message = code === undefined ? undefined : REFUSALS[code];
      if (code !== undefined && message !== undefined) {
        throw new ConflictError(code, message);
      }
      logger.warn({ status: response.status, auctionId }, 'unexpected answer to the cancel call');
      throw unavailable();
    },
  };
}
