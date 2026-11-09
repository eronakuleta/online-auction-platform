import express from 'express';
import request from 'supertest';
import { installMetrics } from '../http/metrics';

it('counts status and duration with bounded route labels and isolated registries', async () => {
  const app = express();
  installMetrics(app, 'test-service');
  app.get('/items/:id', (_req, res) => res.sendStatus(409));
  await request(app).get('/items/secret-user-id');
  await request(app).get('/unknown-private-path');
  const metrics = await request(app).get('/metrics').expect(200);
  expect(metrics.text).toContain(
    'http_requests_total{method="GET",route="/items/:id",status="409",service="test-service"} 1',
  );
  expect(metrics.text).toContain('http_request_duration_seconds_bucket');
  expect(metrics.text).toContain('process_resident_memory_bytes');
  expect(metrics.text).not.toContain('secret-user-id');
  expect(metrics.text).not.toContain('unknown-private-path');
  const other = express();
  installMetrics(other, 'other-service');
  expect((await request(other).get('/metrics')).text).not.toContain('status="409"');
});
