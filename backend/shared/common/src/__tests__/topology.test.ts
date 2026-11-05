import { EVENT_CATALOG } from '../events/contract';
import type { EventType } from '../events/contract';
import {
  MAX_RETRIES,
  RETRY_DELAY_MS,
  SERVICE_SUBSCRIPTIONS,
  applyTopology,
  queueNames,
} from '../events/topology';

function fakeChannel() {
  return {
    assertExchange: jest.fn(async (exchange: string) => ({ exchange })),
    assertQueue: jest.fn(async (queue: string) => ({
      queue,
      messageCount: 0,
      consumerCount: 0,
    })),
    bindQueue: jest.fn(async () => ({})),
  };
}

describe('applyTopology', () => {
  it('declares a durable topic exchange, by default auction.events', async () => {
    const channel = fakeChannel();
    await applyTopology(channel);
    expect(channel.assertExchange).toHaveBeenCalledWith('auction.events', 'topic', {
      durable: true,
    });
  });

  it('uses the exchange it is given', async () => {
    const channel = fakeChannel();
    await applyTopology(channel, 'test.events');
    expect(channel.assertExchange).toHaveBeenCalledWith('test.events', 'topic', { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'bidding-service.events',
      'test.events',
      'auction.published',
    );
  });

  it('declares three durable queues per service', async () => {
    const channel = fakeChannel();
    await applyTopology(channel);

    expect(channel.assertQueue).toHaveBeenCalledTimes(12);
    for (const [, options] of channel.assertQueue.mock.calls as unknown as [
      string,
      { durable: boolean },
    ][]) {
      expect(options.durable).toBe(true);
    }
  });

  it('returns retried messages to the same service only, after the delay', async () => {
    const channel = fakeChannel();
    await applyTopology(channel);

    expect(channel.assertQueue).toHaveBeenCalledWith('payment-service.events.retry', {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        // The default exchange routes by queue name, so nothing goes back through the topic.
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'payment-service.events',
      },
    });
  });

  it('sends rejected messages from the main queue to the DLQ', async () => {
    const channel = fakeChannel();
    await applyTopology(channel);

    expect(channel.assertQueue).toHaveBeenCalledWith('payment-service.events', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'payment-service.events.dlq',
      },
    });
  });

  it('declares each queue before binding or dead-lettering to it', async () => {
    const order: string[] = [];
    const channel = fakeChannel();
    channel.assertQueue.mockImplementation(async (queue: string) => {
      order.push(`queue ${queue}`);
      return { queue, messageCount: 0, consumerCount: 0 };
    });
    channel.bindQueue.mockImplementation(async () => {
      order.push('bind');
      return {};
    });

    await applyTopology(channel);

    expect(order.slice(0, 4)).toEqual([
      'queue auction-service.events.dlq',
      'queue auction-service.events.retry',
      'queue auction-service.events',
      'bind',
    ]);
  });

  it('binds exactly the subscriptions in the event catalog of docs/events.md', async () => {
    const channel = fakeChannel();
    await applyTopology(channel);

    const bindings = channel.bindQueue.mock.calls as unknown as [string, string, string][];
    const consumersOf = (key: string) =>
      bindings
        .filter(([, , routingKey]) => routingKey === key)
        .map(([queue]) => queue.replace('-service.events', ''))
        .sort();

    expect(consumersOf('user.registered')).toEqual(['notification', 'payment']);
    expect(consumersOf('auction.published')).toEqual(['bidding']);
    expect(consumersOf('auction.cancelled')).toEqual(['bidding', 'notification']);
    expect(consumersOf('bid.placed')).toEqual(['notification']);
    expect(consumersOf('auction.extended')).toEqual(['auction']);
    expect(consumersOf('auction.closed')).toEqual(['auction', 'notification', 'payment']);
    expect(consumersOf('payment.completed')).toEqual(['auction', 'notification']);
    expect(consumersOf('payment.failed')).toEqual(['auction', 'notification']);
  });

  it('leaves no event without a consumer, and names only real events', () => {
    const subscribed = new Set<EventType>(Object.values(SERVICE_SUBSCRIPTIONS).flat());
    expect([...subscribed].sort()).toEqual((Object.keys(EVENT_CATALOG) as EventType[]).sort());
  });

  it('is a retry policy of 3 retries', () => {
    expect(MAX_RETRIES).toBe(3);
  });
});

describe('queueNames', () => {
  it('follows the naming in docs/events.md', () => {
    expect(queueNames('bidding-service')).toEqual({
      main: 'bidding-service.events',
      retry: 'bidding-service.events.retry',
      deadLetter: 'bidding-service.events.dlq',
    });
  });
});
