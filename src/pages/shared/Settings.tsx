import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Divider, FormControlLabel, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material';
import type { NotificationPrefs } from '@/types';
import { authApi, DEMO_PASSWORD, notificationsApi, reportsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { ROLE_LABEL } from '@/auth/permissions';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { Grid, KeyValue, PageHeader, SectionCard } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { fmtDateTime } from '@/utils/format';
import { passwordRules } from '@/pages/auth/ResetPassword';

const PREF_LABELS: [keyof NotificationPrefs, string, string][] = [
  ['email', 'Email notifications', 'Send important updates to your college email (demo: no email is sent).'],
  ['push', 'Browser notifications', 'Show alerts while the app is open.'],
  ['driveReminders', 'Placement drive reminders', 'Reminders before drives you applied to.'],
  ['deadlineReminders', 'Application deadline reminders', 'Heads-up when a job you can apply to is closing.'],
  ['interviewAlerts', 'Interview alerts', 'Schedule changes and new interview invitations.'],
  ['offerUpdates', 'Offer updates', 'Offers issued, withdrawn or about to expire.'],
];

function Account() {
  const { user } = useAuth();
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  return (
    <SectionCard title="Account information" subtitle="These details are managed by the placement office. Contact them to change your name, email or role.">
      <Grid cols={{ xs: 1, sm: 2 }} gap={2.5}>
        <KeyValue label="Full name">{user!.name}</KeyValue>
        <KeyValue label="College email">{user!.email}</KeyValue>
        <KeyValue label="User ID">{user!.userCode}</KeyValue>
        <KeyValue label="Role">{ROLE_LABEL[user!.role]}</KeyValue>
        <KeyValue label="Department">{opts.data?.departments.find((d) => d.value === user!.departmentId)?.name ?? '—'}</KeyValue>
        <KeyValue label="Account status">{user!.status}</KeyValue>
      </Grid>
    </SectionCard>
  );
}

function Security() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { control, handleSubmit, reset, getValues, formState: { errors, isSubmitting } } = useForm({ defaultValues: { current: '', next: '', confirm: '' } });
  const [error, setError] = useState<string>();
  const submit = handleSubmit(async (v) => {
    setError(undefined);
    try { await authApi.changePassword(v.current, v.next); toast.success('Password changed'); reset(); }
    catch (e) { setError((e as Error).message); }
  });
  const remembered = (() => { try { return !!localStorage.getItem('ca_session'); } catch { return false; } })();
  return (
    <Stack spacing={2.5}>
      <SectionCard title="Change password">
        <Box component="form" onSubmit={submit} noValidate sx={{ maxWidth: 420 }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <Controller name="current" control={control} rules={{ required: 'Enter your current password' }} render={({ field }) => <TextField {...field} type="password" label="Current password" autoComplete="current-password" error={!!errors.current} helperText={errors.current?.message ?? (__USE_MOCK__ ? `Demo password: ${DEMO_PASSWORD}` : undefined)} />} />
            <Controller name="next" control={control} rules={passwordRules} render={({ field }) => <TextField {...field} type="password" label="New password" autoComplete="new-password" error={!!errors.next} helperText={errors.next?.message ?? '8+ characters, one uppercase letter and one number'} />} />
            <Controller name="confirm" control={control} rules={{ validate: (v) => v === getValues('next') || 'Passwords do not match' }} render={({ field }) => <TextField {...field} type="password" label="Confirm new password" autoComplete="new-password" error={!!errors.confirm} helperText={errors.confirm?.message} />} />
            <Box><Button type="submit" variant="contained" color="secondary" disabled={isSubmitting}>{isSubmitting ? 'Updating…' : 'Update password'}</Button></Box>
          </Stack>
        </Box>
      </SectionCard>
      <SectionCard title="Session & security">
        <Grid cols={{ xs: 1, sm: 2 }} gap={2.5}>
          <KeyValue label="Signed in as">{user!.email}</KeyValue>
          <KeyValue label="Last sign-in">{fmtDateTime(user!.lastLoginAt)}</KeyValue>
          <KeyValue label="This device">{navigator.userAgent.split(') ')[0].replace('Mozilla/5.0 (', '') || 'Browser'}</KeyValue>
          <KeyValue label="Session persistence">{remembered ? 'Remembered on this device' : 'Ends when you close the browser'}</KeyValue>
        </Grid>
        <Divider sx={{ my: 2.5 }} />
        <Button color="error" variant="outlined" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Log out of this device</Button>
      </SectionCard>
    </Stack>
  );
}

function Preferences() {
  const toast = useToast();
  const state = useAsync(() => notificationsApi.getPrefs(), []);
  const toggle = async (p: NotificationPrefs, key: keyof NotificationPrefs, v: boolean) => {
    const next = { ...p, [key]: v };
    state.setData(next);
    try { await notificationsApi.setPrefs(next); toast.success('Preferences saved'); } catch (e) { toast.error((e as Error).message); state.reload(); }
  };
  return (
    <SectionCard title="Notification preferences">
      <Async state={state}>
        {(p) => (
          <Stack divider={<Divider />} spacing={1.5}>
            {PREF_LABELS.map(([k, label, desc]) => (
              <Stack key={k} direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                <Box><Typography variant="body2" fontWeight={600}>{label}</Typography><Typography variant="body2" color="text.secondary">{desc}</Typography></Box>
                <FormControlLabel sx={{ m: 0 }} label="" control={<Switch checked={p[k]} onChange={(e) => toggle(p, k, e.target.checked)} slotProps={{ input: { 'aria-label': label } }} />} />
              </Stack>
            ))}
          </Stack>
        )}
      </Async>
    </SectionCard>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState('account');
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="account" label="Account" /><Tab value="security" label="Security & sessions" /><Tab value="notifications" label="Notifications" />
      </Tabs>
      {tab === 'account' && <Account />}
      {tab === 'security' && <Security />}
      {tab === 'notifications' && <Preferences />}
    </>
  );
}
