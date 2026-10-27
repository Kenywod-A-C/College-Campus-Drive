import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, IconButton, InputAdornment, Link, Stack, TextField } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { authApi, USE_MOCK } from '@/api';
import { AuthFrame } from './AuthFrame';

interface Values { password: string; confirm: string }
export const passwordRules = {
  required: 'Enter a new password',
  minLength: { value: 8, message: 'Use at least 8 characters' },
  validate: (v: string) => (/[A-Z]/.test(v) && /\d/.test(v)) || 'Include an uppercase letter and a number',
};

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const { control, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try { await authApi.resetPassword(token, v.password); setDone(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reset password'); }
  });

  if (!token) {
    return (
      <AuthFrame title="Reset link invalid">
        <Alert severity="warning" sx={{ mb: 2 }}>This reset link is missing or has expired. Request a new one.</Alert>
        <Button component={RouterLink} to="/forgot-password" variant="contained" color="secondary">Request a new link</Button>
      </AuthFrame>
    );
  }
  if (done) {
    return (
      <AuthFrame title="Password updated">
        <Alert severity="success" sx={{ mb: 2 }}>Your password has been reset{USE_MOCK ? ' (demo: nothing is stored)' : ''}. You can now sign in.</Alert>
        <Button component={RouterLink} to="/login" variant="contained" color="secondary">Go to sign in</Button>
      </AuthFrame>
    );
  }
  const adorn = { input: { endAdornment: <InputAdornment position="end"><IconButton edge="end" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <VisibilityOffIcon /> : <VisibilityIcon />}</IconButton></InputAdornment> } };
  return (
    <AuthFrame title="Set a new password" subtitle="Choose a strong password you don’t use elsewhere.">
      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Controller name="password" control={control} rules={passwordRules} render={({ field }) => (
            <TextField {...field} label="New password" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus error={!!errors.password} helperText={errors.password?.message ?? '8+ characters, one uppercase letter and one number'} slotProps={adorn} />
          )} />
          <Controller name="confirm" control={control} rules={{ validate: (v) => v === getValues('password') || 'Passwords do not match' }} render={({ field }) => (
            <TextField {...field} label="Confirm new password" type={show ? 'text' : 'password'} autoComplete="new-password" error={!!errors.confirm} helperText={errors.confirm?.message} />
          )} />
          <Button type="submit" variant="contained" color="secondary" size="large" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Reset password'}</Button>
          <Link component={RouterLink} to="/login" underline="hover" textAlign="center">Back to sign in</Link>
        </Stack>
      </Box>
    </AuthFrame>
  );
}
