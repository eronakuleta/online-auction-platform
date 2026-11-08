// "My bids" (B-20): every bid the user placed, newest first, and how each one stands.
import {
  Chip,
  Link,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { biddingApi } from '../../api/bidding';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { formatDateTime } from '../../utils/auction-labels';
import { formatMoney } from '../../utils/money';
import { bidStanding } from './bid-standing';

const SIZE = 10;

export function MyBidsPage() {
  const [page, setPage] = useState(1);
  const bids = useQuery({
    queryKey: ['bids', 'me', page],
    queryFn: ({ signal }) => biddingApi.mine(page, SIZE, signal),
    placeholderData: keepPreviousData,
  });

  if (bids.isPending) return <Loading label="Loading your bids" />;
  if (bids.isError) return <ErrorAlert error={bids.error} />;

  const { data, total } = bids.data;
  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        My bids
      </Typography>
      {total === 0 ? (
        <Typography color="text.secondary">
          You have not placed any bids yet.{' '}
          <Link component={RouterLink} to="/">
            Browse the auctions
          </Link>
        </Typography>
      ) : (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="My bids">
              <TableHead>
                <TableRow>
                  <TableCell>Auction</TableCell>
                  <TableCell align="right">My bid</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Placed</TableCell>
                  <TableCell>Auction ends</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((bid) => {
                  const standing = bidStanding(bid);
                  return (
                    <TableRow key={bid.id}>
                      <TableCell>
                        <Link component={RouterLink} to={`/auctions/${bid.auctionId}/live`}>
                          {bid.title}
                        </Link>
                      </TableCell>
                      <TableCell align="right">
                        {formatMoney(bid.amountCents, bid.currency)}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={standing.label} color={standing.color} />
                      </TableCell>
                      <TableCell>{formatDateTime(bid.placedAt)}</TableCell>
                      <TableCell>{formatDateTime(bid.endsAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
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
