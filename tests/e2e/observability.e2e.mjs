import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

for (const [service, port] of [
  ['auth', 3001],
  ['auction', 3002],
  ['bidding', 3003],
  ['payment', 3004],
  ['notification', 3005],
]) {
  test(`${service} exposes internal health and Prometheus metrics`, () => {
    const script = `const health = await fetch('http://localhost:${port}/health'); if (!health.ok) throw new Error('health'); await fetch('http://localhost:${port}/api/v1/nonexistent'); const r = await fetch('http://localhost:${port}/metrics'); const body = await r.text(); if (!r.ok || !body.includes('http_requests_total') || !body.includes('process_resident_memory_bytes') || !body.includes('service="${service}-service"')) throw new Error(body);`;
    execFileSync('docker', [
      'compose',
      'exec',
      '-T',
      `${service}-service`,
      'node',
      '--input-type=module',
      '-e',
      script,
    ]);
  });
}
test('metrics are not exposed by the gateway', async () => {
  const response = await fetch('https://localhost:8443/metrics');
  assert.equal(response.status, 404);
});
