import type { ConfirmChannel, Options } from 'amqplib';
import { DEAD_LETTER_REASON_HEADER, RETRY_COUNT_HEADER, startConsumer } from '../events/consumer';
import type { EventHandlers } from '../events/consumer';
import { createEvent } from '../events/envelope';
import { CORRELATION_HEADER, createPublisher } from '../events/publisher';
import { getCorrelationId, runWithCorrelationId } from '../logger/correlation';
import { FakeChannel, IDS, memoryLogger } from './helpers';

const payload = { userId: IDS.bidder, displayName: 'Demo Bidder' };
const validBody = () => Buffer.from(JSON.stringify(createEvent('user.registered', payload)));

const MAIN = 'notification-service.events';
const RETRY = 'notification-service.events.retry';
const DLQ = 'notification-service.events.dlq';

async function start(handlers: EventHandlers<'notification-service'>) {
  const channel = new FakeChannel();
  const { logger, lines } = memoryLogger();
  const consumer = await startConsumer(channel.asChannel(), {
    service: 'notification-service',
    handlers,
    logger,
  });
  return { channel, consumer, lines };
}

describe('createPublisher', () => {
  function fakePublishChannel(error: Error | null = null) {
    const published: { exchange: string; key: string; body: Buffer; options: Options.Publish }[] =
      [];
    const channel = {
      publish(
        exchange: string,
        key: string,
        body: Buffer,
        options: Options.Publish,
        callback: (err: Error | null) => void,
      ) {
        published.push({ exchange, key, body, options });
        callback(error);
        return true;
      },
    } as unknown as Pick<ConfirmChannel, 'publish'>;
    return { channel, published };
  }

  it('publishes a persistent message with the type as routing key', async () => {
    const { channel, published } = fakePublishChannel();
    const publish = createPublisher(channel, 'auction.events', memoryLogger().logger);

    const event = await publish('user.registered', payload);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ exchange: 'auction.events', key: 'user.registered' });
    expect(published[0]?.options).toMatchObject({
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
    });
    expect(JSON.parse(published[0]?.body.toString() ?? '')).toEqual(event);
  });

  it('sends the current correlation ID in a header', async () => {
    const { channel, published } = fakePublishChannel();
    const publish = createPublisher(channel, 'auction.events', memoryLogger().logger);

    await runWithCorrelationId('request-7', () => publish('user.registered', payload));

    expect(published[0]?.options.headers?.[CORRELATION_HEADER]).toBe('request-7');
  });

  it('fails if the broker does not confirm', async () => {
    const { channel } = fakePublishChannel(new Error('nacked'));
    const publish = createPublisher(channel, 'auction.events', memoryLogger().logger);

    await expect(publish('user.registered', payload)).rejects.toThrow('nacked');
  });

  it('sends nothing if the payload breaks the contract', async () => {
    const { channel, published } = fakePublishChannel();
    const publish = createPublisher(channel, 'auction.events', memoryLogger().logger);

    await expect(
      publish('user.registered', { userId: 'not-a-uuid', displayName: 'x' }),
    ).rejects.toThrow();
    expect(published).toHaveLength(0);
  });
});

describe('startConsumer', () => {
  it('calls the handler with the parsed event, then acknowledges', async () => {
    const handler = jest.fn(async () => undefined);
    const { channel } = await start({ 'user.registered': handler });

    await channel.deliver(validBody());

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user.registered', payload }),
    );
    expect(channel.acked).toHaveLength(1);
    expect(channel.sent).toHaveLength(0);
  });

  it('acknowledges only after an async handler has finished', async () => {
    let finish: () => void = () => undefined;
    const { channel } = await start({
      'user.registered': () => new Promise<void>((resolve) => (finish = resolve)),
    });

    const delivered = channel.deliver(validBody());
    await new Promise((resolve) => setImmediate(resolve));
    expect(channel.acked).toHaveLength(0);

    finish();
    await delivered;
    expect(channel.acked).toHaveLength(1);
  });

  it('runs the handler with the correlation ID from the message', async () => {
    let seen: string | undefined;
    const { channel } = await start({
      'user.registered': async () => {
        seen = getCorrelationId();
      },
    });

    await channel.deliver(validBody(), { [CORRELATION_HEADER]: 'request-7' });

    expect(seen).toBe('request-7');
  });

  it('sends a failed message to the retry queue with the count raised', async () => {
    const { channel } = await start({
      'user.registered': async () => {
        throw new Error('database is down');
      },
    });

    await channel.deliver(validBody(), { [CORRELATION_HEADER]: 'request-7' });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.queue).toBe(RETRY);
    expect(channel.sent[0]?.options.persistent).toBe(true);
    expect(channel.sent[0]?.options.headers).toMatchObject({
      [RETRY_COUNT_HEADER]: 1,
      [CORRELATION_HEADER]: 'request-7',
    });
    expect(channel.acked).toHaveLength(1);
  });

  it.each([
    [1, 2],
    [2, 3],
  ])('after %i retries, sends retry number %i', async (retries, expected) => {
    const { channel } = await start({
      'user.registered': async () => {
        throw new Error('still down');
      },
    });

    await channel.deliver(validBody(), { [RETRY_COUNT_HEADER]: retries });

    expect(channel.sent[0]?.queue).toBe(RETRY);
    expect(channel.sent[0]?.options.headers?.[RETRY_COUNT_HEADER]).toBe(expected);
  });

  it('sends the message to the DLQ when the 3rd retry fails', async () => {
    const { channel, lines } = await start({
      'user.registered': async () => {
        throw new Error('still down');
      },
    });

    await channel.deliver(validBody(), { [RETRY_COUNT_HEADER]: 3 });

    expect(channel.sent[0]?.queue).toBe(DLQ);
    expect(channel.sent[0]?.options.headers?.[DEAD_LETTER_REASON_HEADER]).toBe(
      'Handler failed after 3 retries',
    );
    expect(channel.acked).toHaveLength(1);
    expect(lines().some((line) => line.msg === 'event dead-lettered')).toBe(true);
  });

  it('keeps the message body byte for byte when moving it', async () => {
    const { channel } = await start({
      'user.registered': async () => {
        throw new Error('down');
      },
    });
    const body = validBody();

    await channel.deliver(body);

    expect(channel.sent[0]?.content.equals(body)).toBe(true);
  });

  it.each([
    ['bad JSON', Buffer.from('{oops'), 'Message body is not valid JSON'],
    [
      'an unknown event',
      Buffer.from(
        JSON.stringify({
          eventId: IDS.event,
          type: 'x.y',
          version: 1,
          occurredAt: '2026-11-02T10:15:30.000Z',
          payload: {},
        }),
      ),
      'Unknown event type: x.y',
    ],
  ])('sends %s straight to the DLQ, without calling a handler', async (_name, body, reason) => {
    const handler = jest.fn(async () => undefined);
    const { channel } = await start({ 'user.registered': handler });

    await channel.deliver(body);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.sent[0]?.queue).toBe(DLQ);
    expect(channel.sent[0]?.options.headers?.[DEAD_LETTER_REASON_HEADER]).toBe(reason);
  });

  it('sends an event with no handler to the DLQ instead of dropping it', async () => {
    const { channel } = await start({});

    await channel.deliver(validBody());

    expect(channel.sent[0]?.queue).toBe(DLQ);
    expect(channel.sent[0]?.options.headers?.[DEAD_LETTER_REASON_HEADER]).toBe(
      'notification-service has no handler for user.registered',
    );
  });

  it('requeues the message and does not ack if it cannot be moved, so it is not lost', async () => {
    const { channel } = await start({
      'user.registered': async () => {
        throw new Error('down');
      },
    });
    channel.failNextSend = true;

    await channel.deliver(validBody());

    expect(channel.acked).toHaveLength(0);
    expect(channel.nacked).toHaveLength(1);
    expect(channel.nacked[0]?.requeue).toBe(true);
  });

  it('applies prefetch and consumes the main queue', async () => {
    const channel = new FakeChannel();
    const consume = jest.spyOn(channel, 'consume');

    await startConsumer(channel.asChannel(), {
      service: 'notification-service',
      handlers: {},
      logger: memoryLogger().logger,
      prefetch: 3,
    });

    expect(channel.prefetchCount).toBe(3);
    expect(consume).toHaveBeenCalledWith(MAIN, expect.any(Function));
  });

  it('stop() cancels the consumer and waits for messages in progress', async () => {
    let finish: () => void = () => undefined;
    const { channel, consumer } = await start({
      'user.registered': () => new Promise<void>((resolve) => (finish = resolve)),
    });
    const delivered = channel.deliver(validBody());
    await new Promise((resolve) => setImmediate(resolve));

    let stopped = false;
    const stopping = consumer.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(channel.cancelledTag).toBe('tag-1');
    expect(stopped).toBe(false);

    finish();
    await Promise.all([delivered, stopping]);
    expect(stopped).toBe(true);
  });

  it('logs when the broker cancels the consumer', async () => {
    const { channel, lines } = await start({});

    channel.cancelFromBroker();

    expect(lines().some((line) => line.msg === 'consumer was cancelled by the broker')).toBe(true);
  });
});
