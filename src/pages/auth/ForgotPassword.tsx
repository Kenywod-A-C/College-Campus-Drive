import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Link, Stack, TextField } from '@mui/material';
import { authApi, USE_MOCK } from '@/api';
import { AuthFrame } from './AuthFrame';

export function ForgotPasswordPage() {
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(undefined);
    try { setMessage((await authApi.forgotPassword(email)).message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
  });

  return (
    <AuthFrame title="Forgot password" subtitle="Enter your college email and we’ll send a reset link.">
      {message ? (
        <Stack spacing={2}>
          <Alert severity="success">{message}</Alert>
          {USE_MOCK && <Button component={RouterLink} to="/reset-password?token=demo-token" variant="outlined">Demo: open the reset link</Button>}
          <Link component={RouterLink} to="/login" underline="hover">Back to sign in</Link>
        </Stack>
      ) : (
        <Box component="form" onSubmit={onSubmit} noValidate>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <Controller name="email" control={control} rules={{ required: 'Enter your email', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' } }} render={({ field }) => (
              <TextField {...field} label="College email" type="email" autoComplete="email" autoFocus error={!!errors.email} helperText={errors.email?.message} />
            )} />
            <Button type="submit" variant="contained" color="secondary" size="large" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Send reset link'}</Button>
            <Link component={RouterLink} to="/login" underline="hover" textAlign="center">Back to sign in</Link>
          </Stack>
        </Box>
      )}
    </AuthFrame>
  );
}
