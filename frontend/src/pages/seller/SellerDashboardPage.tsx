// The seller dashboard (/seller): the seller's own auctions in every state, from
// GET /auctions/mine, with the actions each state allows. The buttons only offer what makes sense;
// the server enforces the state rules and its answer (for example AUCTION_HAS_BIDS) is shown.
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { auctionsApi, type Auction, type AuctionStatus } from '../../api/auctions';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { formatDateTime, stateChip } from '../../utils/auction-labels';
import { formatMoney } from '../../utils/money';

const PAGE_SIZE = 20;

const FILTERS: { value: AuctionStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'CLOSED_SOLD', label: 'Sold, awaiting payment' },
  { value: 'SETTLED', label: 'Sold and paid' },
  { value: 'PAYMENT_FAILED', label: 'Payment failed' },
  { value: 'CLOSED_NO_SALE', label: 'No sale' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

type Action = 'publish' | 'cancel' | 'remove';

const CONFIRM: Record<Action, { title: string; text: string; button: string }> = {
  publish: {
    title: 'Publish this auction?',
    text: 'Everyone can see it and bid once it starts. Its terms can no longer be edited.',
    button: 'Publish',
  },
  cancel: {
    title: 'Cancel this auction?',
    text: 'A published auction can only be cancelled before the first bid. This cannot be undone.',
    button: 'Cancel auction',
  },
  remove: {
    title: 'Delete this draft?',
    text: 'The draft is removed for good.',
    button: 'Delete',
  },
};

export function SellerDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? '') as
    AuctionStatus | '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [pending, setPending] = useState<{ action: Action; auction: Auction } | null>(null);

  const mine = useQuery({
    queryKey: ['auctions', 'mine', status, page],
    queryFn: ({ signal }) =>
      auctionsApi.listMine({ status: status || undefined, page, size: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  });

  const act = useMutation({
    mutationFn: ({ action, auction }: { action: Action; auction: Auction }) =>
      action === 'publish'
        ? auctionsApi.publish(auction.id)
        : action === 'cancel'
          ? auctionsApi.cancel(auction.id)
          : auctionsApi.remove(auction.id),
    onSettled: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['auctions'] });
    },
  });

  const setFilter = (value: string) => {
    const next = new URLSearchParams();
    if (value) next.set('status', value);
    setParams(next);
  };

  const totalPages = mine.data ? Math.max(1, Math.ceil(mine.data.total / PAGE_SIZE)) : 1;

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          My auctions
        </Typography>
        <Button variant="contained" onClick={() => navigate('/seller/auctions/new')}>
          New auction
        </Button>
      </Stack>

      <TextField
        select
        label="Show"
        value={status}
        onChange={(event) => setFilter(event.target.value)}
        sx={{ maxWidth: 280 }}
      >
        {FILTERS.map((filter) => (
          <MenuItem key={filter.value} value={filter.value}>
            {filter.label}
          </MenuItem>
        ))}
      </TextField>

      {act.isError && <ErrorAlert error={act.error} title="The action was refused" />}
      {mine.isPending && <Loading label="Loading your auctions" />}
      {mine.isError && <ErrorAlert error={mine.error} />}
      {mine.data && mine.data.data.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {status ? 'No auctions in this state.' : 'You have no auctions yet.'}
        </Typography>
      )}
      {mine.data && mine.data.data.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>State</TableCell>
                <TableCell align="right">Starting price</TableCell>
                <TableCell align="right">Result</TableCell>
                <TableCell>Ends</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mine.data.data.map((auction) => {
                const chip = stateChip(auction);
                const isDraft = auction.status === 'DRAFT';
                const canCancel = isDraft || auction.status === 'PUBLISHED';
                return (
                  <TableRow key={auction.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/auctions/${auction.id}`}>
                        {auction.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={chip.label} color={chip.color} />
                    </TableCell>
                    <TableCell align="right">
                      {formatMoney(auction.startingPriceCents, auction.currency)}
                    </TableCell>
                    <TableCell align="right">
                      {auction.finalPriceCents === null
                        ? '–'
                        : formatMoney(auction.finalPriceCents, auction.currency)}
                    </TableCell>
                    <TableCell>{formatDateTime(auction.endsAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        {isDraft && (
                          <Button
                            size="small"
                            onClick={() => navigate(`/seller/auctions/${auction.id}/edit`)}
                          >
                            Edit
                          </Button>
                        )}
                        {isDraft && (
                          <Button
                            size="small"
                            onClick={() => setPending({ action: 'publish', auction })}
                          >
                            Publish
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            size="small"
                            color="warning"
                            onClick={() => setPending({ action: 'cancel', auction })}
                          >
                            Cancel
                          </Button>
                        )}
                        {isDraft && (
                          <Button
                            size="small"
                            color="error"
                            onClick={() => setPending({ action: 'remove', auction })}
                          >
                            Delete
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {totalPages > 1 && (
        <Pagination
          sx={{ alignSelf: 'center' }}
          count={totalPages}
          page={page}
          onChange={(_event, next) => {
            const nextParams = new URLSearchParams(params);
            nextParams.set('page', String(next));
            setParams(nextParams);
          }}
        />
      )}

      <Dialog open={pending !== null} onClose={() => !act.isPending && setPending(null)}>
        {pending && (
          <>
            <DialogTitle>{CONFIRM[pending.action].title}</DialogTitle>
            <DialogContent>
              <DialogContentText>
                <strong>{pending.auction.title}</strong>. {CONFIRM[pending.action].text}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)} disabled={act.isPending}>
                Keep it
              </Button>
              <Button
                color={pending.action === 'publish' ? 'primary' : 'error'}
                variant="contained"
                disabled={act.isPending}
                onClick={() => act.mutate(pending)}
              >
                {CONFIRM[pending.action].button}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Stack>
  );
}
