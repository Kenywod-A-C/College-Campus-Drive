import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useAuth } from '@/auth/AuthContext';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/api';
import { AuthFrame } from './AuthFrame';

interface Values { identifier: string; password: string; remember: boolean }

export function LoginPage() {
  const { login } = useAuth();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string>();
  const { control, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { identifier: '', password: '', remember: false } });

  // On success AuthContext updates and <PublicOnly> redirects by role (or back to the originally requested page).
  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try { await login(v.identifier, v.password, v.remember); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed'); }
  });

  return (
    <AuthFrame title="Sign in" subtitle="Use your college email or user ID. Your role is assigned by the placement office.">
      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          <Controller name="identifier" control={control} rules={{ required: 'Enter your college email or user ID' }} render={({ field }) => (
            <TextField {...field} label="College email or user ID" autoComplete="username" autoFocus error={!!errors.identifier} helperText={errors.identifier?.message} />
          )} />
          <Controller name="password" control={control} rules={{ required: 'Enter your password' }} render={({ field }) => (
            <TextField {...field} label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" error={!!errors.password} helperText={errors.password?.message}
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton edge="end" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <VisibilityOffIcon /> : <VisibilityIcon />}</IconButton></InputAdornment> } }} />
          )} />
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Controller name="remember" control={control} render={({ field }) => <FormControlLabel control={<Checkbox size="small" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Remember me" />} />
            <Link component={RouterLink} to="/forgot-password" underline="hover" variant="body2">Forgot password?</Link>
          </Stack>
          <Button type="submit" variant="contained" color="secondary" size="large" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        </Stack>
      </Box>

      {/* __USE_MOCK__ (compile-time) keeps the demo credentials out of real builds */}
      {__USE_MOCK__ && <Box sx={{ mt: 4, p: 2, borderRadius: 3, bgcolor: '#f1f5f9', border: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2">Demo mode</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
          The sign-in is simulated. Pick an account to fill the form (password <b>{DEMO_PASSWORD}</b>), then press Sign in. Accounts are still checked by the mock API — there is no role selector.
        </Typography>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
          {DEMO_ACCOUNTS.map((a) => <Chip key={a.email} label={a.label} variant="outlined" onClick={() => { setValue('identifier', a.email); setValue('password', DEMO_PASSWORD); }} />)}
        </Stack>
      </Box>}
    </AuthFrame>
  );
}
