import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import { useAuth } from '@/auth/AuthContext';
import { ROLE_HOME } from '@/auth/permissions';

export function NotFoundPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ maxWidth: 480, textAlign: 'center', p: { xs: 3, sm: 5 } }}>
        <Stack alignItems="center" spacing={1.5}>
          <Box aria-hidden sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: '#dbeafe', color: 'secondary.main', display: 'grid', placeItems: 'center' }}><SearchOffIcon fontSize="large" /></Box>
          <Typography variant="h2" component="h1">Page not found</Typography>
          <Typography color="text.secondary">The page you’re looking for doesn’t exist or may have moved.</Typography>
          <Button variant="contained" color="secondary" onClick={() => navigate(user ? ROLE_HOME[user.role] : '/login', { replace: true })}>{user ? 'Back to dashboard' : 'Back to sign in'}</Button>
        </Stack>
      </Card>
    </Box>
  );
}
