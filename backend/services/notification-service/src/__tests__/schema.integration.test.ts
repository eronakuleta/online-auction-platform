// B-14: the table's own rules, checked on a real Postgres built from database/notification.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIDDER1_ID, CAMERA_ID, createTestContext, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

function insert(overrides: Record<string, unknown> = {}) {
  const row = {
    user_id: BIDDER1_ID,
    event_id: randomUUID(),
    type: 'OUTBID',
    title: 'You were outbid',
    message: 'Someone placed a higher bid.',
    auction_id: CAMERA_ID,
    ...overrides,
  };
  return ctx.pool.query(
    `INSERT INTO notifications (user_id, event_id, type, title, message, auction_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.user_id, row.event_id, row.type, row.title, row.message, row.auction_id],
  );
}

describe('seed data', () => {
  it('loads the demo notifications, with the bell showing two unread for bidder1 and the seller', async () => {
    const unread = await ctx.pool.query<{ user_id: string; n: number }>(
      `SELECT user_id, count(*)::int AS n FROM notifications WHERE read_at IS NULL
       GROUP BY user_id ORDER BY user_id`,
    );
    expect(unread.rows).toEqual([
      { user_id: '00000000-0000-4000-8000-000000000002', n: 1 },
      { user_id: '00000000-0000-4000-8000-000000000003', n: 1 },
    ]);
    expect(await ctx.count()).toBe(6);
  });

  it('is safe to run again', async () => {
    const seed = readFileSync(
      join(__dirname, '../../../../../database/notification/002_seed.sql'),
      'utf8',
    );
    await ctx.pool.query(seed);
    expect(await ctx.count()).toBe(6);
  });
});

describe('constraints', () => {
  it('accepts a normal notification', async () => {
    await expect(insert()).resolves.toBeDefined();
  });

  it('refuses an unknown type', async () => {
    await expect(insert({ type: 'SPAM' })).rejects.toThrow(/notifications_type_known/);
  });

  it('refuses a blank title or message', async () => {
    await expect(insert({ title: '   ' })).rejects.toThrow(/notifications_title_length/);
    await expect(insert({ message: '' })).rejects.toThrow(/notifications_message_length/);
  });

  it('refuses a title over 120 and a message over 1000 characters', async () => {
    await expect(insert({ title: 'x'.repeat(121) })).rejects.toThrow(/notifications_title_length/);
    await expect(insert({ message: 'x'.repeat(1001) })).rejects.toThrow(
      /notifications_message_length/,
    );
    await expect(insert({ message: 'x'.repeat(1000) })).resolves.toBeDefined();
  });

  it('refuses a welcome message about an auction, and any other type without one', async () => {
    await expect(insert({ type: 'WELCOME' })).rejects.toThrow(/notifications_auction_matches_type/);
    await expect(insert({ auction_id: null })).rejects.toThrow(
      /notifications_auction_matches_type/,
    );
    await expect(insert({ type: 'WELCOME', auction_id: null })).resolves.toBeDefined();
  });

  it('refuses a second notification for the same event and user', async () => {
    const eventId = randomUUID();
    await insert({ event_id: eventId });
    await expect(insert({ event_id: eventId })).rejects.toThrow(/notifications_event_user_unique/);
  });

  it('allows one event to notify different users', async () => {
    const eventId = randomUUID();
    await insert({ event_id: eventId });
    await expect(
      insert({ event_id: eventId, user_id: '00000000-0000-4000-8000-000000000004' }),
    ).resolves.toBeDefined();
  });

  it('refuses a read time before the creation time', async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO notifications (user_id, event_id, type, title, message, auction_id, created_at, read_at)
         VALUES ($1, $2, 'OUTBID', 't', 'm', $3, now(), now() - interval '1 day')`,
        [BIDDER1_ID, randomUUID(), CAMERA_ID],
      ),
    ).rejects.toThrow(/notifications_read_after_created/);
  });
});

describe('indexes', () => {
  it('serves the list and the unread count from their own indexes', async () => {
    // With a handful of rows Postgres would choose a table scan on its own, so scans are
    // disabled to show that the indexes are usable for the two queries of B-15.
    const explain = async (sql: string) => {
      const client = await ctx.pool.connect();
      try {
        await client.query('SET enable_seqscan = off');
        const result = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, [BIDDER1_ID]);
        return result.rows.map((row) => row['QUERY PLAN']).join('\n');
      } finally {
        client.release();
      }
    };
    expect(
      await explain(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 20',
      ),
    ).toContain('notifications_user_created_idx');
    expect(
      await explain('SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL'),
    ).toContain('notifications_user_unread_idx');
  });
});
