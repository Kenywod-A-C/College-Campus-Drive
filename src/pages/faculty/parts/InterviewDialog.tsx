import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Autocomplete, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import type { InterviewView } from '@/api';
import { applicationsApi, interviewsApi, jobsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useToast } from '@/components/Toast';
import { toLocalInput } from '@/utils/format';

interface FV { jobId: string; round: string; at: string; durationMins: string; location: string; applicationIds: string[] }

/** Schedule or edit an interview round. Candidates are the shortlisted / interviewing applicants of the chosen job. */
export function InterviewDialog({ open, edit, onClose, onSaved }: { open: boolean; edit?: InterviewView; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [error, setError] = useState<string>();
  const { control, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FV>({ defaultValues: { jobId: '', round: '', at: '', durationMins: '45', location: '', applicationIds: [] } });
  const jobId = watch('jobId');
  const jobs = useAsync(() => (open ? jobsApi.list({ status: 'published', pageSize: 100 }) : Promise.resolve(undefined)), [open]);
  const cands = useAsync(() => (open && jobId ? applicationsApi.listAll({ jobId, pageSize: 100 }) : Promise.resolve(undefined)), [open, jobId]);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    reset(edit
      ? { jobId: edit.interview.jobId, round: edit.interview.round, at: toLocalInput(edit.interview.at), durationMins: String(edit.interview.durationMins), location: edit.interview.location, applicationIds: edit.interview.applicationIds }
      : { jobId: '', round: '', at: toLocalInput(new Date(Date.now() + 86400000).toISOString()), durationMins: '45', location: '', applicationIds: [] });
  }, [open, edit, reset]);

  const jobOptions = (jobs.data?.items ?? []).map((v) => ({ id: v.job.id, label: `${v.company.name} — ${v.job.title}` }));
  if (edit && !jobOptions.some((o) => o.id === edit.job.id)) jobOptions.push({ id: edit.job.id, label: `${edit.company.name} — ${edit.job.title}` });
  const selectedJob = jobs.data?.items.find((v) => v.job.id === jobId)?.job ?? edit?.job;
  const options = (cands.data?.items ?? []).filter((a) => ['shortlisted', 'interview'].includes(a.application.status) || watch('applicationIds').includes(a.application.id));

  const submit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      await interviewsApi.save({ id: edit?.interview.id, jobId: v.jobId, round: v.round, at: new Date(v.at).toISOString(), durationMins: Number(v.durationMins), location: v.location, applicationIds: v.applicationIds });
      toast.success(edit ? 'Interview updated. Students need to be re-notified.' : 'Interview scheduled');
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save interview'); }
  });

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>{edit ? 'Edit interview round' : 'Schedule interview round'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Controller name="jobId" control={control} rules={{ required: 'Select a job' }} render={({ field }) => (
            <TextField {...field} select label="Job" disabled={!!edit} error={!!errors.jobId} helperText={errors.jobId?.message} onChange={(e) => { field.onChange(e); setValue('applicationIds', []); }}>
              {jobOptions.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
            </TextField>
          )} />
          <Controller name="round" control={control} rules={{ required: 'Round name is required' }} render={({ field }) => (
            <Autocomplete freeSolo options={selectedJob?.rounds.map((r) => r.name) ?? []} value={field.value} onInputChange={(_, v) => field.onChange(v)} renderInput={(p) => <TextField {...p} label="Round" error={!!errors.round} helperText={errors.round?.message} />} />
          )} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Controller name="at" control={control} rules={{ required: 'Date and time required' }} render={({ field }) => <TextField {...field} type="datetime-local" label="Date & time" error={!!errors.at} helperText={errors.at?.message} slotProps={{ inputLabel: { shrink: true } }} />} />
            <Controller name="durationMins" control={control} rules={{ required: 'Required', min: { value: 5, message: 'At least 5 minutes' } }} render={({ field }) => <TextField {...field} type="number" label="Duration (min)" error={!!errors.durationMins} helperText={errors.durationMins?.message} />} />
          </Stack>
          <Controller name="location" control={control} rules={{ required: 'Room or meeting link is required' }} render={({ field }) => <TextField {...field} label="Location or meeting link" error={!!errors.location} helperText={errors.location?.message} />} />
          <Controller name="applicationIds" control={control} rules={{ validate: (v) => v.length > 0 || 'Select at least one candidate' }} render={({ field }) => (
            <Autocomplete multiple disableCloseOnSelect disabled={!jobId} loading={cands.loading} options={options} value={options.filter((a) => field.value.includes(a.application.id))}
              onChange={(_, v) => field.onChange(v.map((a) => a.application.id))} getOptionLabel={(a) => `${a.student?.name} (${a.student?.studentCode})`} isOptionEqualToValue={(a, b) => a.application.id === b.application.id}
              renderTags={(v, getProps) => v.map((a, i) => { const { key, ...p } = getProps({ index: i }); return <Chip key={key} size="small" label={a.student?.name} {...p} />; })}
              noOptionsText="No shortlisted candidates for this job yet"
              renderInput={(p) => <TextField {...p} label="Candidates (shortlisted / interviewing)" error={!!errors.applicationIds} helperText={errors.applicationIds?.message ?? (jobId ? undefined : 'Choose a job first')} />} />
          )} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" variant="contained" color="secondary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
}
