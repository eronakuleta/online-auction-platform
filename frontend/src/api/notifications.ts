// notification-service endpoints (docs/requirements.md FR-13, decision Q14).
import { apiClient } from './client';
import type { Page } from './types';

export type NotificationType =
  | 'WELCOME'
  | 'OUTBID'
  | 'AUCTION_WON'
  | 'AUCTION_LOST'
  | 'ITEM_SOLD'
  | 'NO_SALE'
  | 'AUCTION_CANCELLED'
  | 'PAYMENT_COMPLETED'
  | 'PAYMENT_FAILED';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** The auction it is about; null only for the welcome message. */
  auctionId: string | null;
  /** Null means unread. */
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: (page: number, size: number, signal?: AbortSignal) =>
    apiClient.get<Page<AppNotification>>(`/notifications?page=${page}&size=${size}`, { signal }),

  unreadCount: (signal?: AbortSignal) =>
    apiClient.get<{ unreadCount: number }>('/notifications/unread-count', { signal }),

  markRead: (id: string) =>
    apiClient.patch<AppNotification>(`/notifications/${encodeURIComponent(id)}/read`),

  markAllRead: () => apiClient.post<{ updated: number }>('/notifications/read-all'),
};
