// The wallet (/wallet, FR-11): balance, a simulated deposit and the ledger history. Behind the
// BIDDER or SELLER guard (decision Q13). Every amount is integer cents from the server; the page
// only formats it.
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { useState, type FormEvent } from 'react';
import { MAX_DEPOSIT_CENTS, walletApi, type TransactionType } from '../../api/wallet';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { formatDateTime } from '../../utils/auction-labels';
import { formatMoney, parseMoneyToCents } from '../../utils/money';

const PAGE_SIZE = 10;

const TYPE_LABELS: Record<TransactionType, string> = {
  DEPOSIT: 'Deposit',
  SETTLEMENT_DEBIT: 'Auction won',
  SETTLEMENT_CREDIT: 'Item sold',
  PLATFORM_FEE: 'Platform fee',
};

function DepositForm({ currency }: { currency: string }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const cents = amount ? parseMoneyToCents(amount) : undefined;
  const invalid = cents === null || cents === 0 || (cents ?? 0) > MAX_DEPOSIT_CENTS;

  const deposit = useMutation({
    mutationFn: (amountCents: number) => walletApi.deposit(amountCents),
    onSuccess: async () => {
      setAmount('');
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cents && !invalid) deposit.mutate(cents);
  };

  return (
    <Stack component="form" spacing={1.5} onSubmit={submit} noValidate>
      <Typography variant="h6" component="h2">
        Add money
      </Typography>
      <Typography variant="body2" color="text.secondary">
        A simulated deposit: no real payment is made. Up to{' '}
        {formatMoney(MAX_DEPOSIT_CENTS, currency)} at a time.
      </Typography>
      {deposit.isError && <ErrorAlert error={deposit.error} title="Deposit failed" />}
      {deposit.isSuccess && (
        <Alert severity="success">
          {formatMoney(deposit.data.transaction.amountCents, currency)} added.
        </Alert>
      )}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label="Amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={amount !== '' && invalid}
          helperText={amount !== '' && invalid ? 'Between 0.01 and 10000.00' : ' '}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          sx={{ maxWidth: 220 }}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!amount || invalid || deposit.isPending}
        >
          {deposit.isPending ? 'Adding…' : 'Deposit'}
        </Button>
      </Stack>
    </Stack>
  );
}

function History({ currency }: { currency: string }) {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['wallet', 'transactions', page],
    queryFn: ({ signal }) => walletApi.transactions(page, PAGE_SIZE, signal),
    placeholderData: keepPreviousData,
  });

  if (history.isPending) return <Loading label="Loading transactions" />;
  if (history.isError) return <ErrorAlert error={history.error} />;
  if (history.data.total === 0) {
    return <Typography color="text.secondary">No transactions yet.</Typography>;
  }

  const totalPages = Math.max(1, Math.ceil(history.data.total / PAGE_SIZE));
  return (
    <Stack spacing={2}>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>What</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Balance after</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.data.data.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                <TableCell>
                  <Chip size="small" label={TYPE_LABELS[entry.type]} />
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ color: entry.amountCents < 0 ? 'error.main' : 'success.main' }}
                >
                  {entry.amountCents > 0 ? '+' : ''}
                  {formatMoney(entry.amountCents, currency)}
                </TableCell>
                <TableCell align="right">
                  {formatMoney(entry.balanceAfterCents, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {totalPages > 1 && (
        <Pagination
          sx={{ alignSelf: 'center' }}
          count={totalPages}
          page={page}
          onChange={(_event, next) => setPage(next)}
        />
      )}
    </Stack>
  );
}

export function WalletPage() {
  const wallet = useQuery({
    queryKey: ['wallet', 'me'],
    queryFn: ({ signal }) => walletApi.mine(signal),
  });

  if (wallet.isPending) return <Loading label="Loading your wallet" />;
  if (wallet.isError) return <ErrorAlert error={wallet.error} />;

  const { balanceCents, currency } = wallet.data;
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Wallet
      </Typography>
      <Paper sx={{ p: 3 }}>
        <Typography color="text.secondary">Balance</Typography>
        <Typography variant="h3" component="p">
          {formatMoney(balanceCents, currency)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Funds are checked when you bid, but not held: if you win several auctions, each payment
          needs enough balance when the auction closes.
        </Typography>
      </Paper>
      <Paper sx={{ p: 3 }}>
        <DepositForm currency={currency} />
      </Paper>
      <Box>
        <Typography variant="h6" component="h2" gutterBottom>
          History
        </Typography>
        <History currency={currency} />
      </Box>
    </Stack>
  );
}
