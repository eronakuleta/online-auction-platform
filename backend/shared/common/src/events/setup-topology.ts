import type { Logger } from '../logger/logger';
import { connectWithRetry } from './event-bus';
import { DEFAULT_EVENTS_EXCHANGE, SERVICE_SUBSCRIPTIONS, applyTopology } from './topology';

/** Declares the whole topology once and disconnects. Used by `npm run rabbitmq:setup` (B-03). */
export async function setupTopology(
  url: string,
  logger: Logger,
  exchange: string = DEFAULT_EVENTS_EXCHANGE,
): Promise<void> {
  const connection = await connectWithRetry(url, logger);
  try {
    const channel = await connection.createChannel();
    await applyTopology(channel, exchange);
    logger.info(
      { exchange, services: Object.keys(SERVICE_SUBSCRIPTIONS) },
      'RabbitMQ topology is ready',
    );
  } finally {
    await connection.close();
  }
}
