import {
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';
import type { Auction } from '../../api/auctions';
import { formatDateTime, stateChip } from '../../utils/auction-labels';
import { formatMoney } from '../../utils/money';

export function AuctionCard({
  auction,
  categoryName,
}: {
  auction: Auction;
  categoryName?: string;
}) {
  const chip = stateChip(auction);
  const sold = auction.finalPriceCents !== null;
  const price = sold ? auction.finalPriceCents : auction.startingPriceCents;

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea
        component={RouterLink}
        to={`/auctions/${auction.id}`}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        {auction.imageUrls[0] ? (
          <CardMedia
            component="img"
            height="160"
            image={auction.imageUrls[0]}
            alt={auction.title}
            loading="lazy"
          />
        ) : (
          <CardMedia sx={{ height: 160, bgcolor: 'grey.200' }} title="No image" />
        )}
        <CardContent sx={{ flexGrow: 1 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip label={chip.label} color={chip.color} size="small" />
              {categoryName && (
                <Typography variant="caption" color="text.secondary">
                  {categoryName}
                </Typography>
              )}
            </Stack>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
              {auction.title}
            </Typography>
            <Typography variant="body2">
              {sold ? 'Sold for ' : 'Starting at '}
              <strong>{formatMoney(price ?? 0, auction.currency)}</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {auction.phase === 'UPCOMING'
                ? `Starts ${formatDateTime(auction.startsAt)}`
                : `Ends ${formatDateTime(auction.endsAt)}`}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
