import { Typography } from '@mui/material';
import { useNow } from '../../hooks/useNow';
import { ENDING_SOON_MS, formatRemaining } from './live-state';

/**
 * Counts down to `endsAt`, once per second. It uses the clock of this computer, so it can be a few
 * seconds off; the server decides when bidding really ends and refuses a late bid. When a late bid
 * extends the auction (anti-sniping), `endsAt` changes and the countdown follows.
 */
export function Countdown({ endsAt }: { endsAt: string }) {
  const now = useNow();
  const remaining = Date.parse(endsAt) - now;
  const endingSoon = remaining > 0 && remaining <= ENDING_SOON_MS;
  return (
    <Typography
      variant="h5"
      component="p"
      role="timer"
      aria-label="Time left"
      color={endingSoon ? 'error' : 'text.primary'}
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {formatRemaining(remaining)}
    </Typography>
  );
}
