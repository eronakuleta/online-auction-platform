import type { Queryable } from './database';

// Wallets and the ledger (database/payment/001_schema.sql). The only place with SQL for them.

export interface Wallet {
  id: string;
  userId: string;
  balanceCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export type LedgerEntryType = 'DEPOSIT' | 'SETTLEMENT_DEBIT' | 'SETTLEMENT_CREDIT' | 'PLATFORM_FEE';

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  amountCents: number;
  balanceAfterCents: number;
  settlementId: string | null;
  createdAt: Date;
}

// pg returns bigint as a string, because it can exceed what a JS number holds exactly. Deposits are
// capped (schemas), so balances stay far below Number.MAX_SAFE_INTEGER and Number() loses nothing.
interface WalletRow {
  id: string;
  user_id: string;
  balance_cents: string;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

interface LedgerRow {
  id: string;
  type: LedgerEntryType;
  amount_cents: string;
  balance_after_cents: string;
  settlement_id: string | null;
  created_at: Date;
}

function toWallet(row: WalletRow): Wallet {
  return {
    id: row.id,
    userId: row.user_id,
    balanceCents: Number(row.balance_cents),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    type: row.type,
    amountCents: Number(row.amount_cents),
    balanceAfterCents: Number(row.balance_after_cents),
    settlementId: row.settlement_id,
    createdAt: row.created_at,
  };
}

const WALLET_COLUMNS = 'id, user_id, balance_cents, currency, created_at, updated_at';

/** Only USER wallets: the platform wallet has no user and is never reachable through this API. */
export async function findWalletByUserId(db: Queryable, userId: string): Promise<Wallet | null> {
  const { rows } = await db.query<WalletRow>(
    `SELECT ${WALLET_COLUMNS} FROM wallets WHERE user_id = $1 AND kind = 'USER'`,
    [userId],
  );
  return rows[0] ? toWallet(rows[0]) : null;
}

/**
 * Creates an empty wallet unless the user already has one. Returns true if it created one.
 * UNIQUE (user_id) makes this safe to repeat and safe in parallel: a second call inserts nothing.
 */
export async function createWalletIfMissing(
  db: Queryable,
  userId: string,
  currency: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO wallets (kind, user_id, currency) VALUES ('USER', $1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, currency],
  );
  return rowCount === 1;
}

/**
 * Adds money and writes its ledger row, in the caller's transaction. The UPDATE locks the wallet
 * row until the transaction ends, so parallel deposits run one after another, and each ledger row
 * records the balance right after its own deposit.
 */
export async function depositIntoWallet(
  db: Queryable,
  walletId: string,
  amountCents: number,
): Promise<{ wallet: Wallet; entry: LedgerEntry }> {
  const updated = await db.query<WalletRow>(
    `UPDATE wallets SET balance_cents = balance_cents + $2, updated_at = now()
     WHERE id = $1
     RETURNING ${WALLET_COLUMNS}`,
    [walletId, amountCents],
  );
  const walletRow = updated.rows[0];
  if (!walletRow) {
    throw new Error(`Wallet ${walletId} disappeared inside its own transaction`);
  }
  // clock_timestamp(), not the default now(): now() is when the transaction started, and a
  // transaction that started first can still get the lock last. The history must follow the lock
  // order, or a newer row could show an older balance.
  const inserted = await db.query<LedgerRow>(
    `INSERT INTO ledger_entries (wallet_id, type, amount_cents, balance_after_cents, created_at)
     VALUES ($1, 'DEPOSIT', $2, $3, clock_timestamp())
     RETURNING id, type, amount_cents, balance_after_cents, settlement_id, created_at`,
    [walletId, amountCents, walletRow.balance_cents],
  );
  const entryRow = inserted.rows[0];
  if (!entryRow) {
    throw new Error('INSERT ... RETURNING returned no row');
  }
  return { wallet: toWallet(walletRow), entry: toLedgerEntry(entryRow) };
}

/** One wallet's ledger, newest first. The id breaks ties, so paging never repeats or skips a row. */
export async function listLedgerEntries(
  db: Queryable,
  walletId: string,
  page: { limit: number; offset: number },
): Promise<{ entries: LedgerEntry[]; total: number }> {
  const [list, count] = await Promise.all([
    db.query<LedgerRow>(
      `SELECT id, type, amount_cents, balance_after_cents, settlement_id, created_at
       FROM ledger_entries WHERE wallet_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [walletId, page.limit, page.offset],
    ),
    db.query<{ total: string }>(
      'SELECT count(*) AS total FROM ledger_entries WHERE wallet_id = $1',
      [walletId],
    ),
  ]);
  return { entries: list.rows.map(toLedgerEntry), total: Number(count.rows[0]?.total ?? 0) };
}
