// Create a new auction (/seller/auctions/new) or edit a draft (/seller/auctions/:id/edit).
// A new auction is always saved as a DRAFT; publishing is a separate step on the dashboard.
import { Alert, Link, Paper, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { auctionsApi, type AuctionInput } from '../../api/auctions';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';
import { AuctionForm } from './AuctionForm';

export function AuctionFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: ['auctions', id],
    queryFn: ({ signal }) => auctionsApi.get(id as string, signal),
    enabled: editing,
  });

  const save = useMutation({
    mutationFn: (input: AuctionInput) =>
      editing ? auctionsApi.update(id, input) : auctionsApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auctions'] });
      navigate('/seller');
    },
  });

  if (editing && existing.isPending) return <Loading label="Loading the auction" />;
  if (editing && existing.isError) return <ErrorAlert error={existing.error} />;

  // Only drafts can be edited (the server answers 409 AUCTION_NOT_DRAFT otherwise).
  if (editing && existing.data && existing.data.status !== 'DRAFT') {
    return (
      <Alert severity="info">
        This auction is {existing.data.status} and can no longer be edited.{' '}
        <Link component={RouterLink} to="/seller">
          Back to my auctions
        </Link>
      </Alert>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h1">
          {editing ? 'Edit draft' : 'New auction'}
        </Typography>
        {!editing && (
          <Typography variant="body2" color="text.secondary">
            It is saved as a draft. Nobody else sees it until you publish it.
          </Typography>
        )}
        {save.isError && <ErrorAlert error={save.error} title="Could not save" />}
        <AuctionForm
          key={existing.data?.updatedAt ?? 'new'}
          auction={existing.data}
          submitLabel={editing ? 'Save changes' : 'Save draft'}
          pending={save.isPending}
          onSubmit={(input) => save.mutate(input)}
          onCancel={() => navigate('/seller')}
        />
      </Stack>
    </Paper>
  );
}
