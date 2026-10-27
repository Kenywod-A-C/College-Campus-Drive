import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { adminApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { Grid, KeyValue, PageHeader, SectionCard, StatusChip } from '@/components/ui';
import { useToast } from '@/components/Toast';

type Settings = Awaited<ReturnType<typeof adminApi.settings>>;
interface Form { collegeName: string; collegeEmail: string; academicYear: string; placementSeason: string; notifyEmailEnabled: boolean; notifyDigestHour: string; sessionTimeoutMins: string; maintenanceBanner: boolean }

const toForm = (s: Settings): Form => ({ collegeName: s.collegeName, collegeEmail: s.collegeEmail, academicYear: s.academicYear, placementSeason: s.placementSeason, notifyEmailEnabled: s.notifyEmailEnabled, notifyDigestHour: String(s.notifyDigestHour), sessionTimeoutMins: String(s.sessionTimeoutMins), maintenanceBanner: s.maintenanceBanner });

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const toast = useToast();
  const { control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Form>({ defaultValues: toForm(settings) });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => reset(toForm(settings)), [settings, reset]);

  const submit = handleSubmit(async (v) => {
    setBusy(true); setError(undefined);
    try {
      await adminApi.saveSettings({ ...v, collegeName: v.collegeName.trim(), notifyDigestHour: Number(v.notifyDigestHour), sessionTimeoutMins: Number(v.sessionTimeoutMins) });
      toast.success('Settings saved'); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save settings'); }
    finally { setBusy(false); }
  });

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <Stack spacing={3}>
        <Grid cols={{ xs: 1, lg: 2 }}>
          <SectionCard title="College details">
            <Stack spacing={2}>
              <Controller name="collegeName" control={control} rules={{ required: 'College name is required' }} render={({ field }) => <TextField {...field} label="College name" error={!!errors.collegeName} helperText={errors.collegeName?.message} />} />
              <Controller name="collegeEmail" control={control} rules={{ required: 'Contact email is required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } }} render={({ field }) => <TextField {...field} type="email" label="Placement office email" error={!!errors.collegeEmail} helperText={errors.collegeEmail?.message} />} />
            </Stack>
          </SectionCard>
          <SectionCard title="Academic configuration">
            <Stack spacing={2}>
              <Controller name="academicYear" control={control} rules={{ required: 'Required', pattern: { value: /^\d{4}-\d{2}$/, message: 'Use the format 2026-27' } }} render={({ field }) => <TextField {...field} label="Current academic year" error={!!errors.academicYear} helperText={errors.academicYear?.message} />} />
              <Controller name="placementSeason" control={control} render={({ field }) => <TextField {...field} label="Placement season" helperText="Shown on student dashboards." />} />
            </Stack>
          </SectionCard>
          <SectionCard title="Notification settings">
            <Stack spacing={1.5}>
              <Controller name="notifyEmailEnabled" control={control} render={({ field }) => <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Send email notifications (demo: no email is actually sent)" />} />
              <Controller name="notifyDigestHour" control={control} render={({ field }) => (
                <TextField {...field} select label="Daily digest time">{Array.from({ length: 24 }, (_, h) => <MenuItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</MenuItem>)}</TextField>
              )} />
            </Stack>
          </SectionCard>
          <SectionCard title="System preferences">
            <Stack spacing={2}>
              <Controller name="sessionTimeoutMins" control={control} rules={{ validate: (v) => (Number(v) >= 5 && Number(v) <= 1440) || 'Enter 5–1440 minutes' }} render={({ field }) => <TextField {...field} type="number" label="Session timeout (minutes)" error={!!errors.sessionTimeoutMins} helperText={errors.sessionTimeoutMins?.message} />} />
              <Controller name="maintenanceBanner" control={control} render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Show maintenance banner to all users" />} />
            </Stack>
          </SectionCard>
        </Grid>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1.5}>
          <Button type="submit" variant="contained" color="secondary" disabled={busy || !isDirty}>{busy ? 'Saving…' : 'Save settings'}</Button>
          <Button color="inherit" disabled={busy || !isDirty} onClick={() => reset(toForm(settings))}>Discard changes</Button>
        </Stack>
      </Stack>
    </Box>
  );
}

export function AdminSettings() {
  const state = useAsync(() => adminApi.settings(), []);
  return (
    <>
      <PageHeader title="System settings" subtitle="College, academic and notification configuration." />
      <Async state={state}>
        {(s) => (
          <Stack spacing={3}>
            <SectionCard title="AI provider configuration" subtitle="Status only. This page never reveals or accepts API keys.">
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
                <KeyValue label="Provider status"><StatusChip label={s.aiProvider.configured ? 'Configured' : 'Not configured'} tone={s.aiProvider.configured ? 'success' : 'error'} /></KeyValue>
                <KeyValue label="Model">{s.aiProvider.model}</KeyValue>
                <KeyValue label="Documents indexed">{s.aiProvider.ragIndexed}</KeyValue>
                <KeyValue label="Documents failed"><Typography variant="body2" fontWeight={500} color={s.aiProvider.ragFailed ? 'error' : undefined}>{s.aiProvider.ragFailed}</Typography></KeyValue>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                API keys and other secrets are stored only in the server environment and are never sent to the browser. To change the provider, update the server configuration and restart the API.
              </Typography>
            </SectionCard>
            <SettingsForm settings={s} onSaved={state.reload} />
          </Stack>
        )}
      </Async>
    </>
  );
}
