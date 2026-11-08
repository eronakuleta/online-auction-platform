// B-14: the real event handlers against a real Postgres. Each event is built with createEvent, so
// it is checked against the contract in docs/events.md.
import { randomUUID } from 'node:crypto';
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
  createTestContext,
  paymentCompleted,
  paymentFailed,
  userRegistered,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
  // The seed adds demo notifications; these tests count exactly what the handlers create.
  await ctx.pool.query('DELETE FROM notifications');
});

afterEach(async () => {
  await ctx.close();
});

describe('storing notifications', () => {
  it('stores the welcome message for a new user', async () => {
    const userId = randomUUID();
    await ctx.handlers['user.registered']!(userRegistered(userId, 'Anna'));

    const [welcome] = await ctx.notificationsOf(userId);
    expect(welcome).toMatchObject({ type: 'WELCOME', auction_id: null, read_at: null });
    expect(welcome!.message).toContain('Hi Anna');
  });

  it('stores an outbid notification for the previous highest bidder only', async () => {
    await ctx.handlers['bid.placed']!(bidPlaced());

    expect(await ctx.notificationsOf(BIDDER1_ID)).toHaveLength(1);
    expect((await ctx.notificationsOf(BIDDER1_ID))[0]).toMatchObject({
      type: 'OUTBID',
      auction_id: CAMERA_ID,
    });
    expect(await ctx.notificationsOf(BIDDER2_ID)).toHaveLength(0);
    expect(await ctx.count()).toBe(1);
  });

  it('stores nothing for a first bid', async () => {
    await ctx.handlers['bid.placed']!(bidPlaced({ previousHighestBidderId: null }));
    expect(await ctx.count()).toBe(0);
  });

  it('tells the winner, the loser and the seller when an auction is sold', async () => {
    await ctx.handlers['auction.closed']!(auctionSold());

    expect((await ctx.notificationsOf(BIDDER2_ID)).map((n) => n.type)).toEqual(['AUCTION_WON']);
    expect((await ctx.notificationsOf(BIDDER1_ID)).map((n) => n.type)).toEqual(['AUCTION_LOST']);
    expect((await ctx.notificationsOf(SELLER_ID)).map((n) => n.type)).toEqual(['ITEM_SOLD']);
    expect(await ctx.count()).toBe(3);
  });

  it('tells the seller and every bidder when an auction ends without a sale', async () => {
    await ctx.handlers['auction.closed']!(auctionNoSale('RESERVE_NOT_MET', [BIDDER1_ID]));
    expect((await ctx.notificationsOf(BIDDER1_ID)).map((n) => n.type)).toEqual(['AUCTION_LOST']);
    expect((await ctx.notificationsOf(SELLER_ID)).map((n) => n.type)).toEqual(['NO_SALE']);
  });

  it('tells the seller only when an admin cancelled the auction', async () => {
    await ctx.handlers['auction.cancelled']!(auctionCancelled(SELLER_ID));
    expect(await ctx.count()).toBe(0);
    await ctx.handlers['auction.cancelled']!(auctionCancelled(ADMIN_ID));
    expect((await ctx.notificationsOf(SELLER_ID)).map((n) => n.type)).toEqual([
      'AUCTION_CANCELLED',
    ]);
  });

  it('tells both sides about a completed and a failed payment', async () => {
    await ctx.handlers['payment.completed']!(paymentCompleted());
    await ctx.handlers['payment.failed']!(paymentFailed('INSUFFICIENT_FUNDS'));

    expect((await ctx.notificationsOf(BIDDER2_ID)).map((n) => n.type)).toEqual([
      'PAYMENT_COMPLETED',
      'PAYMENT_FAILED',
    ]);
    expect((await ctx.notificationsOf(SELLER_ID)).map((n) => n.type)).toEqual([
      'PAYMENT_COMPLETED',
      'PAYMENT_FAILED',
    ]);
  });
});

describe('idempotency', () => {
  it('creates nothing new when the same event is delivered twice', async () => {
    const event = auctionSold();
    await ctx.handlers['auction.closed']!(event);
    await ctx.handlers['auction.closed']!(event);
    expect(await ctx.count()).toBe(3);
  });

  it('creates nothing new for a delivery that arrives in parallel with itself', async () => {
    const event = auctionSold();
    await Promise.all(Array.from({ length: 5 }, () => ctx.handlers['auction.closed']!(event)));
    expect(await ctx.count()).toBe(3);
  });

  it('adds only what is missing when a retry follows a half-finished first attempt', async () => {
    const event = auctionSold();
    // The first attempt stored only the winner's notification before it failed.
    await ctx.pool.query(
      `INSERT INTO notifications (user_id, event_id, type, title, message, auction_id)
       VALUES ($1, $2, 'AUCTION_WON', 'You won the auction', 'earlier attempt', $3)`,
      [BIDDER2_ID, event.eventId, CAMERA_ID],
    );

    await ctx.handlers['auction.closed']!(event);

    expect(await ctx.count()).toBe(3);
    // The one from the first attempt is kept, not replaced.
    expect((await ctx.notificationsOf(BIDDER2_ID))[0]!.message).toBe('earlier attempt');
  });

  it('treats two different events for the same auction as two notifications', async () => {
    await ctx.handlers['bid.placed']!(bidPlaced());
    await ctx.handlers['bid.placed']!(bidPlaced());
    expect(await ctx.notificationsOf(BIDDER1_ID)).toHaveLength(2);
  });
});

describe('failures', () => {
  it('throws, so the consumer retries and finally dead-letters, when the database fails', async () => {
    const broken = await createTestContext();
    await broken.pool.query('DROP TABLE notifications');
    try {
      await expect(broken.handlers['bid.placed']!(bidPlaced())).rejects.toThrow(/notifications/);
    } finally {
      await broken.close();
    }
  });
});
