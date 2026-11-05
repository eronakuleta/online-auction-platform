import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { resolveCorrelationId, runWithCorrelationId } from '../logger/correlation';
import type { Logger } from '../logger/logger';
import { parseEvent } from './envelope';
import { CORRELATION_HEADER } from './publisher';
import { MAX_RETRIES, SERVICE_SUBSCRIPTIONS, queueNames } from './topology';
import type { ConsumerService } from './topology';
import type { DomainEvent, EventType } from './contract';

export const RETRY_COUNT_HEADER = 'x-retry-count';
export const DEAD_LETTER_REASON_HEADER = 'x-dead-letter-reason';

const DEFAULT_PREFETCH = 10;

/** Handlers must be idempotent: the same event can be delivered more than once. */
export type EventHandler<T extends EventType> = (event: DomainEvent<T>) => Promise<void>;

/** A service can only register handlers for the events it is subscribed to. */
export type EventHandlers<S extends ConsumerService> = {
  [T in (typeof SERVICE_SUBSCRIPTIONS)[S][number]]?: EventHandler<T>;
};

export type ConsumeChannel = Pick<
  ConfirmChannel,
  'prefetch' | 'consume' | 'cancel' | 'ack' | 'nack' | 'sendToQueue'
>;

export interface ConsumerOptions<S extends ConsumerService> {
  service: S;
  handlers: EventHandlers<S>;
  logger: Logger;
  /** How many messages this replica works on at once. */
  prefetch?: number;
}

export interface Consumer {
  /** Stops taking new messages and waits for the ones in progress. */
  stop(): Promise<void>;
}

/**
 * Consumes the service's queue. A message is acknowledged only after its handler succeeds. A failed
 * handler is retried through the retry queue, up to MAX_RETRIES times, and then goes to the
 * dead-letter queue. Messages that can never succeed go to the dead-letter queue directly.
 */
export async function startConsumer<S extends ConsumerService>(
  channel: ConsumeChannel,
  options: ConsumerOptions<S>,
): Promise<Consumer> {
  const { service, logger } = options;
  const queues = queueNames(service);
  // The event type is only known at runtime; the schema check in parseEvent guarantees that the
  // event matches the handler registered under its type.
  const handlers = options.handlers as Partial<Record<EventType, EventHandler<EventType>>>;
  const inProgress = new Set<Promise<void>>();

  // Copies the message to another queue, then acknowledges it, so it cannot be lost in between.
  // A crash after the copy causes a duplicate at worst, and handlers are idempotent.
  async function moveTo(
    queue: string,
    message: ConsumeMessage,
    extraHeaders: Record<string, unknown>,
  ): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        channel.sendToQueue(
          queue,
          message.content,
          {
            persistent: true,
            contentType: message.properties.contentType as string | undefined,
            messageId: message.properties.messageId as string | undefined,
            type: message.properties.type as string | undefined,
            headers: { ...message.properties.headers, ...extraHeaders },
          },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch (err) {
      logger.error({ err, queue }, 'could not move message, returning it to the queue');
      channel.nack(message, false, true);
      return;
    }
    channel.ack(message);
  }

  function deadLetter(message: ConsumeMessage, reason: string): Promise<void> {
    logger.error({ messageId: message.properties.messageId, reason }, 'event dead-lettered');
    return moveTo(queues.deadLetter, message, { [DEAD_LETTER_REASON_HEADER]: reason });
  }

  async function processMessage(message: ConsumeMessage): Promise<void> {
    const parsed = parseEvent(message.content);
    if (!parsed.ok) {
      await deadLetter(message, parsed.reason);
      return;
    }

    const { event } = parsed;
    const handler = handlers[event.type];
    if (!handler) {
      await deadLetter(message, `${service} has no handler for ${event.type}`);
      return;
    }

    try {
      await handler(event);
    } catch (err) {
      const header: unknown = message.properties.headers?.[RETRY_COUNT_HEADER];
      const retries = typeof header === 'number' ? header : 0;
      const logFields = { err, eventId: event.eventId, eventType: event.type, retries };
      if (retries < MAX_RETRIES) {
        logger.warn(logFields, 'event handler failed, will retry');
        await moveTo(queues.retry, message, { [RETRY_COUNT_HEADER]: retries + 1 });
      } else {
        await deadLetter(message, `Handler failed after ${MAX_RETRIES} retries`);
      }
      return;
    }

    channel.ack(message);
    logger.debug({ eventId: event.eventId, eventType: event.type }, 'event processed');
  }

  await channel.prefetch(options.prefetch ?? DEFAULT_PREFETCH);

  const { consumerTag } = await channel.consume(queues.main, (message) => {
    if (message === null) {
      logger.error({ queue: queues.main }, 'consumer was cancelled by the broker');
      return;
    }
    const correlationId = resolveCorrelationId(message.properties.headers?.[CORRELATION_HEADER]);
    const work = runWithCorrelationId(correlationId, () => processMessage(message))
      .catch((err: unknown) => {
        // Only an ack or nack can fail here, on a closed channel. The broker redelivers the message.
        logger.error({ err, queue: queues.main }, 'could not settle message');
      })
      .finally(() => {
        inProgress.delete(work);
      });
    inProgress.add(work);
  });

  logger.info({ queue: queues.main }, 'consumer started');

  return {
    async stop() {
      await channel.cancel(consumerTag);
      await Promise.allSettled(inProgress);
    },
  };
}
