import { Alert, Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '../api/auth';
import { useAuth } from '../hooks/useAuth';

/**
 * Route guard. Without a session it sends the user to the login page and back afterwards; with a
 * session but none of the roles it explains why. This only shapes the UI: every endpoint checks the
 * token and the role again on the server.
 */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { status, hasRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label="Restoring your session" />
      </Box>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (roles && !hasRole(...roles)) {
    return (
      <Alert severity="warning">
        This page needs the {roles.join(' or ')} role. Ask an admin if you need it.
      </Alert>
    );
  }
  return <Outlet />;
}
