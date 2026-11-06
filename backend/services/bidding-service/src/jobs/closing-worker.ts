// Runs the closing service on a timer. Every replica runs one; SKIP LOCKED in the query keeps
// them from closing the same auction twice.
import type { Logger } from '@auction/shared-common';
import type { ClosingService } from '../services/closing.service';

export interface ClosingWorker {
  /** Stops the timer and waits for a round in progress to finish. */
  stop(): Promise<void>;
}

export function startClosingWorker(options: {
  closingService: ClosingService;
  intervalMs: number;
  batchSize: number;
  logger: Logger;
}): ClosingWorker {
  const { closingService, intervalMs, batchSize, logger } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();

  const round = async () => {
    try {
      // A full batch means more may be waiting, so keep going instead of waiting a whole interval.
      let closed: number;
      do {
        closed = await closingService.closeExpiredAuctions();
      } while (closed === batchSize && !stopped);
    } catch (err) {
      // The next round tries again; nothing is lost because the transaction rolled back.
      logger.error({ err }, 'closing round failed');
    }
  };

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      current = round().then(schedule);
    }, intervalMs);
  };

  schedule();
  logger.info({ intervalMs, batchSize }, 'closing worker started');

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
