// B-20: how a bid is labelled on the "My bids" page.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { LiveStatus, MyBid } from '../../api/bidding.ts';
import { bidStanding } from './bid-standing.ts';

function bid(auctionStatus: LiveStatus, isHighest: boolean): MyBid {
  return {
    id: 'b1',
    auctionId: 'a1',
    bidderId: 'u1',
    amountCents: 2000,
    sequence: 1,
    placedAt: '2026-11-08T10:00:00.000Z',
    title: 'Lamp',
    currency: 'EUR',
    auctionStatus,
    endsAt: '2026-11-09T10:00:00.000Z',
    isHighest,
  };
}

describe('bidStanding', () => {
  test('an open auction: winning if it is the highest bid, otherwise not the highest', () => {
    assert.deepEqual(bidStanding(bid('OPEN', true)), { label: 'Winning', color: 'success' });
    assert.deepEqual(bidStanding(bid('OPEN', false)), {
      label: 'Not the highest',
      color: 'warning',
    });
  });

  test('a sold auction: won or lost', () => {
    assert.equal(bidStanding(bid('CLOSED_SOLD', true)).label, 'Won');
    assert.equal(bidStanding(bid('CLOSED_SOLD', false)).label, 'Lost');
  });

  test('no sale and cancelled do not depend on whether it was the highest bid', () => {
    for (const isHighest of [true, false]) {
      assert.equal(bidStanding(bid('CLOSED_NO_SALE', isHighest)).label, 'No sale');
      assert.equal(bidStanding(bid('CANCELLED', isHighest)).label, 'Cancelled');
    }
  });
});
