import { Box, CircularProgress } from '@mui/material';

export function Loading({ label }: { label: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress aria-label={label} />
    </Box>
  );
}
