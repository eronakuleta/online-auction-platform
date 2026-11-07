// Task A-24: docs/api/payment.yaml and the code describe the same API. Every route in the code is
// in the spec, and every operation in the spec exists (it is not answered by the "route not found"
// handler). Public routes live under /api/v1; the internal router is mounted at /internal and its
// spec paths start with /internal. The spec is read with a small parser for the fixed layout of our
// YAML files (two spaces before a path, four before a method), so no YAML library is needed.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createTestContext, type TestContext } from './helpers';

const SPEC = join(__dirname, '../../../../../docs/api/payment.yaml');
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
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch?.[1]) path = pathMatch[1];
    const methodMatch = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (methodMatch?.[1]) operations.push(`${methodMatch[1].toUpperCase()} ${path}`);
  }
  return operations.sort();
}

function routesIn(source: string, prefix: string): string[] {
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map(
    ([, method, path]) => `${method?.toUpperCase()} ${prefix}${path?.replace(/:(\w+)/g, '{$1}')}`,
  );
}

function implementedOperations(): string[] {
  const source = readFileSync(ROUTES, 'utf8');
  const [publicPart = '', internalPart = ''] = source.split('export function createInternalRoutes');
  return [...routesIn(publicPart, ''), ...routesIn(internalPart, '/internal')].sort();
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('docs/api/payment.yaml', () => {
  it('documents exactly the routes the code has, the internal funds check included', () => {
    expect(documentedOperations()).toEqual(implementedOperations());
    expect(documentedOperations()).toContain('GET /internal/funds-check');
  });

  it.each(documentedOperations())('%s exists in the running app', async (operation) => {
    const [method, path] = operation.split(' ') as [string, string];
    const base = path.startsWith('/internal') ? '' : '/api/v1';
    const url = `${base}${path.replace(/\{\w+\}/g, randomUUID())}`;
    const response = await request(ctx.app)[method.toLowerCase() as Method](url).send({});

    expect(response.body?.error?.message ?? '').not.toMatch(/^Route .* not found$/);
  });
});
