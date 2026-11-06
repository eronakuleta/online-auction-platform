// The public catalog (FR-05): search, filter by category, status and price, sort, and page through
// GET /auctions. The filters live in the URL, so a search can be shared, bookmarked and reloaded,
// and the browser's back button returns to the previous filters.
import { Grid, MenuItem, Pagination, Stack, TextField, Typography } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { auctionsApi, type AuctionQuery, type AuctionSort } from '../../api/auctions';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { useCategories } from '../../hooks/useCategories';
import { STATUS_LABELS } from '../../utils/auction-labels';
import { AuctionCard } from './AuctionCard';
import { SearchForm, type SearchValues } from './SearchForm';

const PAGE_SIZE = 12;

const SORT_LABELS: Record<AuctionSort, string> = {
  relevance: 'Best match',
  newest: 'Newest',
  ending_soon: 'Ending soon',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
};

function positiveInt(value: string | null): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** The URL is the source of truth for the filters. Unknown values are dropped, not sent. */
function queryFromUrl(params: URLSearchParams): AuctionQuery {
  const status = params.get('status');
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    status: status && status in STATUS_LABELS ? (status as AuctionQuery['status']) : undefined,
    minPriceCents: positiveInt(params.get('minPriceCents')),
    maxPriceCents: positiveInt(params.get('maxPriceCents')),
    sort: sort && sort in SORT_LABELS ? (sort as AuctionSort) : undefined,
    page: positiveInt(params.get('page')) ?? 1,
    size: PAGE_SIZE,
  };
}

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const query = queryFromUrl(params);
  const categories = useCategories();

  const auctions = useQuery({
    queryKey: ['auctions', query],
    queryFn: ({ signal }) => auctionsApi.list(query, signal),
    // Keep showing the old page while the next one loads, so the grid does not jump.
    placeholderData: keepPreviousData,
  });

  /** Changes some filters and goes back to page 1, because the old page may no longer exist. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in changes)) next.delete('page');
    // "Best match" only makes sense with a search term; the server refuses it otherwise.
    if (!next.get('q') && next.get('sort') === 'relevance') next.delete('sort');
    setParams(next);
  };

  const search = (values: SearchValues) =>
    update({
      q: values.q,
      minPriceCents: values.minPriceCents,
      maxPriceCents: values.maxPriceCents,
    });

  const categoryName = (id: string) => categories.data?.find((c) => c.id === id)?.name;
  const totalPages = auctions.data ? Math.max(1, Math.ceil(auctions.data.total / PAGE_SIZE)) : 1;

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Auctions
      </Typography>

      <SearchForm
        key={`${query.q ?? ''}|${query.minPriceCents ?? ''}|${query.maxPriceCents ?? ''}`}
        initial={query}
        onSearch={search}
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            select
            label="Category"
            value={query.categoryId ?? ''}
            onChange={(event) => update({ categoryId: event.target.value })}
            fullWidth
          >
            <MenuItem value="">All categories</MenuItem>
            {(categories.data ?? []).map((category) => (
              <MenuItem key={category.id} value={category.id}>
                {category.name}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            select
            label="Status"
            value={query.status ?? 'PUBLISHED'}
            onChange={(event) =>
              update({ status: event.target.value === 'PUBLISHED' ? '' : event.target.value })
            }
            fullWidth
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            select
            label="Sort"
            value={query.sort ?? (query.q ? 'relevance' : 'newest')}
            onChange={(event) => update({ sort: event.target.value })}
            fullWidth
          >
            {Object.entries(SORT_LABELS)
              .filter(([value]) => value !== 'relevance' || query.q)
              .map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
          </TextField>
        </Grid>
      </Grid>

      {auctions.isPending && <Loading label="Loading auctions" />}
      {auctions.isError && <ErrorAlert error={auctions.error} />}
      {auctions.data && (
        <>
          <Typography variant="body2" color="text.secondary">
            {auctions.data.total === 1 ? '1 auction' : `${auctions.data.total} auctions`}
          </Typography>
          {auctions.data.data.length === 0 ? (
            <Typography sx={{ py: 4, textAlign: 'center' }} color="text.secondary">
              No auctions match these filters.
            </Typography>
          ) : (
            <Grid container spacing={2} sx={{ opacity: auctions.isPlaceholderData ? 0.6 : 1 }}>
              {auctions.data.data.map((auction) => (
                <Grid key={auction.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <AuctionCard auction={auction} categoryName={categoryName(auction.categoryId)} />
                </Grid>
              ))}
            </Grid>
          )}
          {totalPages > 1 && (
            <Pagination
              sx={{ alignSelf: 'center' }}
              count={totalPages}
              page={query.page ?? 1}
              onChange={(_event, page) => update({ page: page === 1 ? undefined : page })}
            />
          )}
        </>
      )}
    </Stack>
  );
}
