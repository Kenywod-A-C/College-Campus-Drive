import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '@/auth/AuthContext';
import { ROLE_HOME } from '@/auth/permissions';

/** Access-denied page. `embedded` renders inside a layout (missing permission) instead of full-screen (wrong role). */
export function ForbiddenPage({ embedded }: { embedded?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const card = (
    <Card sx={{ maxWidth: 520, mx: 'auto', textAlign: 'center', p: { xs: 3, sm: 5 } }}>
      <Stack alignItems="center" spacing={1.5}>
        <Box aria-hidden sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: '#fee2e2', color: 'error.main', display: 'grid', placeItems: 'center' }}><LockOutlinedIcon fontSize="large" /></Box>
        <Typography variant="h2" component="h1">Access denied</Typography>
        <Typography color="text.secondary">
          {embedded ? 'Your role does not include the permission needed for this page. If you think this is a mistake, ask an administrator.' : "You don't have access to this area with your current account."}
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ pt: 1 }}>
          <Button variant="contained" color="secondary" onClick={() => navigate(user ? ROLE_HOME[user.role] : '/login', { replace: true })}>{user ? 'Go to my dashboard' : 'Go to sign in'}</Button>
          <Button color="inherit" onClick={() => navigate(-1)}>Go back</Button>
        </Stack>
      </Stack>
    </Card>
  );
  return embedded ? <Box sx={{ pt: 4 }}>{card}</Box> : <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>{card}</Box>;
}
