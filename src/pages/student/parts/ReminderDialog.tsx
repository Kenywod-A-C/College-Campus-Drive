import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import type { Reminder } from '@/types';
import { jobsApi, remindersApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useToast } from '@/components/Toast';
import { toLocalInput } from '@/utils/format';

interface Values { title: string; date: string; time: string; jobId: string }

/** Create / edit a reminder. Date and time are combined into one ISO timestamp for the API. */
export function ReminderDialog({ open, reminder, onClose, onSaved }: { open: boolean; reminder?: Reminder; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [error, setError] = useState<string>();
  const jobs = useAsync(() => (open ? jobsApi.list({ pageSize: 50 }) : Promise.resolve(undefined)), [open]);
  const { control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { title: '', date: '', time: '09:00', jobId: '' } });

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    const local = toLocalInput(reminder?.at ?? new Date(Date.now() + 86400000).toISOString());
    reset({ title: reminder?.title ?? '', date: local.slice(0, 10), time: reminder ? local.slice(11, 16) : '09:00', jobId: reminder?.jobId ?? '' });
  }, [open, reminder, reset]);

  const submit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      await remindersApi.save({ id: reminder?.id, title: v.title.trim(), at: new Date(`${v.date}T${v.time}`).toISOString(), jobId: v.jobId || undefined });
      toast.success(reminder ? 'Reminder updated' : 'Reminder created');
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save reminder'); }
  });

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>{reminder ? 'Edit reminder' : 'New reminder'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          <Controller name="title" control={control} rules={{ required: 'Describe what to be reminded about', maxLength: { value: 140, message: 'Keep it under 140 characters' } }} render={({ field }) => <TextField {...field} label="Description" error={!!errors.title} helperText={errors.title?.message} multiline minRows={2} />} />
          <Stack direction="row" spacing={1.5}>
            <Controller name="date" control={control} rules={{ required: 'Pick a date', validate: (d) => !!reminder || d >= toLocalInput().slice(0, 10) || 'Date cannot be in the past' }} render={({ field }) => <TextField {...field} type="date" label="Date" error={!!errors.date} helperText={errors.date?.message} slotProps={{ inputLabel: { shrink: true } }} />} />
            <Controller name="time" control={control} rules={{ required: 'Pick a time' }} render={({ field }) => <TextField {...field} type="time" label="Time" error={!!errors.time} helperText={errors.time?.message} slotProps={{ inputLabel: { shrink: true } }} />} />
          </Stack>
          <Controller name="jobId" control={control} render={({ field }) => (
            <TextField {...field} select label="Related drive (optional)" helperText="Link the reminder to a company drive">
              <MenuItem value="">None</MenuItem>
              {jobs.data?.items.map((v) => <MenuItem key={v.job.id} value={v.job.id}>{v.company.name} — {v.job.title}</MenuItem>)}
            </TextField>
          )} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" variant="contained" color="secondary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save reminder'}</Button>
      </DialogActions>
    </Dialog>
  );
}
