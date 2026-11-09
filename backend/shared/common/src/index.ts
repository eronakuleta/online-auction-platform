// Public API of @auction/shared-common.
export { createLogger } from './logger/logger';
export type { Logger, LoggerOptions } from './logger/logger';
export { getCorrelationId, resolveCorrelationId, runWithCorrelationId } from './logger/correlation';

export {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from './errors/app-error';
export type { ErrorBody, ErrorDetail } from './errors/app-error';

export {
  REQUEST_ID_HEADER,
  correlationMiddleware,
  createErrorHandler,
  notFoundHandler,
  requestLogger,
} from './http/middleware';

export { EVENT_CATALOG } from './events/contract';
export type { DomainEvent, EventPayload, EventType } from './events/contract';
export { createEvent, parseEvent } from './events/envelope';
export type { ParsedEvent } from './events/envelope';
export { CORRELATION_HEADER, createPublisher } from './events/publisher';
export type { Publish } from './events/publisher';
export { DEAD_LETTER_REASON_HEADER, RETRY_COUNT_HEADER, startConsumer } from './events/consumer';
export type {
  ConsumeChannel,
  Consumer,
  ConsumerOptions,
  EventHandler,
  EventHandlers,
} from './events/consumer';
export { connectEventBus, connectWithRetry } from './events/event-bus';
export type { EventBus, EventBusOptions } from './events/event-bus';
export {
  DEFAULT_EVENTS_EXCHANGE,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  SERVICE_SUBSCRIPTIONS,
  applyTopology,
  queueNames,
} from './events/topology';
export type { ConsumerService } from './events/topology';
export { setupTopology } from './events/setup-topology';

export { installMetrics } from './http/metrics';
