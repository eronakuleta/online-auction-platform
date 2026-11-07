// The create/edit form for an auction. It only helps the seller: the server validates everything
// again (lengths, money, times, category) and its error is what the seller finally sees.
import { Button, Grid, MenuItem, Stack, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { Auction, AuctionInput } from '../../api/auctions';
import { useCategories } from '../../hooks/useCategories';
import { isoToLocalInput, localInputFromNow, localInputToIso } from '../../utils/datetime';
import { centsToInput, parseMoneyToCents } from '../../utils/money';

const MAX_IMAGES = 10;

interface FormValues {
  categoryId: string;
  title: string;
  description: string;
  startingPrice: string;
  minIncrement: string;
  reservePrice: string;
  startsAt: string;
  endsAt: string;
  imageUrls: string;
}

function initialValues(auction?: Auction): FormValues {
  if (!auction) {
    return {
      categoryId: '',
      title: '',
      description: '',
      startingPrice: '',
      minIncrement: '1.00',
      reservePrice: '',
      startsAt: localInputFromNow(1),
      endsAt: localInputFromNow(25),
      imageUrls: '',
    };
  }
  return {
    categoryId: auction.categoryId,
    title: auction.title,
    description: auction.description,
    startingPrice: centsToInput(auction.startingPriceCents),
    minIncrement: centsToInput(auction.minIncrementCents),
    reservePrice:
      auction.reservePriceCents === null || auction.reservePriceCents === undefined
        ? ''
        : centsToInput(auction.reservePriceCents),
    startsAt: isoToLocalInput(auction.startsAt),
    endsAt: isoToLocalInput(auction.endsAt),
    imageUrls: auction.imageUrls.join('\n'),
  };
}

/** Turns the form into the API body, or lists what is wrong. Light checks only. */
function toInput(values: FormValues): { input?: AuctionInput; errors: Partial<FormValues> } {
  const errors: Partial<FormValues> = {};
  const startingPriceCents = parseMoneyToCents(values.startingPrice);
  const minIncrementCents = parseMoneyToCents(values.minIncrement);
  const reservePriceCents = values.reservePrice.trim()
    ? parseMoneyToCents(values.reservePrice)
    : undefined;
  const startsAt = localInputToIso(values.startsAt);
  const endsAt = localInputToIso(values.endsAt);
  const imageUrls = values.imageUrls
    .split('\n')
    .map((url) => url.trim())
    .filter(Boolean);

  if (!values.categoryId) errors.categoryId = 'Choose a category';
  if (values.title.trim().length < 3) errors.title = 'At least 3 characters';
  if (!startingPriceCents) errors.startingPrice = 'A price above 0, for example 25 or 25.50';
  if (!minIncrementCents) errors.minIncrement = 'An amount above 0';
  if (reservePriceCents === null || reservePriceCents === 0) {
    errors.reservePrice = 'An amount above 0, or leave empty for no reserve';
  }
  if (!startsAt) errors.startsAt = 'Choose a start time';
  if (!endsAt) errors.endsAt = 'Choose an end time';
  if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = 'Must be after the start';
  if (imageUrls.length > MAX_IMAGES) errors.imageUrls = `At most ${MAX_IMAGES} images`;
  else if (imageUrls.some((url) => !/^https?:\/\/\S+$/.test(url))) {
    errors.imageUrls = 'One http(s) URL per line';
  }

  if (Object.keys(errors).length > 0 || !startingPriceCents || !minIncrementCents) {
    return { errors };
  }
  return {
    errors,
    input: {
      categoryId: values.categoryId,
      title: values.title.trim(),
      description: values.description,
      startingPriceCents,
      minIncrementCents,
      reservePriceCents: reservePriceCents ?? null,
      startsAt: startsAt as string,
      endsAt: endsAt as string,
      imageUrls,
    },
  };
}

export function AuctionForm({
  auction,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  auction?: Auction;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: AuctionInput) => void;
  onCancel: () => void;
}) {
  const categories = useCategories();
  const [values, setValues] = useState<FormValues>(() => initialValues(auction));
  const [errors, setErrors] = useState<Partial<FormValues>>({});

  const field = (name: keyof FormValues) => ({
    value: values[name],
    onChange: (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [name]: event.target.value }));
      // The hint was about the old value; it comes back on the next Save if still wrong.
      setErrors((current) => ({ ...current, [name]: undefined }));
    },
    error: Boolean(errors[name]),
    helperText: errors[name] ?? ' ',
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = toInput(values);
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  return (
    <Stack component="form" spacing={1} onSubmit={submit} noValidate>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <TextField
            label="Title"
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
            {...field('title')}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField select label="Category" required fullWidth {...field('categoryId')}>
            {(categories.data ?? []).map((category) => (
              <MenuItem key={category.id} value={category.id}>
                {category.name}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={12}>
          <TextField
            label="Description"
            multiline
            minRows={4}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 5000 } }}
            {...field('description')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Starting price"
            required
            fullWidth
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            {...field('startingPrice')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Minimum bid increment"
            required
            fullWidth
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            {...field('minIncrement')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Reserve price (optional)"
            fullWidth
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            {...field('reservePrice')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Starts"
            type="datetime-local"
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            {...field('startsAt')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Ends"
            type="datetime-local"
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            {...field('endsAt')}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            label="Image URLs (one per line, at most 10)"
            multiline
            minRows={2}
            fullWidth
            {...field('imageUrls')}
          />
        </Grid>
      </Grid>
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
