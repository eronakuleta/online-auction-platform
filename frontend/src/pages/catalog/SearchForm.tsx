import { Box, Button, Grid, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { centsToInput, parseMoneyToCents } from '../../utils/money';

export interface SearchValues {
  q?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
}

/**
 * The text filters. They are edited here and applied only on "Search", so typing does not send one
 * request per key. The parent gives this component a `key` built from the URL values, so when the
 * URL changes (back button, a shared link) React mounts a fresh form with those values.
 */
export function SearchForm({
  initial,
  onSearch,
}: {
  initial: SearchValues;
  onSearch: (values: SearchValues) => void;
}) {
  const [search, setSearch] = useState(initial.q ?? '');
  const [minPrice, setMinPrice] = useState(
    initial.minPriceCents ? centsToInput(initial.minPriceCents) : '',
  );
  const [maxPrice, setMaxPrice] = useState(
    initial.maxPriceCents ? centsToInput(initial.maxPriceCents) : '',
  );

  // Light checks to help the user; the server validates the numbers again.
  const minCents = minPrice ? parseMoneyToCents(minPrice) : undefined;
  const maxCents = maxPrice ? parseMoneyToCents(maxPrice) : undefined;
  const rangeReversed =
    minCents !== undefined && minCents !== null && maxCents !== undefined && maxCents !== null
      ? minCents > maxCents
      : false;
  const invalid = minCents === null || maxCents === null || rangeReversed;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    onSearch({
      q: search.trim() || undefined,
      minPriceCents: minCents ?? undefined,
      maxPriceCents: maxCents ?? undefined,
    });
  };

  return (
    <Box component="form" onSubmit={submit}>
      <Grid container spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            label="Search"
            placeholder='camera, "oil painting", -broken'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField
            label="Min price"
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            error={minCents === null}
            helperText={minCents === null ? 'For example 12.50' : ' '}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField
            label="Max price"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            error={maxCents === null || rangeReversed}
            helperText={
              maxCents === null ? 'For example 99' : rangeReversed ? 'Lower than min price' : ' '
            }
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <Button type="submit" variant="contained" size="large" disabled={invalid} fullWidth>
            Search
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
