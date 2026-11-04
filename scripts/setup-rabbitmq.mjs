// Creates the RabbitMQ exchange, queues, dead-letter queues and bindings (owner: Anesa, task B-03).
// Run with `npm run rabbitmq:setup`. It is safe to run repeatedly. RABBITMQ_URL in .env.example
// uses the Docker host name; from your own machine, use localhost:
//   RABBITMQ_URL=amqp://auction:change-me-rabbit@localhost:5672 npm run rabbitmq:setup
import { DEFAULT_EVENTS_EXCHANGE, createLogger, setupTopology } from '@auction/shared-common';

const logger = createLogger({ service: 'rabbitmq-setup' });
const url = process.env.RABBITMQ_URL;

if (!url) {
  logger.error('RABBITMQ_URL is not set');
  process.exit(1);
}

try {
  await setupTopology(url, logger, process.env.EVENTS_EXCHANGE ?? DEFAULT_EVENTS_EXCHANGE);
} catch (err) {
  logger.error({ err }, 'could not set up RabbitMQ');
  process.exitCode = 1;
}
