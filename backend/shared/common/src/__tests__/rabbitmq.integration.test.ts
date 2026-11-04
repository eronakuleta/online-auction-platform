import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from 'amqplib';
import type { ChannelModel } from 'amqplib';
import { DEAD_LETTER_REASON_HEADER, RETRY_COUNT_HEADER } from '../events/consumer';
import { connectEventBus } from '../events/event-bus';
import type { EventBus } from '../events/event-bus';
import { SERVICE_SUBSCRIPTIONS, queueNames } from '../events/topology';
import type { ConsumerService } from '../events/topology';
import { setupTopology } from '../events/setup-topology';
import { IDS, memoryLogger } from './helpers';

// Runs only against a real broker. See backend/shared/common/README.md. It purges the service
// queues, so never point it at anything but a local test broker.
const url = process.env.RABBITMQ_TEST_URL;
const describeWithBroker = url ? describe : describe.skip;

const payload = { userId: IDS.bidder, displayName: 'Demo Bidder' };

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condition was not met in time');
    }
    await sleep(50);
  }
}

describeWithBroker('with a real RabbitMQ', () => {
  const brokerUrl = url as string;
  const { logger } = memoryLogger('silent');
  let admin: ChannelModel;
  let bus: EventBus;

  const channelForChecks = async () => admin.createChannel();

  beforeAll(async () => {
    // Twice, to prove that declaring the topology again does not fail.
    await setupTopology(brokerUrl, logger);
    await setupTopology(brokerUrl, logger);
    admin = await connect(brokerUrl);
  });

  beforeEach(async () => {
    const channel = await channelForChecks();
    for (const service of Object.keys(SERVICE_SUBSCRIPTIONS) as ConsumerService[]) {
      const queues = queueNames(service);
      await channel.purgeQueue(queues.main);
      await channel.purgeQueue(queues.retry);
      await channel.purgeQueue(queues.deadLetter);
    }
    await channel.close();
    bus = await connectEventBus({ url: brokerUrl, logger });
  });

  afterEach(async () => {
    await bus.close();
  });

  afterAll(async () => {
    await admin.close();
  });

  it('delivers an event to every subscribed service, and only to those', async () => {
    await bus.publish('user.registered', payload);

    const channel = await channelForChecks();
    await until(async () => {
      const { messageCount } = await channel.checkQueue('payment-service.events');
      return messageCount === 1;
    });
    expect((await channel.checkQueue('notification-service.events')).messageCount).toBe(1);
    expect((await channel.checkQueue('auction-service.events')).messageCount).toBe(0);
    expect((await channel.checkQueue('bidding-service.events')).messageCount).toBe(0);
    await channel.close();
  });

  it('runs the handler and removes the message from the queue', async () => {
    const received: unknown[] = [];
    await bus.subscribe('payment-service', {
      'user.registered': async (event) => {
        received.push(event.payload);
      },
    });

    await bus.publish('user.registered', payload);

    await until(() => received.length === 1);
    expect(received[0]).toEqual(payload);
    const channel = await channelForChecks();
    await until(
      async () => (await channel.checkQueue('payment-service.events')).messageCount === 0,
    );
    await channel.close();
  });

  it('retries a failing handler 3 times, then dead-letters the message', async () => {
    let attempts = 0;
    await bus.subscribe('payment-service', {
      'user.registered': async () => {
        attempts += 1;
        throw new Error('always fails');
      },
    });

    await bus.publish('user.registered', payload);

    const channel = await channelForChecks();
    const dlq = queueNames('payment-service').deadLetter;
    await until(async () => (await channel.checkQueue(dlq)).messageCount === 1, 25_000);

    expect(attempts).toBe(4);
    const message = await channel.get(dlq);
    if (message === false) {
      throw new Error('expected a message in the DLQ');
    }
    expect(message.properties.headers?.[RETRY_COUNT_HEADER]).toBe(3);
    expect(message.properties.headers?.[DEAD_LETTER_REASON_HEADER]).toBe(
      'Handler failed after 3 retries',
    );
    expect(JSON.parse(message.content.toString()).payload).toEqual(payload);
    channel.ack(message);
    await channel.close();
  }, 30_000);

  it('recovers when a handler succeeds on a retry', async () => {
    let attempts = 0;
    await bus.subscribe('payment-service', {
      'user.registered': async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('fails once');
        }
      },
    });

    await bus.publish('user.registered', payload);

    await until(() => attempts === 2, 10_000);
    const channel = await channelForChecks();
    expect((await channel.checkQueue(queueNames('payment-service').deadLetter)).messageCount).toBe(
      0,
    );
    await channel.close();
  }, 15_000);
});
