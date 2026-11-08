// The live auction page (B-20): the current price, the time left, a bid form and the bid history,
// all following the auction live over Server-Sent Events. Bidding rules live in the server.
import { Alert, Box, Chip, Divider, Grid, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { biddingApi, type AuctionLiveState } from '../../api/bidding';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { useAuth } from '../../hooks/useAuth';
import { useNow } from '../../hooks/useNow';
import { liveKeys, useAuctionStream, type StreamStatus } from '../../hooks/useAuctionStream';
import { formatDateTime } from '../../utils/auction-labels';
import { formatMoney } from '../../utils/money';
import { BidForm } from './BidForm';
import { BidHistory } from './BidHistory';
import { Countdown } from './Countdown';
import { hasStarted, isLeading, newerState } from './live-state';

const CONNECTION: Record<
  StreamStatus,
  { label: string; color: 'success' | 'warning' | 'default' }
> = {
  connecting: { label: 'Connecting…', color: 'default' },
  live: { label: 'Live', color: 'success' },
  reconnecting: { label: 'Reconnecting…', color: 'warning' },
  closed: { label: 'Not live: refreshing every 5 s', color: 'warning' },
};

function Outcome({ state, userId }: { state: AuctionLiveState; userId: string | undefined }) {
  const currency = state.currency ?? 'EUR';
  const winner = isLeading(state, userId);
  switch (state.status) {
    case 'CLOSED_SOLD':
      return (
        <Alert severity={winner ? 'success' : 'info'}>
          {winner ? 'You won this auction' : 'Sold'} for{' '}
          {formatMoney(state.highestBidCents ?? 0, currency)}.
        </Alert>
      );
    case 'CLOSED_NO_SALE':
      return <Alert severity="info">This auction ended without a sale.</Alert>;
    case 'CANCELLED':
      return <Alert severity="warning">This auction was cancelled.</Alert>;
    default:
      return null;
  }
}

function BidPanel({ state }: { state: AuctionLiveState }) {
  const { status, user, hasRole } = useAuth();
  if (state.status !== 'OPEN') return null;
  if (status === 'loading') return <Loading label="Checking your session" />;
  if (!user) {
    return (
      <Alert severity="info">
        <Link component={RouterLink} to="/login">
          Log in
        </Link>{' '}
        to place a bid.
      </Alert>
    );
  }
  if (!hasRole('BIDDER')) {
    return <Alert severity="info">Only accounts with the bidder role can place bids.</Alert>;
  }
  // A light check to help the user; the server refuses it anyway (OWN_AUCTION).
  if (user.id === state.sellerId) {
    return <Alert severity="info">You cannot bid on your own auction.</Alert>;
  }
  return <BidForm state={state} />;
}

export function LiveAuctionPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const now = useNow();
  const stateQuery = useQuery({
    queryKey: liveKeys.state(id),
    // A request and the stream can deliver in any order; only a newer version replaces the state.
    queryFn: async ({ signal }) =>
      newerState(
        queryClient.getQueryData<AuctionLiveState>(liveKeys.state(id)),
        await biddingApi.state(id, signal),
      ),
  });

  const open = stateQuery.data?.status === 'OPEN';
  const streamStatus = useAuctionStream(id, stateQuery.isSuccess && open);

  if (stateQuery.isPending) return <Loading label="Loading the auction" />;
  if (stateQuery.isError) {
    const missing =
      stateQuery.error instanceof ApiError && [400, 404].includes(stateQuery.error.status);
    return missing ? (
      <Stack spacing={2}>
        <Typography variant="h5">This auction is not open for bidding</Typography>
        <Typography color="text.secondary">
          It may not exist, may still be a draft, or may have been withdrawn.
        </Typography>
        <Link component={RouterLink} to={`/auctions/${id}`}>
          See the auction details
        </Link>
      </Stack>
    ) : (
      <ErrorAlert error={stateQuery.error} />
    );
  }

  const state = stateQuery.data;
  const currency = state.currency ?? 'EUR';
  const connection = CONNECTION[streamStatus];
  const beforeStart = state.status === 'OPEN' && !hasStarted(state, now);

  return (
    <Stack spacing={3}>
      <Box>
        <Link component={RouterLink} to={`/auctions/${state.auctionId}`} underline="hover">
          ← Details and photos
        </Link>
        <Typography variant="h4" component="h1" sx={{ mt: 1 }}>
          {state.title}
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                {open && <Chip size="small" label={connection.label} color={connection.color} />}
                {isLeading(state, user?.id) && open && (
                  <Chip size="small" color="success" label="You have the highest bid" />
                )}
                {state.extensionCount > 0 && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Extended ${state.extensionCount}×`}
                  />
                )}
              </Stack>

              <Box>
                <Typography variant="caption" color="text.secondary">
                  {state.highestBidCents === null ? 'No bids yet' : 'Highest bid'}
                </Typography>
                <Typography variant="h3" component="p" aria-live="polite">
                  {state.highestBidCents === null
                    ? formatMoney(state.minimumNextBidCents, currency)
                    : formatMoney(state.highestBidCents, currency)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {state.bidCount} {state.bidCount === 1 ? 'bid' : 'bids'}
                  {state.highestBidCents === null && ' · starting price'}
                </Typography>
              </Box>

              <Divider />
              {state.status === 'OPEN' && state.endsAt !== null && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {beforeStart ? `Starts ${formatDateTime(state.startsAt ?? '')}` : 'Time left'}
                  </Typography>
                  {!beforeStart && <Countdown endsAt={state.endsAt} />}
                  <Typography variant="body2" color="text.secondary">
                    Ends {formatDateTime(state.endsAt)}
                  </Typography>
                </Box>
              )}

              <Outcome state={state} userId={user?.id} />
              {beforeStart && <Alert severity="info">Bidding has not started yet.</Alert>}
              <BidPanel state={state} />
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6" component="h2" gutterBottom>
              Bids
            </Typography>
            <BidHistory auctionId={state.auctionId} currency={currency} userId={user?.id} />
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}
