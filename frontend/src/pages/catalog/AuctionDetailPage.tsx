// One auction, read-only (FR-05). Bidding itself is on the live auction page (Anesa, B-20); this
// page shows what auction-service knows and links there.
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Divider,
  Grid,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { auctionsApi } from '../../api/auctions';
import { ApiError } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { useCategories } from '../../hooks/useCategories';
import { formatDateTime, stateChip } from '../../utils/auction-labels';
import { formatMoney } from '../../utils/money';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography>{children}</Typography>
    </Box>
  );
}

export function AuctionDetailPage() {
  const { id = '' } = useParams();
  const auction = useQuery({
    queryKey: ['auctions', id],
    queryFn: ({ signal }) => auctionsApi.get(id, signal),
  });
  const categories = useCategories();

  if (auction.isPending) return <Loading label="Loading the auction" />;
  if (auction.isError) {
    // 404 also covers someone else's draft (decision Q4) and a malformed ID (400).
    const missing = auction.error instanceof ApiError && [400, 404].includes(auction.error.status);
    return missing ? (
      <Stack spacing={2}>
        <Typography variant="h5">Auction not found</Typography>
        <Link component={RouterLink} to="/">
          Back to all auctions
        </Link>
      </Stack>
    ) : (
      <ErrorAlert error={auction.error} />
    );
  }

  const a = auction.data;
  const chip = stateChip(a);
  const money = (cents: number) => formatMoney(cents, a.currency);
  const category = categories.data?.find((c) => c.id === a.categoryId)?.name;

  return (
    <Stack spacing={3}>
      <Breadcrumbs>
        <Link component={RouterLink} to="/" underline="hover" color="inherit">
          Auctions
        </Link>
        {category && (
          <Link
            component={RouterLink}
            to={`/?categoryId=${a.categoryId}`}
            underline="hover"
            color="inherit"
          >
            {category}
          </Link>
        )}
        <Typography color="text.primary">{a.title}</Typography>
      </Breadcrumbs>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2}>
            {a.imageUrls.length > 0 ? (
              a.imageUrls.map((url, index) => (
                <Box
                  key={url}
                  component="img"
                  src={url}
                  alt={`${a.title}, image ${index + 1}`}
                  loading="lazy"
                  sx={{ width: '100%', borderRadius: 1, bgcolor: 'grey.100' }}
                />
              ))
            ) : (
              <Box sx={{ height: 240, bgcolor: 'grey.200', borderRadius: 1 }} />
            )}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Chip label={chip.label} color={chip.color} sx={{ alignSelf: 'flex-start' }} />
              <Typography variant="h4" component="h1">
                {a.title}
              </Typography>
              <Button variant="contained" component={RouterLink} to={`/auctions/${a.id}/live`}>
                {a.status === 'PUBLISHED' ? 'Watch live and bid' : 'See the bids'}
              </Button>
              <Divider />
              {a.finalPriceCents !== null && (
                <Fact label="Sold for">{money(a.finalPriceCents)}</Fact>
              )}
              <Fact label="Starting price">{money(a.startingPriceCents)}</Fact>
              <Fact label="Minimum bid increment">{money(a.minIncrementCents)}</Fact>
              {/* Only the seller and admins receive this field at all (decision Q8). */}
              {a.reservePriceCents !== undefined && (
                <Fact label="Reserve price (visible to you as seller or admin)">
                  {a.reservePriceCents === null ? 'None' : money(a.reservePriceCents)}
                </Fact>
              )}
              <Divider />
              <Fact label="Starts">{formatDateTime(a.startsAt)}</Fact>
              <Fact label="Ends">{formatDateTime(a.endsAt)}</Fact>
              {a.closedAt && <Fact label="Closed">{formatDateTime(a.closedAt)}</Fact>}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {a.description && (
        <Box>
          <Typography variant="h6" component="h2" gutterBottom>
            Description
          </Typography>
          {/* Rendered as text, never as HTML, so a description cannot inject markup. */}
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{a.description}</Typography>
        </Box>
      )}
    </Stack>
  );
}
