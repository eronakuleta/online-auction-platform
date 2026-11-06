import { Box, Button, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useAuth } from '../../hooks/useAuth';

/** Where to go after logging in: the page the guard sent us from, or the catalog. */
function useReturnPath(): string {
  const state = useLocation().state as { from?: unknown } | null;
  return typeof state?.from === 'string' && state.from.startsWith('/') ? state.from : '/';
}

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: () => navigate(returnPath, { replace: true }),
  });

  if (status === 'authenticated' && !mutation.isPending) {
    return <Navigate to={returnPath} replace />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <Box sx={{ maxWidth: 420, mx: 'auto' }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 3 }} noValidate>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Log in
          </Typography>
          {mutation.isError && <ErrorAlert error={mutation.error} title="Login failed" />}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Button
            type="submit"
            variant="contained"
            disabled={mutation.isPending || !email || !password}
          >
            {mutation.isPending ? 'Logging in…' : 'Log in'}
          </Button>
          <Typography variant="body2">
            No account yet?{' '}
            <Link component={RouterLink} to="/register" state={{ from: returnPath }}>
              Register
            </Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
