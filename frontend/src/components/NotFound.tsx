import { Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

export function NotFound() {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h4">Page not found</Typography>
      <Button component={RouterLink} to="/" variant="contained">
        Back to the catalog
      </Button>
    </Stack>
  );
}
