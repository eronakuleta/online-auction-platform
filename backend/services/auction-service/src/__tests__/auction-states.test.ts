// Unit test of the auction state machine (task A-15). Every one of the 7 x 7 status pairs is
// checked, so adding or removing a transition by accident always fails a test.
import type { AuctionStatus } from '../repositories/auction.repository';
import { canMoveTo } from '../services/auction-states';

const STATUSES: AuctionStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'CANCELLED',
  'CLOSED_SOLD',
  'CLOSED_NO_SALE',
  'SETTLED',
  'PAYMENT_FAILED',
];

/** The only allowed changes (ROADMAP §4). */
const ALLOWED = new Set([
  'DRAFT->PUBLISHED',
  'DRAFT->CANCELLED',
  'PUBLISHED->CANCELLED',
  'PUBLISHED->CLOSED_SOLD',
  'PUBLISHED->CLOSED_NO_SALE',
  'CLOSED_SOLD->SETTLED',
  'CLOSED_SOLD->PAYMENT_FAILED',
]);

const pairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const));

describe('canMoveTo', () => {
  it.each(pairs)('%s -> %s', (from, to) => {
    expect(canMoveTo(from, to)).toBe(ALLOWED.has(`${from}->${to}`));
  });

  it('allows exactly 7 transitions', () => {
    expect(pairs.filter(([from, to]) => canMoveTo(from, to))).toHaveLength(7);
  });

  it.each(['CANCELLED', 'CLOSED_NO_SALE', 'SETTLED', 'PAYMENT_FAILED'] as const)(
    '%s is final: nothing can follow it',
    (from) => {
      expect(STATUSES.some((to) => canMoveTo(from, to))).toBe(false);
    },
  );

  it('never lets a status move to itself', () => {
    expect(STATUSES.some((status) => canMoveTo(status, status))).toBe(false);
  });
});
