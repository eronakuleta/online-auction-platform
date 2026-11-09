// Task A-24: docs/api/notification.yaml and the code describe the same API. Every route in the code is in
// the spec, and every operation in the spec exists (it is not answered by the "route not found"
// handler). The spec's paths are read with a small parser for the fixed layout of our YAML files
// (two spaces before a path, four before a method), so no YAML library is needed.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createTestContext, type TestContext } from './helpers';

const SPEC = join(__dirname, '../../../../../docs/api/notification.yaml');
const ROUTES = join(__dirname, '../routes/index.ts');
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

function documentedOperations(): string[] {
  const operations: string[] = [];
  let section = '';
  let path = '';
  for (const line of readFileSync(SPEC, 'utf8').split('\n')) {
    const top = /^(\w+):/.exec(line);
    if (top?.[1]) section = top[1];
    if (section !== 'paths') continue;
    const pathMatch = /^ {2}["']?(\/[^"'\s]*)["']?:\s*$/.exec(line);
    if (pathMatch?.[1]) path = pathMatch[1];
    const methodMatch = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (methodMatch?.[1]) operations.push(`${methodMatch[1].toUpperCase()} ${path}`);
  }
  return operations.sort();
}

function implementedOperations(): string[] {
  const source = readFileSync(ROUTES, 'utf8');
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)]
    .map(([, method, path]) => `${method?.toUpperCase()} ${path?.replace(/:(\w+)/g, '{$1}')}`)
    .sort();
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('docs/api/notification.yaml', () => {
  it('documents exactly the routes the code has', () => {
    expect(documentedOperations()).toEqual(implementedOperations());
    expect(documentedOperations().length).toBeGreaterThan(3);
  });

  it.each(documentedOperations())('%s exists in the running app', async (operation) => {
    const [method, path] = operation.split(' ') as [string, string];
    const url = `/api/v1${path.replace(/\{\w+\}/g, randomUUID())}`;
    const response = await request(ctx.app)[method.toLowerCase() as Method](url).send({});

    // Any answer but the generic "Route ... not found" shows the route is wired up.
    expect(response.body?.error?.message ?? '').not.toMatch(/^Route .* not found$/);
  });
});
