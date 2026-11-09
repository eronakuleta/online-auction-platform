import type { Express } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** One registry per app, so tests and replicas never share counters. No user IDs or raw URLs. */
export function installMetrics(app: Express, service: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  const requests = new Counter({
    name: 'http_requests_total',
    help: 'Completed HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP response duration, including open SSE connection lifetime',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });
  app.use((req, res, next) => {
    if (req.path === '/metrics' || req.path === '/health') return next();
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      // Express route templates bound cardinality; unmatched paths all use one label.
      const route: unknown = req.route?.path;
      const labels = {
        method: req.method,
        route: typeof route === 'string' ? `${req.baseUrl}${route}` : 'unmatched',
        status: String(res.statusCode),
      };
      requests.inc(labels);
      duration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
    });
    next();
  });
  app.get('/metrics', async (_req, res) => {
    res.type(registry.contentType).send(await registry.metrics());
  });
  return registry;
}
