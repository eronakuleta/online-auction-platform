// The notification bell in the top bar (B-20): an unread badge that refreshes every 30 seconds, and
// a menu with the latest notifications. Opening one marks it as read and goes to its auction.
import {
  Badge,
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { notificationsApi, type AppNotification } from '../../api/notifications';
import { formatDateTime } from '../../utils/auction-labels';
import {
  UNREAD_POLL_MS,
  notificationKeys,
  notificationTarget,
  useNotificationMutations,
} from './notification-queries';

const LATEST = 5;

export function NotificationBell() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { markRead, markAllRead } = useNotificationMutations();

  const unread = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
    refetchInterval: UNREAD_POLL_MS,
    // The bell is decoration: a failed count simply shows no badge instead of an error.
    retry: false,
  });
  const latest = useQuery({
    queryKey: notificationKeys.list(1, LATEST),
    queryFn: ({ signal }) => notificationsApi.list(1, LATEST, signal),
    enabled: anchor !== null,
  });

  const count = unread.data?.unreadCount ?? 0;

  function open(notification: AppNotification) {
    if (notification.readAt === null) markRead.mutate(notification.id);
    setAnchor(null);
    void navigate(notificationTarget(notification.auctionId));
  }

  return (
    <>
      <Button
        color="inherit"
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-haspopup="true"
      >
        <Badge badgeContent={count} color="error" max={99}>
          <Box component="span" sx={{ pr: count > 0 ? 1.5 : 0 }}>
            Notifications
          </Box>
        </Badge>
      </Button>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: { xs: 300, sm: 380 }, maxWidth: '100vw' }}>
          <Stack
            direction="row"
            sx={{ p: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="subtitle1">Notifications</Typography>
            <Button
              size="small"
              disabled={count === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              Mark all as read
            </Button>
          </Stack>
          <Divider />
          {latest.isPending && <Typography sx={{ p: 2 }}>Loading…</Typography>}
          {latest.isError && (
            <Typography color="error" sx={{ p: 2 }}>
              Could not load your notifications.
            </Typography>
          )}
          {latest.isSuccess && latest.data.data.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              Nothing yet.
            </Typography>
          )}
          {latest.isSuccess && latest.data.data.length > 0 && (
            <List disablePadding aria-label="Latest notifications">
              {latest.data.data.map((notification) => (
                <ListItemButton
                  key={notification.id}
                  onClick={() => open(notification)}
                  sx={{ bgcolor: notification.readAt === null ? 'action.hover' : undefined }}
                >
                  <ListItemText
                    primary={notification.title}
                    secondary={`${notification.message} · ${formatDateTime(notification.createdAt)}`}
                    slotProps={{
                      primary: { sx: { fontWeight: notification.readAt === null ? 700 : 400 } },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
          <Divider />
          <Box sx={{ p: 1, textAlign: 'center' }}>
            <Button
              size="small"
              component={RouterLink}
              to="/notifications"
              onClick={() => setAnchor(null)}
            >
              See all notifications
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
