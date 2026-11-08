// B-14: who is told what for each event. No database: the builder is a pure function.
import {
  fromAuctionCancelled,
  fromAuctionClosed,
  fromBidPlaced,
  fromPaymentCompleted,
  fromPaymentFailed,
  fromUserRegistered,
  formatMoney,
} from '../services/notification-builder';
import {
  ADMIN_ID,
  BIDDER1_ID,
  BIDDER2_ID,
  CAMERA_ID,
  SELLER_ID,
  auctionCancelled,
  auctionNoSale,
  auctionSold,
  bidPlaced,
  paymentCompleted,
  paymentFailed,
  userRegistered,
} from './helpers';

describe('formatMoney', () => {
  it('writes integer cents as a currency amount', () => {
    expect(formatMoney(2400, 'EUR')).toBe('€24.00');
    expect(formatMoney(5, 'EUR')).toBe('€0.05');
    expect(formatMoney(100_000_00, 'EUR')).toBe('€100,000.00');
  });
});

describe('user.registered', () => {
  it('welcomes the new user, naming them, about no auction', () => {
    const [welcome, ...rest] = fromUserRegistered(userRegistered(BIDDER1_ID, 'Anna').payload);
    expect(rest).toEqual([]);
    expect(welcome).toMatchObject({ userId: BIDDER1_ID, type: 'WELCOME', auctionId: null });
    expect(welcome!.message).toContain('Hi Anna');
  });

  it('removes NUL characters, which Postgres text cannot hold', () => {
    const [welcome] = fromUserRegistered(userRegistered(BIDDER1_ID, 'An\0na').payload);
    expect(welcome!.message).toContain('Hi Anna');
    expect(welcome!.message).not.toContain('\0');
  });
});

describe('bid.placed', () => {
  it('tells the previous highest bidder they were outbid, with the new amount', () => {
    const [outbid, ...rest] = fromBidPlaced(bidPlaced().payload);
    expect(rest).toEqual([]);
    expect(outbid).toMatchObject({ userId: BIDDER1_ID, type: 'OUTBID', auctionId: CAMERA_ID });
    expect(outbid!.message).toContain('€60.00');
    expect(outbid!.message).toContain('"Vintage 35mm film camera"');
  });

  it('tells nobody on the first bid', () => {
    expect(fromBidPlaced(bidPlaced({ previousHighestBidderId: null }).payload)).toEqual([]);
  });

  it('does not tell a bidder they outbid themselves', () => {
    expect(fromBidPlaced(bidPlaced({ previousHighestBidderId: BIDDER2_ID }).payload)).toEqual([]);
  });
});

describe('auction.closed, sold', () => {
  it('tells the winner, every loser and the seller, each once', () => {
    const thirdBidder = '00000000-0000-4000-8000-000000000009';
    const result = fromAuctionClosed(
      auctionSold({ losingBidderIds: [BIDDER1_ID, thirdBidder] }).payload,
    );
    expect(result.map((n) => [n.userId, n.type])).toEqual([
      [BIDDER2_ID, 'AUCTION_WON'],
      [BIDDER1_ID, 'AUCTION_LOST'],
      [thirdBidder, 'AUCTION_LOST'],
      [SELLER_ID, 'ITEM_SOLD'],
    ]);
    expect(result.every((n) => n.auctionId === CAMERA_ID)).toBe(true);
    expect(result[0]!.message).toContain('€85.00');
    expect(result[3]!.message).toContain('€85.00');
  });

  it('works when nobody lost', () => {
    const result = fromAuctionClosed(auctionSold({ losingBidderIds: [] }).payload);
    expect(result.map((n) => n.type)).toEqual(['AUCTION_WON', 'ITEM_SOLD']);
  });
});

describe('auction.closed, no sale', () => {
  it('tells the seller when nobody bid', () => {
    const result = fromAuctionClosed(auctionNoSale('NO_BIDS').payload);
    expect(result.map((n) => [n.userId, n.type])).toEqual([[SELLER_ID, 'NO_SALE']]);
    expect(result[0]!.message).toContain('received no bids');
  });

  it('tells every bidder they lost and the seller the reserve was not met', () => {
    const result = fromAuctionClosed(
      auctionNoSale('RESERVE_NOT_MET', [BIDDER1_ID, BIDDER2_ID]).payload,
    );
    expect(result.map((n) => [n.userId, n.type])).toEqual([
      [BIDDER1_ID, 'AUCTION_LOST'],
      [BIDDER2_ID, 'AUCTION_LOST'],
      [SELLER_ID, 'NO_SALE'],
    ]);
    expect(result[2]!.message).toContain('reserve price was not reached');
  });
});

describe('auction.cancelled', () => {
  it('tells the seller when an admin cancelled it', () => {
    const result = fromAuctionCancelled(auctionCancelled(ADMIN_ID).payload);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: SELLER_ID,
      type: 'AUCTION_CANCELLED',
      auctionId: CAMERA_ID,
    });
  });

  it('tells nobody when the seller cancelled it themselves', () => {
    expect(fromAuctionCancelled(auctionCancelled(SELLER_ID).payload)).toEqual([]);
  });
});

describe('payment.completed', () => {
  it('tells the winner what they paid and the seller what they received', () => {
    const [winner, seller, ...rest] = fromPaymentCompleted(paymentCompleted().payload);
    expect(rest).toEqual([]);
    expect(winner).toMatchObject({ userId: BIDDER2_ID, type: 'PAYMENT_COMPLETED' });
    expect(winner!.message).toContain('€85.00');
    expect(seller).toMatchObject({ userId: SELLER_ID, type: 'PAYMENT_COMPLETED' });
    expect(seller!.message).toContain('€80.75');
    expect(seller!.message).toContain('fee €4.25');
  });
});

describe('payment.failed', () => {
  it('tells both sides, and explains an empty balance to the winner', () => {
    const [winner, seller] = fromPaymentFailed(paymentFailed('INSUFFICIENT_FUNDS').payload);
    expect(winner).toMatchObject({ userId: BIDDER2_ID, type: 'PAYMENT_FAILED' });
    expect(winner!.message).toContain('balance did not cover €85.00');
    expect(seller).toMatchObject({ userId: SELLER_ID, type: 'PAYMENT_FAILED' });
  });

  it('explains a missing wallet to the winner', () => {
    const [winner] = fromPaymentFailed(paymentFailed('WALLET_NOT_FOUND').payload);
    expect(winner!.message).toContain('no wallet');
  });
});

describe('every notification fits the database limits', () => {
  it('keeps titles and messages within 120 and 1000 characters, even with a long auction title', () => {
    const longTitle = 'x'.repeat(120);
    const all = [
      ...fromBidPlaced(bidPlaced({ title: longTitle }).payload),
      ...fromAuctionClosed(auctionSold({ title: longTitle }).payload),
      ...fromAuctionClosed(auctionNoSale('RESERVE_NOT_MET', [BIDDER1_ID]).payload),
      ...fromPaymentCompleted({ ...paymentCompleted().payload, title: longTitle }),
      ...fromPaymentFailed({ ...paymentFailed('INSUFFICIENT_FUNDS').payload, title: longTitle }),
    ];
    for (const n of all) {
      expect(n.title.length).toBeLessThanOrEqual(120);
      expect(n.message.length).toBeLessThanOrEqual(1000);
    }
  });
});
