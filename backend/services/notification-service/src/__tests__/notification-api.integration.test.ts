// B-15: the notification endpoints on a real Postgres with real RS256 tokens.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ADMIN_ID,
  BIDDER1_ID,
  BIDDER2_ID,
  SELLER_ID,
  bidPlaced,
  createTestContext,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
  // The seed adds demo notifications; most tests build their own so they know exact numbers.
  await ctx.pool.query('DELETE FROM notifications');
});

afterEach(async () => {
  await ctx.close();
});

/** Adds a notification straight into the database, created `minutesAgo` minutes ago. */
async function add(
  userId: string,
  options: { minutesAgo?: number; read?: boolean; title?: string } = {},
) {
  const result = await ctx.pool.query<{ id: string }>(
    `INSERT INTO notifications (user_id, event_id, type, title, message, auction_id, created_at, read_at)
     VALUES ($1, $2, 'OUTBID', $3, 'Someone placed a higher bid.', $4,
       now() - make_interval(mins => $5), CASE WHEN $6 THEN now() - make_interval(mins => $5) END)
     RETURNING id`,
    [
      userId,
      randomUUID(),
      options.title ?? 'You were outbid',
      randomUUID(),
      options.minutesAgo ?? 0,
      options.read ?? false,
    ],
  );
  return result.rows[0]!.id;
}

const as = (method: 'get' | 'post' | 'patch', path: string, token?: string) => {
  const req = request(ctx.app)[method](`/api/v1${path}`);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
};
const tokenOf = (userId: string) => ctx.tokenFor(userId);

describe('GET /notifications', () => {
  it('lists only my notifications, newest first, without internal fields', async () => {
    await add(BIDDER1_ID, { minutesAgo: 30, title: 'oldest' });
    await add(BIDDER1_ID, { minutesAgo: 1, title: 'newest' });
    await add(BIDDER1_ID, { minutesAgo: 10, title: 'middle', read: true });
    await add(BIDDER2_ID, { title: 'not mine' });

    const res = await as('get', '/notifications', tokenOf(BIDDER1_ID));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, size: 20, total: 3 });
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      type: 'OUTBID',
      title: 'newest',
      message: 'Someone placed a higher bid.',
      auctionId: expect.any(String),
      readAt: null,
      createdAt: expect.any(String),
    });
    expect(res.body.data[1].readAt).toEqual(expect.any(String));
    expect(res.body.data[0]).not.toHaveProperty('userId');
    expect(res.body.data[0]).not.toHaveProperty('eventId');
  });

  it('pages through the list without skipping or repeating a row', async () => {
    for (let i = 0; i < 5; i += 1) {
      await add(BIDDER1_ID, { minutesAgo: i + 1, title: `n${i + 1}` });
    }
    const titles = async (page: number) =>
      (await as('get', `/notifications?page=${page}&size=2`, tokenOf(BIDDER1_ID))).body.data.map(
        (n: { title: string }) => n.title,
      );
    expect(await titles(1)).toEqual(['n1', 'n2']);
    expect(await titles(2)).toEqual(['n3', 'n4']);
    expect(await titles(3)).toEqual(['n5']);
    expect(await titles(4)).toEqual([]);
  });

  it('keeps a stable order for notifications created in the same instant', async () => {
    for (let i = 0; i < 6; i += 1) {
      await add(BIDDER1_ID, { minutesAgo: 0 });
    }
    const ids = async (page: number) =>
      (await as('get', `/notifications?page=${page}&size=2`, tokenOf(BIDDER1_ID))).body.data.map(
        (n: { id: string }) => n.id,
      );
    const all = [...(await ids(1)), ...(await ids(2)), ...(await ids(3))];
    expect(new Set(all).size).toBe(6);
  });

  it('returns an empty list for a user without notifications, admins included', async () => {
    for (const userId of [randomUUID(), ADMIN_ID]) {
      const res = await as(
        'get',
        '/notifications',
        ctx.tokenFor(userId, userId === ADMIN_ID ? ['ADMIN'] : ['BIDDER']),
      );
      expect(res.body).toEqual({ data: [], page: 1, size: 20, total: 0 });
    }
  });

  it.each([['page=0'], ['page=x'], ['size=0'], ['size=101'], ['unknown=1']])(
    'rejects the query %s with 400',
    async (query) => {
      const res = await as('get', `/notifications?${query}`, tokenOf(BIDDER1_ID));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('serves any logged-in role', async () => {
    await add(SELLER_ID);
    for (const roles of [['BIDDER'], ['SELLER'], ['BIDDER', 'SELLER']] as const) {
      const res = await as('get', '/notifications', ctx.tokenFor(SELLER_ID, [...roles]));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    }
  });
});

describe('GET /notifications/unread-count', () => {
  it('counts only my unread notifications', async () => {
    await add(BIDDER1_ID);
    await add(BIDDER1_ID);
    await add(BIDDER1_ID, { read: true });
    await add(BIDDER2_ID);

    const res = await as('get', '/notifications/unread-count', tokenOf(BIDDER1_ID));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unreadCount: 2 });
  });

  it('is zero for a user without notifications', async () => {
    const res = await as('get', '/notifications/unread-count', tokenOf(randomUUID()));
    expect(res.body).toEqual({ unreadCount: 0 });
  });

  it('is not mistaken for a notification ID', async () => {
    // "unread-count" is a path of its own, not the :id of PATCH /notifications/:id/read.
    const res = await as('get', '/notifications/unread-count', tokenOf(BIDDER1_ID));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('marks one notification as read and lowers the unread count', async () => {
    const id = await add(BIDDER1_ID);
    await add(BIDDER1_ID);

    const res = await as('patch', `/notifications/${id}/read`, tokenOf(BIDDER1_ID));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, readAt: expect.any(String) });
    expect(
      (await as('get', '/notifications/unread-count', tokenOf(BIDDER1_ID))).body.unreadCount,
    ).toBe(1);
  });

  it('keeps the first read time when marked twice', async () => {
    const id = await add(BIDDER1_ID);
    const first = await as('patch', `/notifications/${id}/read`, tokenOf(BIDDER1_ID));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await as('patch', `/notifications/${id}/read`, tokenOf(BIDDER1_ID));
    expect(second.status).toBe(200);
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it('returns 403 for someone else’s notification and changes nothing', async () => {
    const id = await add(BIDDER2_ID);

    const res = await as('patch', `/notifications/${id}/read`, tokenOf(BIDDER1_ID));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(
      (await as('get', '/notifications/unread-count', tokenOf(BIDDER2_ID))).body.unreadCount,
    ).toBe(1);
  });

  it('returns 404 for a notification that does not exist', async () => {
    const res = await as('patch', `/notifications/${randomUUID()}/read`, tokenOf(BIDDER1_ID));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('returns 400 for an ID that is not a UUID', async () => {
    const res = await as('patch', '/notifications/abc/read', tokenOf(BIDDER1_ID));
    expect(res.status).toBe(400);
  });
});

describe('POST /notifications/read-all', () => {
  it('marks all my unread notifications as read and says how many', async () => {
    await add(BIDDER1_ID);
    await add(BIDDER1_ID);
    await add(BIDDER1_ID, { read: true });

    const res = await as('post', '/notifications/read-all', tokenOf(BIDDER1_ID));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(
      (await as('get', '/notifications/unread-count', tokenOf(BIDDER1_ID))).body.unreadCount,
    ).toBe(0);
  });

  it('never touches another user’s notifications', async () => {
    await add(BIDDER1_ID);
    await add(BIDDER2_ID);
    await as('post', '/notifications/read-all', tokenOf(BIDDER1_ID));
    expect(
      (await as('get', '/notifications/unread-count', tokenOf(BIDDER2_ID))).body.unreadCount,
    ).toBe(1);
  });

  it('changes nothing the second time', async () => {
    await add(BIDDER1_ID);
    await as('post', '/notifications/read-all', tokenOf(BIDDER1_ID));
    const again = await as('post', '/notifications/read-all', tokenOf(BIDDER1_ID));
    expect(again.body).toEqual({ updated: 0 });
  });

  it('keeps the original read time of notifications that were already read', async () => {
    const id = await add(BIDDER1_ID, { minutesAgo: 60, read: true });
    const before = (
      await ctx.pool.query<{ read_at: Date }>('SELECT read_at FROM notifications WHERE id = $1', [
        id,
      ])
    ).rows[0]!.read_at;
    await add(BIDDER1_ID);
    await as('post', '/notifications/read-all', tokenOf(BIDDER1_ID));
    const after = (
      await ctx.pool.query<{ read_at: Date }>('SELECT read_at FROM notifications WHERE id = $1', [
        id,
      ])
    ).rows[0]!.read_at;
    expect(after).toEqual(before);
  });
});

describe('authentication', () => {
  const endpoints: ['get' | 'post' | 'patch', string][] = [
    ['get', '/notifications'],
    ['get', '/notifications/unread-count'],
    ['post', '/notifications/read-all'],
    ['patch', `/notifications/${randomUUID()}/read`],
  ];

  it.each(endpoints)('%s %s returns 401 without a token', async (method, path) => {
    const res = await as(method, path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a forged token', async () => {
    const res = await as('get', '/notifications', 'abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('answers an unknown path with 404, not 401', async () => {
    const res = await request(ctx.app).get('/api/v1/nothing-here');
    expect(res.status).toBe(404);
  });
});

describe('events become visible through the API', () => {
  it('shows a notification created by an event handler in the list and the unread count', async () => {
    await ctx.handlers['bid.placed']!(bidPlaced());

    const list = await as('get', '/notifications', tokenOf(BIDDER1_ID));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ type: 'OUTBID', readAt: null });
    expect(
      (await as('get', '/notifications/unread-count', tokenOf(BIDDER1_ID))).body.unreadCount,
    ).toBe(1);
  });
});
