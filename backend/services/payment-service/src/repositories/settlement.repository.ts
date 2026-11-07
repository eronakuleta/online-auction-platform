import type { Queryable } from './database';
import type { LedgerEntryType } from './wallet.repository';

// Settlements and the money moves they cause (database/payment/001_schema.sql). The only place
// with SQL for them.

export type SettlementStatus = 'COMPLETED' | 'FAILED';
export type FailureReason = 'INSUFFICIENT_FUNDS' | 'WALLET_NOT_FOUND';

export interface Settlement {
  id: string;
  auctionId: string;
  winnerId: string;
  sellerId: string;
  amountCents: number;
  currency: string;
  status: SettlementStatus;
  feeCents: number | null;
  sellerCents: number | null;
  failureReason: FailureReason | null;
  createdAt: Date;
}

interface SettlementRow {
  id: string;
  auction_id: string;
  winner_id: string;
  seller_id: string;
  amount_cents: string;
  currency: string;
  status: SettlementStatus;
  fee_cents: string | null;
  seller_cents: string | null;
  failure_reason: FailureReason | null;
  created_at: Date;
}

const COLUMNS =
  'id, auction_id, winner_id, seller_id, amount_cents, currency, status, fee_cents, seller_cents, failure_reason, created_at';

function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    auctionId: row.auction_id,
    winnerId: row.winner_id,
    sellerId: row.seller_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status,
    feeCents: row.fee_cents === null ? null : Number(row.fee_cents),
    sellerCents: row.seller_cents === null ? null : Number(row.seller_cents),
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export type NewSettlement = Pick<
  Settlement,
  'auctionId' | 'winnerId' | 'sellerId' | 'amountCents' | 'currency'
> &
  (
    | { status: 'COMPLETED'; feeCents: number; sellerCents: number }
    | { status: 'FAILED'; failureReason: FailureReason }
  );

/**
 * Records the result for an auction, or returns null if one is already recorded. UNIQUE
 * (auction_id) decides, so a replayed or parallel auction.closed can never settle twice: the second
 * INSERT waits for the first transaction and then inserts nothing.
 */
export async function insertSettlement(
  db: Queryable,
  settlement: NewSettlement,
): Promise<Settlement | null> {
  const completed = settlement.status === 'COMPLETED';
  const { rows } = await db.query<SettlementRow>(
    `INSERT INTO settlements
       (auction_id, winner_id, seller_id, amount_cents, currency, status, fee_cents, seller_cents,
        failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (auction_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      settlement.auctionId,
      settlement.winnerId,
      settlement.sellerId,
      settlement.amountCents,
      settlement.currency,
      settlement.status,
      completed ? settlement.feeCents : null,
      completed ? settlement.sellerCents : null,
      completed ? null : settlement.failureReason,
    ],
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function findPlatformWalletId(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM wallets WHERE kind = 'PLATFORM'`);
  return rows[0]?.id ?? null;
}

/**
 * Locks the wallets until the transaction ends and returns their balances. Always in ID order, so
 * two settlements touching the same wallets lock them in the same order and cannot deadlock.
 */
export async function lockWallets(db: Queryable, ids: string[]): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: string; balance_cents: string }>(
    `SELECT id, balance_cents FROM wallets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, Number(row.balance_cents)]));
}

/** Changes a balance and writes its ledger row, inside the caller's transaction. */
export async function moveMoney(
  db: Queryable,
  move: { walletId: string; type: LedgerEntryType; amountCents: number; settlementId: string },
): Promise<void> {
  const { rows } = await db.query<{ balance_cents: string }>(
    `UPDATE wallets SET balance_cents = balance_cents + $2, updated_at = now()
     WHERE id = $1 RETURNING balance_cents`,
    [move.walletId, move.amountCents],
  );
  if (!rows[0]) {
    throw new Error(`Wallet ${move.walletId} disappeared during a settlement`);
  }
  await db.query(
    `INSERT INTO ledger_entries
       (wallet_id, type, amount_cents, balance_after_cents, settlement_id, created_at)
     VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
    [move.walletId, move.type, move.amountCents, rows[0].balance_cents, move.settlementId],
  );
}

/** For GET /payments (ADMIN): newest first; the id breaks ties so paging is stable. */
export async function listSettlements(
  db: Queryable,
  filter: { status?: SettlementStatus; limit: number; offset: number },
): Promise<{ settlements: Settlement[]; total: number }> {
  const values: unknown[] = [];
  let where = '';
  if (filter.status !== undefined) {
    values.push(filter.status);
    where = ' WHERE status = $1';
  }
  const limitParam = '$' + (values.length + 1);
  const offsetParam = '$' + (values.length + 2);
  const { rows } = await db.query<SettlementRow>(
    'SELECT ' +
      COLUMNS +
      ' FROM settlements' +
      where +
      ' ORDER BY created_at DESC, id LIMIT ' +
      limitParam +
      ' OFFSET ' +
      offsetParam,
    [...values, filter.limit, filter.offset],
  );
  const count = await db.query<{ total: string }>(
    'SELECT count(*) AS total FROM settlements' + where,
    values,
  );
  return { settlements: rows.map(toSettlement), total: Number(count.rows[0]?.total ?? 0) };
}
