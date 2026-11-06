import { Chip, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Loading } from '../../components/Loading';

/** The logged-in user's own profile, read from GET /users/me. Behind the login guard. */
export function AccountPage() {
  const me = useQuery({ queryKey: ['users', 'me'], queryFn: () => authApi.me() });

  if (me.isPending) return <Loading label="Loading your account" />;
  if (me.isError) return <ErrorAlert error={me.error} />;

  const user = me.data;
  return (
    <Paper sx={{ p: 3, maxWidth: 560 }}>
      <Stack spacing={1.5}>
        <Typography variant="h5" component="h1">
          {user.displayName}
        </Typography>
        <Typography color="text.secondary">{user.email}</Typography>
        <Stack direction="row" spacing={1}>
          {user.roles.map((role) => (
            <Chip key={role} label={role} size="small" />
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Member since {new Date(user.createdAt).toLocaleDateString()}
        </Typography>
      </Stack>
    </Paper>
  );
}
