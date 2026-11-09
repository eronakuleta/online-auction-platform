import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { cases } from '../tests/api-collection/cases.mjs';

const directory = 'tests/api-collection';
mkdirSync(`${directory}/environments`, { recursive: true });
writeFileSync(
  `${directory}/bruno.json`,
  JSON.stringify(
    {
      version: '1',
      name: 'Online Auction Platform',
      type: 'collection',
      ignore: ['node_modules', '.git'],
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  `${directory}/environments/Local.bru`,
  'vars {\n  baseUrl: https://localhost:8443/api/v1\n}\n',
);
let token;
const rows = [];
let failed = false;
for (const [index, item] of cases.entries()) {
  const method = item.method ?? 'GET';
  const content = `meta {\n  name: ${item.name}\n  type: http\n  seq: ${index + 1}\n}\n\n${method.toLowerCase()} {\n  url: {{baseUrl}}${item.path}\n  body: ${item.body ? 'json' : 'none'}\n  auth: none\n}\n\nheaders {\n  Content-Type: application/json\n${item.auth ? '  Authorization: Bearer {{token}}\n' : ''}}\n${
    item.body
      ? `\nbody:json {\n${JSON.stringify(item.body, null, 2)
          .split('\n')
          .map((line) => '  ' + line)
          .join('\n')}\n}\n`
      : ''
  }${item.saveToken ? '\nscript:post-response {\n  bru.setVar("token", res.getBody().accessToken);\n}\n' : ''}\ntests {\n  test("Expected HTTP ${item.expected}", function () {\n    expect(res.getStatus()).to.equal(${item.expected});\n  });\n}\n`;
  writeFileSync(`${directory}/${String(index + 1).padStart(2, '0')}-${item.id}.bru`, content);
  if (process.argv.includes('--generate-only')) continue;
  let response;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    response = await fetch(`https://localhost:8443/api/v1${item.path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(item.auth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: item.body ? JSON.stringify(item.body) : undefined,
    });
    if (response.status !== 429) break;
    await response.text();
    await sleep(Number(response.headers.get('retry-after') ?? 5) * 1000);
  }
  const body = await response.json();
  if (item.saveToken) token = body.accessToken;
  let passed = response.status === item.expected;
  if (item.expected >= 400)
    passed &&= typeof body.error?.code === 'string' && typeof body.error?.requestId === 'string';
  failed ||= !passed;
  rows.push(
    `| ${item.id} | ${method} ${item.path}${item.body ? ` ${JSON.stringify(item.body).replaceAll('|', '\\|')}` : ''} | ${item.expected} | ${response.status}${body.error ? ` ${body.error.code}` : ''} | ${passed ? 'Pass' : 'FAIL'} |`,
  );
}
if (!process.argv.includes('--generate-only')) {
  writeFileSync(
    'docs/api-collection-results.md',
    `# API collection results\n\nRecorded ${new Date().toISOString()}. The Node evidence runner executes the same cases that generate the Bruno collection against the real HTTPS gateway. This is not a claim that the Bruno GUI was run. Gateway 429 responses are retried before evaluating business behavior.\n\n| ID | Input | Expected HTTP | Actual | Pass/Fail |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`,
  );
  assert.ok(!failed, 'API collection failures; see docs/api-collection-results.md');
  process.stdout.write(`${rows.length} API collection cases passed\n`);
}
