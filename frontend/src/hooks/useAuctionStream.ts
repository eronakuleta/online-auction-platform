// Follows one auction live with the browser's native EventSource (B-12, docs/events.md §10).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { biddingApi, type AuctionLiveState } from '../api/bidding';
import { newerState } from '../pages/auction-live/live-state';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export const liveKeys = {
  state: (auctionId: string) => ['auction-live', auctionId, 'state'] as const,
  bids: (auctionId: string) => ['auction-live', auctionId, 'bids'] as const,
};

/** How often the state is asked for again while the stream is not delivering it. */
export const FALLBACK_POLL_MS = 5000;

/**
 * Opens the stream while `enabled` and writes every state it receives into the query cache, so the
 * page reads one place whether the data came from a request or from the stream.
 *
 * - The browser reconnects by itself after a dropped connection ("reconnecting"); the server asks
 *   for a 3 second pause. A permanent failure ends in "closed".
 * - Whenever the stream is not "live", the state is asked for again every few seconds, so the page
 *   never goes stale. The polling stops as soon as the stream delivers.
 * - The effects close the connection and stop the timer when the page is left, the auction changes
 *   or the auction ends, so nothing is left running behind the user.
 */
export function useAuctionStream(auctionId: string, enabled: boolean): StreamStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(biddingApi.streamUrl(auctionId));

    source.onopen = () => setStatus('live');
    source.addEventListener('state', (event) => {
      let incoming: AuctionLiveState;
      try {
        incoming = JSON.parse((event as MessageEvent<string>).data) as AuctionLiveState;
      } catch {
        return; // An unreadable event is ignored; the next one carries the full state again.
      }
      const key = liveKeys.state(auctionId);
      const before = queryClient.getQueryData<AuctionLiveState>(key);
      queryClient.setQueryData<AuctionLiveState>(key, (current) => newerState(current, incoming));
      // A new bid changes the history, so it is read again rather than patched by hand.
      if (before === undefined || incoming.bidCount !== before.bidCount) {
        void queryClient.invalidateQueries({ queryKey: liveKeys.bids(auctionId) });
      }
    });
    source.onerror = () => {
      // CONNECTING: the browser is trying again. CLOSED: it gave up (for example a 404).
      setStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
    };

    return () => source.close();
  }, [auctionId, enabled, queryClient]);

  const live = enabled && status === 'live';

  useEffect(() => {
    if (!enabled || live) return;
    const timer = setInterval(() => {
      void queryClient.refetchQueries({ queryKey: liveKeys.state(auctionId) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.bids(auctionId) });
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [auctionId, enabled, live, queryClient]);

  return enabled ? status : 'closed';
}
