import { Writable } from 'node:stream';
import type { ConsumeMessage, Options } from 'amqplib';
import { createLogger } from '../logger/logger';
import type { Logger } from '../logger/logger';
import type { ConsumeChannel } from '../events/consumer';

export const IDS = {
  auction: '11111111-1111-4111-8111-111111111111',
  seller: '22222222-2222-4222-8222-222222222222',
  bidder: '33333333-3333-4333-8333-333333333333',
  other: '44444444-4444-4444-8444-444444444444',
  event: '55555555-5555-4555-8555-555555555555',
};

/** A logger that keeps its JSON lines in memory, so a test can read them. */
export function memoryLogger(level = 'debug'): {
  logger: Logger;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  return {
    logger: createLogger({ service: 'test-service', level, destination }),
    lines: () => chunks.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

interface Sent {
  queue: string;
  content: Buffer;
  options: Options.Publish;
}

/** A stand-in for a RabbitMQ channel. It records what the consumer does with each message. */
export class FakeChannel {
  sent: Sent[] = [];
  acked: ConsumeMessage[] = [];
  nacked: { message: ConsumeMessage; requeue: boolean | undefined }[] = [];
  prefetchCount = 0;
  cancelledTag: string | undefined;
  failNextSend = false;
  private onMessage: ((message: ConsumeMessage | null) => void) | undefined;

  asChannel(): ConsumeChannel {
    return this as unknown as ConsumeChannel;
  }

  async prefetch(count: number): Promise<void> {
    this.prefetchCount = count;
  }

  async consume(_queue: string, onMessage: (message: ConsumeMessage | null) => void) {
    this.onMessage = onMessage;
    return { consumerTag: 'tag-1' };
  }

  async cancel(consumerTag: string) {
    this.cancelledTag = consumerTag;
    return { consumerTag };
  }

  ack(message: ConsumeMessage): void {
    this.acked.push(message);
  }

  nack(message: ConsumeMessage, _allUpTo?: boolean, requeue?: boolean): void {
    this.nacked.push({ message, requeue });
  }

  sendToQueue(
    queue: string,
    content: Buffer,
    options: Options.Publish,
    callback: (err: Error | null) => void,
  ): boolean {
    if (this.failNextSend) {
      this.failNextSend = false;
      callback(new Error('broker refused the message'));
      return true;
    }
    this.sent.push({ queue, content, options });
    callback(null);
    return true;
  }

  /** Delivers a message and waits until the consumer has acked, nacked or moved it. */
  async deliver(body: Buffer, headers: Record<string, unknown> = {}): Promise<void> {
    const before = this.acked.length + this.nacked.length;
    this.onMessage?.({
      content: body,
      fields: {},
      properties: { headers, messageId: 'message-1', contentType: 'application/json' },
    } as unknown as ConsumeMessage);
    while (this.acked.length + this.nacked.length === before) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  cancelFromBroker(): void {
    this.onMessage?.(null);
  }
}
