import { List, ListItem, ListItemText, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { biddingApi } from '../../api/bidding';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { liveKeys } from '../../hooks/useAuctionStream';
import { formatDateTime } from '../../utils/auction-labels';
import { formatMoney } from '../../utils/money';
import { bidderLabel } from './live-state';

const SIZE = 10;

/** The latest bids, newest first. The stream triggers a new read whenever the bid count changes. */
export function BidHistory({
  auctionId,
  currency,
  userId,
}: {
  auctionId: string;
  currency: string;
  userId: string | undefined;
}) {
  const history = useQuery({
    queryKey: liveKeys.bids(auctionId),
    queryFn: ({ signal }) => biddingApi.history(auctionId, 1, SIZE, signal),
  });

  if (history.isPending) return <Loading label="Loading the bids" />;
  if (history.isError) return <ErrorAlert error={history.error} />;
  if (history.data.data.length === 0) {
    return <Typography color="text.secondary">No bids yet. Be the first.</Typography>;
  }

  return (
    <>
      <List dense disablePadding aria-label="Bid history">
        {history.data.data.map((bid) => (
          <ListItem key={bid.id} disableGutters divider>
            <ListItemText
              primary={`${formatMoney(bid.amountCents, currency)} · ${bidderLabel(bid.bidderId, userId)}`}
              secondary={formatDateTime(bid.placedAt)}
              slotProps={{ primary: { sx: { fontWeight: bid.bidderId === userId ? 600 : 400 } } }}
            />
          </ListItem>
        ))}
      </List>
      {history.data.total > SIZE && (
        <Typography variant="caption" color="text.secondary">
          Showing the latest {SIZE} of {history.data.total} bids.
        </Typography>
      )}
    </>
  );
}
