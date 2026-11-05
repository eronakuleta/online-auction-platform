import { EVENT_CATALOG } from '../events/contract';
import type { EventPayload, EventType } from '../events/contract';
import { createEvent, parseEvent } from '../events/envelope';
import { IDS } from './helpers';

const NOW = '2026-11-02T10:15:30.000Z';

const common = { auctionId: IDS.auction, title: 'Vintage camera', currency: 'EUR' };

const VALID_PAYLOADS: { [T in EventType]: EventPayload<T> } = {
  'user.registered': { userId: IDS.bidder, displayName: 'Demo Bidder' },
  'auction.published': {
    ...common,
    sellerId: IDS.seller,
    startsAt: NOW,
    endsAt: NOW,
    startingPriceCents: 1000,
    minIncrementCents: 100,
    reservePriceCents: null,
  },
  'auction.cancelled': {
    auctionId: IDS.auction,
    sellerId: IDS.seller,
    title: 'Vintage camera',
    cancelledBy: IDS.seller,
  },
  'bid.placed': {
    ...common,
    bidId: IDS.event,
    bidderId: IDS.bidder,
    amountCents: 1100,
    previousHighestBidderId: null,
    placedAt: NOW,
  },
  'auction.extended': { auctionId: IDS.auction, endsAt: NOW, extensionCount: 1 },
  'auction.closed': {
    ...common,
    sellerId: IDS.seller,
    closedAt: NOW,
    losingBidderIds: [IDS.other],
    result: 'SOLD',
    winnerId: IDS.bidder,
    amountCents: 1100,
  },
  'payment.completed': {
    ...common,
    settlementId: IDS.event,
    winnerId: IDS.bidder,
    sellerId: IDS.seller,
    amountCents: 1100,
    feeCents: 55,
    sellerCents: 1045,
    settledAt: NOW,
  },
  'payment.failed': {
    ...common,
    winnerId: IDS.bidder,
    sellerId: IDS.seller,
    amountCents: 1100,
    reason: 'INSUFFICIENT_FUNDS',
    failedAt: NOW,
  },
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('event catalog', () => {
  it('has exactly the routing keys from docs/events.md', () => {
    expect(Object.keys(EVENT_CATALOG).sort()).toEqual([
      'auction.cancelled',
      'auction.closed',
      'auction.extended',
      'auction.published',
      'bid.placed',
      'payment.completed',
      'payment.failed',
      'user.registered',
    ]);
  });

  it.each(Object.keys(EVENT_CATALOG) as EventType[])(
    '%s survives createEvent, JSON and parseEvent unchanged',
    (type) => {
      const event = createEvent(type, VALID_PAYLOADS[type] as never);
      expect(parseEvent(encode(event))).toEqual({ ok: true, event });
    },
  );
});

describe('createEvent', () => {
  it('builds the envelope', () => {
    const event = createEvent('user.registered', VALID_PAYLOADS['user.registered']);

    expect(event).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'user.registered',
      version: 1,
      occurredAt: expect.stringMatching(/Z$/),
      payload: VALID_PAYLOADS['user.registered'],
    });
  });

  it('gives each event its own ID', () => {
    const payload = VALID_PAYLOADS['user.registered'];
    expect(createEvent('user.registered', payload).eventId).not.toBe(
      createEvent('user.registered', payload).eventId,
    );
  });

  it('refuses a payload that breaks the contract', () => {
    expect(() =>
      createEvent('bid.placed', { ...VALID_PAYLOADS['bid.placed'], amountCents: 10.5 }),
    ).toThrow();
  });

  it('removes fields the contract does not know', () => {
    const payload = { ...VALID_PAYLOADS['user.registered'], email: 'private@example.com' };
    expect(createEvent('user.registered', payload).payload).not.toHaveProperty('email');
  });
});

describe('payload rules', () => {
  const closed = VALID_PAYLOADS['auction.closed'];

  it.each([
    ['float money', 'bid.placed', { amountCents: 10.5 }],
    ['zero money', 'bid.placed', { amountCents: 0 }],
    ['negative money', 'bid.placed', { amountCents: -1 }],
    ['money as a string', 'bid.placed', { amountCents: '1100' }],
    ['a bad UUID', 'bid.placed', { bidderId: 'not-a-uuid' }],
    ['a time that is not UTC ISO-8601', 'bid.placed', { placedAt: '02.11.2026' }],
    ['a lowercase currency', 'bid.placed', { currency: 'eur' }],
    ['an unknown payment failure', 'payment.failed', { reason: 'BAD_LUCK' }],
    ['no extensions counted', 'auction.extended', { extensionCount: 0 }],
  ] as const)('rejects %s', (_name, type, change) => {
    const body = encode({
      eventId: IDS.event,
      type,
      version: 1,
      occurredAt: NOW,
      payload: { ...VALID_PAYLOADS[type], ...change },
    });
    expect(parseEvent(body)).toEqual({ ok: false, reason: `Invalid payload for ${type}` });
  });

  it('accepts a zero fee, because the fee rounds down on small amounts', () => {
    expect(
      createEvent('payment.completed', {
        ...VALID_PAYLOADS['payment.completed'],
        amountCents: 10,
        feeCents: 0,
        sellerCents: 10,
      }).payload.feeCents,
    ).toBe(0);
  });

  const envelope = (payload: unknown) =>
    encode({ eventId: IDS.event, type: 'auction.closed', version: 1, occurredAt: NOW, payload });

  it('rejects a sold auction without a winner', () => {
    expect(parseEvent(envelope({ ...closed, winnerId: undefined })).ok).toBe(false);
  });

  it('accepts no sale with a reason and rejects it without one', () => {
    const noSale = {
      auctionId: closed.auctionId,
      sellerId: closed.sellerId,
      title: closed.title,
      currency: closed.currency,
      closedAt: closed.closedAt,
      losingBidderIds: [],
      result: 'NO_SALE',
    };
    expect(parseEvent(envelope({ ...noSale, noSaleReason: 'NO_BIDS' })).ok).toBe(true);
    expect(parseEvent(envelope(noSale)).ok).toBe(false);
  });
});

describe('parseEvent', () => {
  const event = {
    eventId: IDS.event,
    type: 'user.registered',
    version: 1,
    occurredAt: NOW,
    payload: VALID_PAYLOADS['user.registered'],
  };

  it.each([
    ['bad JSON', Buffer.from('{oops'), 'Message body is not valid JSON'],
    ['JSON that is not an event', encode([1, 2]), 'Invalid event envelope'],
    ['a bad event ID', encode({ ...event, eventId: 'x' }), 'Invalid event envelope'],
    ['an unknown type', encode({ ...event, type: 'x.y' }), 'Unknown event type: x.y'],
    [
      'a prototype property as the type',
      encode({ ...event, type: 'constructor' }),
      'Unknown event type: constructor',
    ],
    [
      'a newer version',
      encode({ ...event, version: 2 }),
      'Unsupported version 2 of user.registered',
    ],
  ])('rejects %s', (_name, body, reason) => {
    expect(parseEvent(body)).toEqual({ ok: false, reason });
  });

  it('ignores unknown fields, so adding an optional field is not a breaking change', () => {
    const body = encode({
      ...event,
      payload: { ...VALID_PAYLOADS['user.registered'], addedLater: true },
    });
    expect(parseEvent(body)).toEqual({ ok: true, event });
  });
});
