// B-12: GET /auctions/:id/stream over real HTTP connections, read like a browser's EventSource.
// The two-replica test also needs a real Redis (TEST_REDIS_URL), like the cache tests.
import { randomUUID } from 'node:crypto';
import { createLogger } from '@auction/shared-common';
import request from 'supertest';
import { findAuctionState } from '../repositories/bidding.repository';
import { createLiveUpdates } from '../services/live-updates';
import { BIDDER1_ID, BIDDER2_ID, SELLER_ID, createTestContext, type TestContext } from './helpers';

interface StreamEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Opens the stream and collects events and comment lines as they arrive. */
async function openStream(baseUrl: string, auctionId: string) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/v1/auctions/${auctionId}/stream`, {
    signal: controller.signal,
  });
  const events: StreamEvent[] = [];
  const comments: string[] = [];
  let retry: string | undefined;
  if (response.headers.get('content-type')?.startsWith('text/event-stream') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end).split('\n');
            buffer = buffer.slice(end + 2);
            if (block.every((line) => line.startsWith(':'))) {
              comments.push(...block);
              continue;
            }
            const field = (name: string) =>
              block.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
            if (field('retry') !== undefined) {
              retry = field('retry');
              continue;
            }
            events.push({
              id: field('id') ?? '',
              event: field('event') ?? 'message',
              data: JSON.parse(field('data') ?? '{}') as Record<string, unknown>,
            });
          }
        }
      } catch {
        // Aborted by close().
      }
    })();
  }
  return {
    response,
    events,
    comments,
    retry: () => retry,
    close: () => controller.abort(),
  };
}

describe('SSE stream on one replica', () => {
  let ctx: TestContext;
  let baseUrl: string;

  beforeEach(async () => {
    ctx = await createTestContext({ heartbeatMs: 50 });
    baseUrl = await ctx.listen();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const placeBid = (auctionId: string, bidder: string, amountCents: number) =>
    request(ctx.app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(bidder)}`)
      .send({ amountCents })
      .expect(201);

  it('needs no token, sets SSE headers and sends the current state first', async () => {
    const auctionId = await ctx.addAuction();
    const stream = await openStream(baseUrl, auctionId);
    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
      expect(stream.response.headers.get('cache-control')).toBe('no-cache, no-transform');
      expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
      await until(() => stream.events.length === 1);
      expect(stream.retry()).toBe('3000');
      expect(stream.events[0]).toMatchObject({
        id: '0',
        event: 'state',
        data: { auctionId, status: 'OPEN', highestBidCents: null, minimumNextBidCents: 1000 },
      });
      expect(stream.events[0]!.data).not.toHaveProperty('reservePriceCents');
    } finally {
      stream.close();
    }
  });

  it('answers a normal JSON 404 for an unknown auction', async () => {
    const stream = await openStream(baseUrl, randomUUID());
    expect(stream.response.status).toBe(404);
    expect(((await stream.response.json()) as { error: { code: string } }).error.code).toBe(
      'AUCTION_NOT_FOUND',
    );
  });

  it('pushes each new bid to every viewer, with the version as the event id', async () => {
    const auctionId = await ctx.addAuction();
    const a = await openStream(baseUrl, auctionId);
    const b = await openStream(baseUrl, auctionId);
    try {
      await until(() => a.events.length === 1 && b.events.length === 1);
      await placeBid(auctionId, BIDDER1_ID, 1000);
      await placeBid(auctionId, BIDDER2_ID, 1100);
      await until(() => a.events.length === 3 && b.events.length === 3);

      for (const viewer of [a, b]) {
        expect(viewer.events.map((e) => e.id)).toEqual(['0', '1', '2']);
        expect(viewer.events[2]!.data).toMatchObject({
          highestBidCents: 1100,
          highestBidderId: BIDDER2_ID,
          bidCount: 2,
          minimumNextBidCents: 1200,
        });
      }
    } finally {
      a.close();
      b.close();
    }
  });

  it('shows an anti-sniping extension in the pushed end time', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 10 });
    const stream = await openStream(baseUrl, auctionId);
    try {
      await until(() => stream.events.length === 1);
      const before = new Date(stream.events[0]!.data.endsAt as string).getTime();
      await placeBid(auctionId, BIDDER1_ID, 1000);
      await until(() => stream.events.length === 2);
      const pushed = stream.events[1]!.data;
      expect(pushed.extensionCount).toBe(1);
      expect(new Date(pushed.endsAt as string).getTime() - before).toBe(30_000);
    } finally {
      stream.close();
    }
  });

  it('pushes the result when the closing worker closes the auction', async () => {
    const auctionId = await ctx.addAuction();
    const stream = await openStream(baseUrl, auctionId);
    try {
      await placeBid(auctionId, BIDDER1_ID, 1000);
      await ctx.expireAuction(auctionId);
      await ctx.newClosingService().closeExpiredAuctions();
      await until(() => stream.events.some((e) => e.data.status === 'CLOSED_SOLD'));
    } finally {
      stream.close();
    }
  });

  it('pushes a cancel', async () => {
    const auctionId = await ctx.addAuction();
    const stream = await openStream(baseUrl, auctionId);
    try {
      await request(ctx.app)
        .post(`/internal/auctions/${auctionId}/cancel`)
        .send({ cancelledBy: SELLER_ID, isAdmin: false })
        .expect(204);
      await until(() => stream.events.some((e) => e.data.status === 'CANCELLED'));
    } finally {
      stream.close();
    }
  });

  it('sends only that auction’s updates', async () => {
    const watched = await ctx.addAuction();
    const other = await ctx.addAuction();
    const stream = await openStream(baseUrl, watched);
    try {
      await until(() => stream.events.length === 1);
      await placeBid(other, BIDDER1_ID, 1000);
      await placeBid(watched, BIDDER1_ID, 1000);
      await until(() => stream.events.length === 2);
      expect(stream.events.every((e) => e.data.auctionId === watched)).toBe(true);
    } finally {
      stream.close();
    }
  });

  it('sends heartbeat comments while nothing happens', async () => {
    const auctionId = await ctx.addAuction();
    const stream = await openStream(baseUrl, auctionId);
    try {
      await until(() => stream.comments.length >= 2);
      expect(stream.comments[0]).toBe(': heartbeat');
    } finally {
      stream.close();
    }
  });

  it('forgets a viewer who disconnects', async () => {
    const auctionId = await ctx.addAuction();
    const stream = await openStream(baseUrl, auctionId);
    await until(() => ctx.hub.size(auctionId) === 1);
    stream.close();
    await until(() => ctx.hub.size(auctionId) === 0);
  });
});

describe('live updates without Redis', () => {
  it('delivers on this replica when publishing to the others fails', async () => {
    const delivered: string[] = [];
    const live = createLiveUpdates({
      deliverLocally: (state) => delivered.push(state.auctionId),
      publishToReplicas: async () => {
        throw new Error('Redis is down');
      },
      logger: createLogger({ service: 'live-test', level: 'silent' }),
    });
    const ctx = await createTestContext();
    try {
      const auctionId = await ctx.addAuction();
      await expect(
        live.publish((await findAuctionState(ctx.pool, auctionId))!),
      ).resolves.toBeUndefined();
      expect(delivered).toEqual([auctionId]);
    } finally {
      await ctx.close();
    }
  });
});

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis('SSE across two replicas (Redis pub/sub)', () => {
  it('a bid on replica A reaches a viewer on replica B', async () => {
    const ctx = await createTestContext({
      redisUrl: `${(redisUrl ?? '').replace(/\/\d+$/, '')}/15`,
    });
    try {
      const replicaB = await ctx.newReplica();
      const urlB = await replicaB.listen();
      const auctionId = await ctx.addAuction();
      const stream = await openStream(urlB, auctionId);
      try {
        await until(() => stream.events.length === 1);
        // The bid goes to replica A (ctx.app); the viewer is connected to replica B.
        await request(ctx.app)
          .post(`/api/v1/auctions/${auctionId}/bids`)
          .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
          .send({ amountCents: 1000 })
          .expect(201);
        await until(() => stream.events.length === 2);
        expect(stream.events[1]!.data).toMatchObject({ highestBidCents: 1000, bidCount: 1 });
        // Exactly once: replica A's own subscriber must not cause a second delivery on B.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(stream.events).toHaveLength(2);
      } finally {
        stream.close();
      }
    } finally {
      await ctx.close();
    }
  });
});
