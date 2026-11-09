import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { NotificationBell } from '../pages/notifications/NotificationBell';

function AccountButtons() {
  const { status, user, logout, hasRole } = useAuth();
  const navigate = useNavigate();

  if (status === 'loading') return null;
  if (!user) {
    return (
      <Stack direction="row" spacing={1}>
        <Button color="inherit" component={RouterLink} to="/login">
          Log in
        </Button>
        <Button color="inherit" variant="outlined" component={RouterLink} to="/register">
          Register
        </Button>
      </Stack>
    );
  }
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {hasRole('BIDDER', 'SELLER') && (
        <Button color="inherit" component={RouterLink} to="/my-bids">
          My bids
        </Button>
      )}
      {hasRole('BIDDER', 'SELLER') && (
        <Button color="inherit" component={RouterLink} to="/wallet">
          Wallet
        </Button>
      )}
      {hasRole('SELLER') && (
        <Button color="inherit" component={RouterLink} to="/seller">
          My auctions
        </Button>
      )}
      <NotificationBell />
      <Button color="inherit" component={RouterLink} to="/account">
        {user.displayName}
      </Button>
      <Button
        color="inherit"
        onClick={() => {
          void logout().then(() => navigate('/'));
        }}
      >
        Log out
      </Button>
    </Stack>
  );
}

export function AppLayout() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static">
        {/* Wraps on narrow screens, so the logged-in buttons never make the page scroll sideways. */}
        <Toolbar sx={{ flexWrap: 'wrap', columnGap: 2, py: 1 }}>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: 'inherit', textDecoration: 'none', flexGrow: 1 }}
          >
            Online Auction Platform
          </Typography>
          <AccountButtons />
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
