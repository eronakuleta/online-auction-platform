import type { Channel } from 'amqplib';
import type { EventType } from './contract';

// The RabbitMQ topology from docs/events.md section 6 (task B-03).

export const DEFAULT_EVENTS_EXCHANGE = 'auction.events';
export const RETRY_DELAY_MS = 5000;
export const MAX_RETRIES = 3;

/** Which events each service consumes. auth-service only publishes, so it is not listed. */
export const SERVICE_SUBSCRIPTIONS = {
  'auction-service': ['auction.extended', 'auction.closed', 'payment.completed', 'payment.failed'],
  'bidding-service': ['auction.published', 'auction.cancelled'],
  'payment-service': ['user.registered', 'auction.closed'],
  'notification-service': [
    'user.registered',
    'auction.cancelled',
    'bid.placed',
    'auction.closed',
    'payment.completed',
    'payment.failed',
  ],
} as const satisfies Record<string, readonly EventType[]>;

export type ConsumerService = keyof typeof SERVICE_SUBSCRIPTIONS;

export function queueNames(service: ConsumerService) {
  return {
    main: `${service}.events`,
    retry: `${service}.events.retry`,
    deadLetter: `${service}.events.dlq`,
  };
}

/**
 * Declares the exchange and every service's queues and bindings. It is safe to run repeatedly.
 * All services are declared together, so an event published before a consumer starts is kept in
 * that consumer's queue instead of being dropped.
 */
export async function applyTopology(
  channel: Pick<Channel, 'assertExchange' | 'assertQueue' | 'bindQueue'>,
  exchange: string = DEFAULT_EVENTS_EXCHANGE,
): Promise<void> {
  await channel.assertExchange(exchange, 'topic', { durable: true });

  for (const [name, routingKeys] of Object.entries(SERVICE_SUBSCRIPTIONS)) {
    const queues = queueNames(name as ConsumerService);

    await channel.assertQueue(queues.deadLetter, { durable: true });

    // After the delay the broker moves a message back to the main queue. The empty string is the
    // default exchange, which routes by queue name, so other services do not get a second copy.
    await channel.assertQueue(queues.retry, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queues.main,
      },
    });

    // The consumer moves failed messages itself; this also catches any plain reject.
    await channel.assertQueue(queues.main, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queues.deadLetter,
      },
    });

    for (const routingKey of routingKeys) {
      await channel.bindQueue(queues.main, exchange, routingKey);
    }
  }
}
