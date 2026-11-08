// All notifications of the user (B-20), newest first, with paging.
import {
  Button,
  List,
  ListItemButton,
  ListItemText,
  Pagination,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { notificationsApi } from '../../api/notifications';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { formatDateTime } from '../../utils/auction-labels';
import {
  notificationKeys,
  notificationTarget,
  useNotificationMutations,
} from './notification-queries';

const SIZE = 10;

export function NotificationsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { markRead, markAllRead } = useNotificationMutations();
  const list = useQuery({
    queryKey: notificationKeys.list(page, SIZE),
    queryFn: ({ signal }) => notificationsApi.list(page, SIZE, signal),
    placeholderData: keepPreviousData,
  });

  if (list.isPending) return <Loading label="Loading your notifications" />;
  if (list.isError) return <ErrorAlert error={list.error} />;

  const { data, total } = list.data;
  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h4" component="h1">
          Notifications
        </Typography>
        <Button disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
          Mark all as read
        </Button>
      </Stack>
      {markAllRead.isError && <ErrorAlert error={markAllRead.error} />}
      {total === 0 ? (
        <Typography color="text.secondary">You have no notifications yet.</Typography>
      ) : (
        <>
          <Paper variant="outlined">
            <List disablePadding aria-label="Notifications">
              {data.map((notification) => (
                <ListItemButton
                  key={notification.id}
                  divider
                  sx={{ bgcolor: notification.readAt === null ? 'action.hover' : undefined }}
                  onClick={() => {
                    if (notification.readAt === null) markRead.mutate(notification.id);
                    if (notification.auctionId !== null) {
                      void navigate(notificationTarget(notification.auctionId));
                    }
                  }}
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
          </Paper>
          {pages > 1 && (
            <Pagination
              count={pages}
              page={page}
              onChange={(_event, value) => setPage(value)}
              sx={{ alignSelf: 'center' }}
            />
          )}
        </>
      )}
    </Stack>
  );
}
