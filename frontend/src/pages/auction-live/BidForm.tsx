import { Alert, Button, Stack, TextField } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { biddingApi, type AuctionLiveState } from '../../api/bidding';
import { ApiError } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { liveKeys } from '../../hooks/useAuctionStream';
import { centsToInput, formatMoney, parseMoneyToCents } from '../../utils/money';
import { newerState } from './live-state';

/**
 * The bid form. The server is the authority on every rule (increment, own auction, funds, time),
 * so this form only helps: it fills in the minimum and shows the server's answer as it came.
 */
export function BidForm({ state }: { state: AuctionLiveState }) {
  const queryClient = useQueryClient();
  const currency = state.currency ?? 'EUR';
  const [amount, setAmount] = useState(() => centsToInput(state.minimumNextBidCents));
  const [typed, setTyped] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  // The key of the last attempt, reused only when its outcome is unknown (see onError below).
  const attempt = useRef<{ amountCents: number; key: string } | null>(null);

  const placeBid = useMutation({
    mutationFn: (amountCents: number) => {
      const same = attempt.current?.amountCents === amountCents;
      const key = same && attempt.current ? attempt.current.key : crypto.randomUUID();
      attempt.current = { amountCents, key };
      return biddingApi.placeBid(state.auctionId, amountCents, key);
    },
    onSuccess: (result) => {
      attempt.current = null;
      queryClient.setQueryData<AuctionLiveState>(liveKeys.state(state.auctionId), (current) =>
        newerState(current, result.auction),
      );
      void queryClient.invalidateQueries({ queryKey: liveKeys.bids(state.auctionId) });
      void queryClient.invalidateQueries({ queryKey: ['bids', 'me'] });
      setTyped(false);
      setAmount(centsToInput(result.auction.minimumNextBidCents));
    },
    onError: (error) => {
      // A rule rejection (4xx) is a final answer and the server would repeat it for the same key,
      // so the next try gets a new key. After a network error or a 5xx the outcome is unknown, and
      // the same key makes a retry safe: it can never place the bid twice.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        attempt.current = null;
      }
    },
  });

  // Until the user types, the field follows the minimum as other bids raise it.
  const shown = typed ? amount : centsToInput(state.minimumNextBidCents);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const cents = parseMoneyToCents(shown);
    if (cents === null || cents < 1) {
      setInputError('Enter an amount in whole cents, for example 12.50');
      return;
    }
    setInputError(null);
    placeBid.mutate(cents);
  }

  return (
    <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
      <TextField
        label={`Your bid (${currency})`}
        value={shown}
        onChange={(event) => {
          setTyped(true);
          setAmount(event.target.value);
          setInputError(null);
        }}
        error={inputError !== null}
        helperText={inputError ?? `Minimum ${formatMoney(state.minimumNextBidCents, currency)}`}
        slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': 'Bid amount' } }}
        disabled={placeBid.isPending}
      />
      <Button type="submit" variant="contained" size="large" disabled={placeBid.isPending}>
        {placeBid.isPending ? 'Placing bid…' : 'Place bid'}
      </Button>
      {placeBid.isError && <ErrorAlert error={placeBid.error} />}
      {placeBid.isSuccess && <Alert severity="success">Your bid was placed.</Alert>}
    </Stack>
  );
}
