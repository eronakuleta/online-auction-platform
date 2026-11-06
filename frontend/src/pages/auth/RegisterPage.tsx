import { Box, Button, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useAuth } from '../../hooks/useAuth';

// Light checks only, to help before sending. The server validates everything again and its answer
// (for example EMAIL_TAKEN) is what the user sees.
const MIN_PASSWORD = 8;

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const mutation = useMutation({
    mutationFn: () => register({ email, password, displayName }),
    onSuccess: () => navigate('/', { replace: true }),
  });

  if (status === 'authenticated' && !mutation.isPending) {
    return <Navigate to="/" replace />;
  }

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit = email && displayName.trim() && password.length >= MIN_PASSWORD;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <Box sx={{ maxWidth: 420, mx: 'auto' }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 3 }} noValidate>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Create an account
          </Typography>
          <Typography variant="body2" color="text.secondary">
            New accounts can bid. An admin can give you the seller role.
          </Typography>
          {mutation.isError && <ErrorAlert error={mutation.error} title="Registration failed" />}
          <TextField
            label="Display name"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            required
            autoFocus
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={passwordTooShort}
            helperText={`At least ${MIN_PASSWORD} characters`}
            slotProps={{ htmlInput: { maxLength: 128 } }}
            required
          />
          <Button type="submit" variant="contained" disabled={mutation.isPending || !canSubmit}>
            {mutation.isPending ? 'Creating account…' : 'Register'}
          </Button>
          <Typography variant="body2">
            Already registered?{' '}
            <Link component={RouterLink} to="/login">
              Log in
            </Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
