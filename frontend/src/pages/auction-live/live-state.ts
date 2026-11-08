// Small pure helpers of the live auction page. No React and no network, so they are easy to read.
import type { AuctionLiveState } from '../../api/bidding';

/**
 * An update replaces what the page shows only if its version is higher. Two paths bring the state
 * (the first load and the stream) and they can arrive in any order, so without this an older state
 * could overwrite a newer one and the page would briefly show a bid that is already outbid.
 */
export function newerState(
  current: AuctionLiveState | undefined,
  incoming: AuctionLiveState,
): AuctionLiveState {
  return current === undefined || incoming.version > current.version ? incoming : current;
}

/** "2d 03:04:05", "00:04:05", or "Ended" at zero. Never shows a negative time. */
export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return 'Ended';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

/** In the last 30 seconds the countdown is highlighted (anti-sniping window, ROADMAP §4). */
export const ENDING_SOON_MS = 30_000;

/** True if the logged-in user holds the highest bid. The state alone cannot say who was outbid. */
export function isLeading(state: AuctionLiveState, userId: string | undefined): boolean {
  return userId !== undefined && state.highestBidderId === userId;
}

/** A short anonymous label for a bidder: the page shows no names (only the user's own bids). */
export function bidderLabel(bidderId: string, userId: string | undefined): string {
  return bidderId === userId ? 'You' : `Bidder ${bidderId.slice(-4)}`;
}

/** True once the auction's start time has passed. Bids before that are refused by the server. */
export function hasStarted(state: AuctionLiveState, now: number): boolean {
  return state.startsAt === null || Date.parse(state.startsAt) <= now;
}
