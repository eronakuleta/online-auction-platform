// B-20: the pure helpers of the live auction page. Run with `npm test -w frontend` (Node's built-in
// test runner, no extra packages).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AuctionLiveState } from '../../api/bidding.ts';
import {
  ENDING_SOON_MS,
  bidderLabel,
  formatRemaining,
  hasStarted,
  isLeading,
  newerState,
} from './live-state.ts';

function state(overrides: Partial<AuctionLiveState> = {}): AuctionLiveState {
  return {
    auctionId: 'a1',
    title: 'Lamp',
    sellerId: 'seller',
    status: 'OPEN',
    currency: 'EUR',
    highestBidCents: 2000,
    highestBidderId: 'bidder-1',
    bidCount: 1,
    minimumNextBidCents: 2200,
    startsAt: '2026-11-08T10:00:00.000Z',
    endsAt: '2026-11-09T10:00:00.000Z',
    extensionCount: 0,
    version: 1,
    ...overrides,
  };
}

describe('newerState', () => {
  test('takes the first state it gets', () => {
    const first = state();
    assert.equal(newerState(undefined, first), first);
  });

  test('replaces the state when the incoming version is higher', () => {
    const current = state({ version: 3 });
    const incoming = state({ version: 4, highestBidCents: 2200 });
    assert.equal(newerState(current, incoming), incoming);
  });

  test('keeps the current state when the incoming one is older', () => {
    const current = state({ version: 5, highestBidCents: 3000 });
    const stale = state({ version: 4, highestBidCents: 2200 });
    assert.equal(newerState(current, stale), current);
  });

  test('keeps the current state when the version is the same', () => {
    const current = state({ version: 5 });
    assert.equal(newerState(current, state({ version: 5 })), current);
  });
});

describe('formatRemaining', () => {
  test('shows hours, minutes and seconds with leading zeros', () => {
    assert.equal(formatRemaining(3_661_000), '01:01:01');
    assert.equal(formatRemaining(59_000), '00:00:59');
  });

  test('adds the days when there is more than a day left', () => {
    assert.equal(formatRemaining(86_400_000 + 3_723_000), '1d 01:02:03');
    assert.equal(formatRemaining(2 * 86_400_000), '2d 00:00:00');
  });

  test('rounds a partial second down, so it never promises time that is gone', () => {
    assert.equal(formatRemaining(1999), '00:00:01');
  });

  test('says Ended at zero and never shows a negative time', () => {
    assert.equal(formatRemaining(0), 'Ended');
    assert.equal(formatRemaining(-5000), 'Ended');
  });

  test('the highlight window is the 30 seconds of anti-sniping', () => {
    assert.equal(ENDING_SOON_MS, 30_000);
  });
});

describe('isLeading', () => {
  test('is true only for the bidder who holds the highest bid', () => {
    assert.equal(isLeading(state(), 'bidder-1'), true);
    assert.equal(isLeading(state(), 'bidder-2'), false);
  });

  test('is false for a guest and when there is no bid yet', () => {
    assert.equal(isLeading(state(), undefined), false);
    assert.equal(isLeading(state({ highestBidderId: null }), 'bidder-1'), false);
  });
});

describe('bidderLabel', () => {
  test('says You for the user and a short anonymous label for everyone else', () => {
    assert.equal(bidderLabel('u-1', 'u-1'), 'You');
    assert.equal(bidderLabel('00000000-0000-4000-8000-000000000004', 'u-1'), 'Bidder 0004');
  });

  test('tells apart ids that differ only at the end', () => {
    const a = bidderLabel('00000000-0000-4000-8000-000000000003', undefined);
    const b = bidderLabel('00000000-0000-4000-8000-000000000004', undefined);
    assert.notEqual(a, b);
  });
});

describe('hasStarted', () => {
  const now = Date.parse('2026-11-08T12:00:00.000Z');

  test('is true once the start time has passed, and exactly at the start', () => {
    assert.equal(hasStarted(state({ startsAt: '2026-11-08T11:59:59.000Z' }), now), true);
    assert.equal(hasStarted(state({ startsAt: '2026-11-08T12:00:00.000Z' }), now), true);
  });

  test('is false before the start time', () => {
    assert.equal(hasStarted(state({ startsAt: '2026-11-08T12:00:01.000Z' }), now), false);
  });

  test('is true when no start time is known', () => {
    assert.equal(hasStarted(state({ startsAt: null }), now), true);
  });
});
