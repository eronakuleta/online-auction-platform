// Turns an event into the notifications it creates (docs/events.md §3, FR-13). Pure: no database,
// no network, so every rule is tested exactly. Who is told what:
//   user.registered   -> the new user: WELCOME
//   bid.placed        -> the previous highest bidder: OUTBID
//   auction.closed    -> SOLD: the winner AUCTION_WON, every other bidder AUCTION_LOST, the seller
//                        ITEM_SOLD. NO_SALE: every bidder AUCTION_LOST, the seller NO_SALE
//   auction.cancelled -> the seller AUCTION_CANCELLED, but only when someone else (an admin)
//                        cancelled it; a seller who cancelled it knows already
//   payment.completed -> the winner and the seller: PAYMENT_COMPLETED
//   payment.failed    -> the winner and the seller: PAYMENT_FAILED
import type { EventPayload } from '@auction/shared-common';

export const NOTIFICATION_TYPES = [
  'WELCOME',
  'OUTBID',
  'AUCTION_WON',
  'AUCTION_LOST',
  'ITEM_SOLD',
  'NO_SALE',
  'AUCTION_CANCELLED',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A notification before it is stored. The event ID is added by the handler. */
export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** The auction it is about; null only for the welcome message. */
  auctionId: string | null;
}

/** 2400 and "EUR" become "€24.00". Money is integer cents everywhere (CLAUDE.md). */
export function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amountCents / 100);
}

/** Postgres text cannot hold a NUL character, and a stray one would make the handler fail forever. */
const clean = (text: string) => text.replaceAll('\0', '');

const quoted = (title: string) => `"${clean(title)}"`;

export function fromUserRegistered(payload: EventPayload<'user.registered'>): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: 'WELCOME',
      title: 'Welcome to the auction platform',
      message: `Hi ${clean(payload.displayName)}, your account is ready. Deposit some money in your wallet to start bidding.`,
      auctionId: null,
    },
  ];
}

export function fromBidPlaced(payload: EventPayload<'bid.placed'>): NewNotification[] {
  const { previousHighestBidderId } = payload;
  // The first bid has nobody to outbid. Bidding forbids outbidding yourself, but if it ever
  // happened the bidder should not be told they were outbid by themselves.
  if (previousHighestBidderId === null || previousHighestBidderId === payload.bidderId) {
    return [];
  }
  return [
    {
      userId: previousHighestBidderId,
      type: 'OUTBID',
      title: 'You were outbid',
      message: `Someone placed a higher bid of ${formatMoney(payload.amountCents, payload.currency)} on ${quoted(payload.title)}.`,
      auctionId: payload.auctionId,
    },
  ];
}

export function fromAuctionClosed(payload: EventPayload<'auction.closed'>): NewNotification[] {
  const { auctionId, sellerId, currency } = payload;
  const title = quoted(payload.title);

  if (payload.result === 'SOLD') {
    const amount = formatMoney(payload.amountCents, currency);
    return [
      {
        userId: payload.winnerId,
        type: 'AUCTION_WON',
        title: 'You won the auction',
        message: `You won ${title} with a bid of ${amount}. The payment is processed automatically.`,
        auctionId,
      },
      ...payload.losingBidderIds.map((userId): NewNotification => ({
        userId,
        type: 'AUCTION_LOST',
        title: 'You did not win',
        message: `${title} was sold to another bidder for ${amount}.`,
        auctionId,
      })),
      {
        userId: sellerId,
        type: 'ITEM_SOLD',
        title: 'Your item was sold',
        message: `${title} was sold for ${amount}. You are paid when the payment completes.`,
        auctionId,
      },
    ];
  }

  const reason =
    payload.noSaleReason === 'NO_BIDS'
      ? 'received no bids'
      : 'ended without a sale: the reserve price was not reached';
  return [
    ...payload.losingBidderIds.map((userId): NewNotification => ({
      userId,
      type: 'AUCTION_LOST',
      title: 'You did not win',
      message: `${title} ended without a sale: the reserve price was not reached.`,
      auctionId,
    })),
    {
      userId: sellerId,
      type: 'NO_SALE',
      title: 'Your auction ended without a sale',
      message: `${title} ${reason}.`,
      auctionId,
    },
  ];
}

export function fromAuctionCancelled(
  payload: EventPayload<'auction.cancelled'>,
): NewNotification[] {
  if (payload.cancelledBy === payload.sellerId) {
    return [];
  }
  return [
    {
      userId: payload.sellerId,
      type: 'AUCTION_CANCELLED',
      title: 'Your auction was cancelled',
      message: `An administrator cancelled ${quoted(payload.title)}.`,
      auctionId: payload.auctionId,
    },
  ];
}

export function fromPaymentCompleted(
  payload: EventPayload<'payment.completed'>,
): NewNotification[] {
  const { auctionId, currency } = payload;
  const title = quoted(payload.title);
  return [
    {
      userId: payload.winnerId,
      type: 'PAYMENT_COMPLETED',
      title: 'Payment completed',
      message: `You paid ${formatMoney(payload.amountCents, currency)} for ${title}.`,
      auctionId,
    },
    {
      userId: payload.sellerId,
      type: 'PAYMENT_COMPLETED',
      title: 'You were paid',
      message: `You received ${formatMoney(payload.sellerCents, currency)} for ${title} (platform fee ${formatMoney(payload.feeCents, currency)}).`,
      auctionId,
    },
  ];
}

export function fromPaymentFailed(payload: EventPayload<'payment.failed'>): NewNotification[] {
  const { auctionId, currency } = payload;
  const title = quoted(payload.title);
  const amount = formatMoney(payload.amountCents, currency);
  const winnerReason =
    payload.reason === 'INSUFFICIENT_FUNDS'
      ? `Your wallet balance did not cover ${amount}. Deposit money and contact the seller.`
      : `You have no wallet, so ${amount} could not be paid. Open your wallet and deposit money.`;
  return [
    {
      userId: payload.winnerId,
      type: 'PAYMENT_FAILED',
      title: 'Payment failed',
      message: `The payment for ${title} failed. ${winnerReason}`,
      auctionId,
    },
    {
      userId: payload.sellerId,
      type: 'PAYMENT_FAILED',
      title: 'The buyer could not pay',
      message: `The payment of ${amount} for ${title} failed, so the sale is not completed.`,
      auctionId,
    },
  ];
}
