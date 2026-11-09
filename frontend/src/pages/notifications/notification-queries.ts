// The query keys and mutations shared by the bell and the notifications page (B-20).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../api/notifications';

export const notificationKeys = {
  all: ['notifications'] as const,
  unread: ['notifications', 'unread-count'] as const,
  list: (page: number, size: number) => ['notifications', 'list', page, size] as const,
};

/** How often the bell asks for the unread count while the page is open. */
export const UNREAD_POLL_MS = 30_000;

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  return {
    markRead: useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh }),
    markAllRead: useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh }),
  };
}

/** Where a notification leads: its auction's live page, or the full list for the welcome message. */
export function notificationTarget(auctionId: string | null): string {
  return auctionId === null ? '/notifications' : `/auctions/${auctionId}/live`;
}
