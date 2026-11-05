import type { ConfirmChannel } from 'amqplib';
import { getCorrelationId, resolveCorrelationId } from '../logger/correlation';
import type { Logger } from '../logger/logger';
import { createEvent } from './envelope';
import type { DomainEvent, EventPayload, EventType } from './contract';

export const CORRELATION_HEADER = 'x-correlation-id';

export type Publish = <T extends EventType>(
  type: T,
  payload: EventPayload<T>,
) => Promise<DomainEvent<T>>;

/**
 * Returns the publish function. Call it only after the database transaction has committed. It
 * resolves once the broker has confirmed that it stored the message.
 */
export function createPublisher(
  channel: Pick<ConfirmChannel, 'publish'>,
  exchange: string,
  logger: Logger,
): Publish {
  return async (type, payload) => {
    const event = createEvent(type, payload);
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        exchange,
        type,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: event.eventId,
          type,
          headers: { [CORRELATION_HEADER]: resolveCorrelationId(getCorrelationId()) },
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    logger.info({ eventId: event.eventId, eventType: type }, 'event published');
    return event;
  };
}
