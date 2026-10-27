import type { ReactNode } from 'react';
import { Alert, AlertTitle, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import { ApiError } from '@/types';
import { Grid } from './ui';

export function EmptyState({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Stack alignItems="center" textAlign="center" spacing={1} sx={{ py: 6, px: 2 }}>
      <Box aria-hidden sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: '#eef2f7', color: 'text.secondary', display: 'grid', placeItems: 'center' }}>{icon ?? <InboxOutlinedIcon />}</Box>
      <Typography variant="h5" component="h3">{title}</Typography>
      {message && <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>{message}</Typography>}
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}

/**
 * Shows an API error: 403 -> permission denied, 501 -> honest "not available yet" (retrying cannot help),
 * 404 -> not found, anything else -> a retryable error. (401 never gets here: the HTTP client refreshes or signs the user out.)
 */
export function ErrorAlert({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const denied = error instanceof ApiError && error.status === 403;
  if (denied) {
    return <Card><EmptyState icon={<LockOutlinedIcon />} title="Permission denied" message={error.message} /></Card>;
  }
  if (error instanceof ApiError && error.status === 501) {
    return <Card><EmptyState icon={<ConstructionOutlinedIcon />} title="Not available yet" message={error.message} /></Card>;
  }
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <Alert severity={notFound ? 'warning' : 'error'} action={onRetry && !notFound ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : undefined}>
      <AlertTitle>{notFound ? 'Not found' : 'Something went wrong'}</AlertTitle>
      {error.message}
    </Alert>
  );
}

export const PageSkeleton = () => (
  <Stack spacing={2} aria-busy="true" aria-label="Loading">
    <Skeleton variant="text" width={260} height={44} />
    <Grid cols={{ xs: 1, sm: 2, lg: 4 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={88} />)}</Grid>
    <Grid cols={{ xs: 1, lg: 2 }}><Skeleton variant="rounded" height={260} /><Skeleton variant="rounded" height={260} /></Grid>
  </Stack>
);
export const TableSkeleton = ({ rows = 6 }: { rows?: number }) => (
  <Stack spacing={1} sx={{ p: 2 }} aria-busy="true" aria-label="Loading table">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} variant="rounded" height={40} />)}</Stack>
);
export const CardGridSkeleton = ({ count = 6 }: { count?: number }) => (
  <Grid cols={{ xs: 1, md: 2, xl: 3 }}>{Array.from({ length: count }).map((_, i) => <Skeleton key={i} variant="rounded" height={260} />)}</Grid>
);

/** Handles loading / error / data for a useAsync result. */
export function Async<T>({ state, children, skeleton }: { state: { data?: T; loading: boolean; error?: Error; reload: () => void }; children: (d: T) => ReactNode; skeleton?: ReactNode }) {
  if (state.error && !state.data) return <ErrorAlert error={state.error} onRetry={state.reload} />;
  if (state.loading && !state.data) return <>{skeleton ?? <PageSkeleton />}</>;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}
