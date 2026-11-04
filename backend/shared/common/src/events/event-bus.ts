import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import type { Logger } from '../logger/logger';
import { startConsumer } from './consumer';
import type { Consumer, EventHandlers } from './consumer';
import { createPublisher } from './publisher';
import type { Publish } from './publisher';
import { DEFAULT_EVENTS_EXCHANGE, applyTopology } from './topology';
import type { ConsumerService } from './topology';

export interface EventBusOptions {
  /** RABBITMQ_URL. It contains the password, so it is never logged. */
  url: string;
  logger: Logger;
  /** EVENTS_EXCHANGE. Defaults to `auction.events`. */
  exchange?: string;
  /** Startup connection attempts, because the broker may start after the service. */
  connectAttempts?: number;
  connectRetryDelayMs?: number;
  /** Called if the connection drops later. By default the process exits and Docker restarts it. */
  onConnectionLost?: (err?: unknown) => void;
}

export interface EventBus {
  publish: Publish;
  subscribe<S extends ConsumerService>(service: S, handlers: EventHandlers<S>): Promise<Consumer>;
  /** Stops consumers, waits for messages in progress, and closes the connection. */
  close(): Promise<void>;
}

/** Connects to RabbitMQ, retrying while the broker starts. */
export async function connectWithRetry(
  url: string,
  logger: Logger,
  attempts = 10,
  delayMs = 2000,
): Promise<ChannelModel> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect(url);
    } catch (err) {
      if (attempt >= attempts) {
        throw err;
      }
      logger.warn({ err, attempt, attempts }, 'RabbitMQ is not reachable yet, retrying');
      await sleep(delayMs);
    }
  }
}

/**
 * Connects and declares the topology. The usual way for a service to use events:
 *   const bus = await connectEventBus({ url, logger });
 *   await bus.subscribe('bidding-service', { 'auction.published': handlePublished });
 *   await bus.publish('bid.placed', payload);
 */
export async function connectEventBus(options: EventBusOptions): Promise<EventBus> {
  const { url, logger, exchange = DEFAULT_EVENTS_EXCHANGE } = options;
  const connection = await connectWithRetry(
    url,
    logger,
    options.connectAttempts,
    options.connectRetryDelayMs,
  );

  let closing = false;
  const onLost =
    options.onConnectionLost ??
    ((err?: unknown) => {
      logger.fatal({ err }, 'lost the RabbitMQ connection, exiting so the container restarts');
      process.exit(1);
    });
  const handleLoss = (err?: unknown) => {
    if (!closing) {
      onLost(err);
    }
  };

  connection.on('error', (err: unknown) => logger.error({ err }, 'RabbitMQ connection error'));
  connection.on('close', handleLoss);

  const openChannel = async (): Promise<ConfirmChannel> => {
    const channel = await connection.createConfirmChannel();
    // RabbitMQ closes a channel after a protocol error, which would silently stop this service.
    channel.on('error', handleLoss);
    return channel;
  };

  const publishChannel = await openChannel();
  await applyTopology(publishChannel, exchange);

  const consumers: Consumer[] = [];

  return {
    publish: createPublisher(publishChannel, exchange, logger),

    async subscribe(service, handlers) {
      // Its own channel, so prefetch and consumer errors do not affect publishing.
      const channel = await openChannel();
      const consumer = await startConsumer(channel, { service, handlers, logger });
      consumers.push(consumer);
      return consumer;
    },

    async close() {
      closing = true;
      await Promise.allSettled(consumers.map((consumer) => consumer.stop()));
      await connection.close();
    },
  };
}
