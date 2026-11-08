// Holds the open SSE connections of this replica and writes events to them (B-12).
// Event format (text/event-stream):
//   id: <version>        lets the page drop an update older than one it already has
//   event: state
//   data: <public state JSON, as GET /auctions/:id/state>
// A comment line every heartbeat keeps proxies from closing an idle connection.
import type { Logger } from '@auction/shared-common';
import type { Response } from 'express';
import type { AuctionState } from '../repositories/bidding.repository';
import { toAuctionStateResponse } from './bid.controller';

export interface StreamHub {
  /** Starts the SSE response, sends the current state, and keeps the connection until it closes. */
  open(res: Response, current: AuctionState, onClose: (listener: () => void) => void): void;
  /** Sends the state to everyone watching that auction on this replica. */
  deliver(state: AuctionState): void;
  /** Open connections, for tests and logs. */
  size(auctionId?: string): number;
  /** Ends every stream, for shutdown. */
  closeAll(): void;
}

function formatState(state: AuctionState): string {
  return `id: ${state.version}\nevent: state\ndata: ${JSON.stringify(toAuctionStateResponse(state))}\n\n`;
}

export function createStreamHub(options: { logger: Logger; heartbeatMs?: number }): StreamHub {
  const { logger, heartbeatMs = 15_000 } = options;
  const viewers = new Map<string, Set<Response>>();

  const heartbeat = setInterval(() => {
    for (const set of viewers.values()) {
      for (const res of set) {
        res.write(': heartbeat\n\n');
      }
    }
  }, heartbeatMs);
  // The timer alone must not keep the process (or a test run) alive.
  heartbeat.unref();

  const remove = (auctionId: string, res: Response) => {
    const set = viewers.get(auctionId);
    set?.delete(res);
    if (set?.size === 0) {
      viewers.delete(auctionId);
    }
  };

  return {
    open(res, current, onClose) {
      const { auctionId } = current;
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Tells Nginx not to buffer this response, so each event reaches the browser at once.
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      // The browser waits 3 s before reconnecting after a dropped connection.
      res.write('retry: 3000\n\n');
      res.write(formatState(current));

      const set = viewers.get(auctionId) ?? new Set<Response>();
      set.add(res);
      viewers.set(auctionId, set);
      logger.debug({ auctionId, viewers: set.size }, 'stream opened');
      onClose(() => {
        remove(auctionId, res);
        logger.debug({ auctionId }, 'stream closed');
      });
    },

    deliver(state) {
      const set = viewers.get(state.auctionId);
      if (set === undefined) {
        return;
      }
      const event = formatState(state);
      for (const res of set) {
        res.write(event);
      }
    },

    size(auctionId) {
      if (auctionId !== undefined) {
        return viewers.get(auctionId)?.size ?? 0;
      }
      let total = 0;
      for (const set of viewers.values()) {
        total += set.size;
      }
      return total;
    },

    closeAll() {
      clearInterval(heartbeat);
      for (const set of viewers.values()) {
        for (const res of set) {
          res.end();
        }
      }
      viewers.clear();
    },
  };
}
