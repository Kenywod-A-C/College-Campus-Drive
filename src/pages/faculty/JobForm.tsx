import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, FormControlLabel, FormGroup, FormHelperText, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { Job } from '@/types';
import { jobsApi, reportsApi, type JobInput } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Async } from '@/components/feedback';
import { useToast } from '@/components/Toast';
import { PageHeader, SectionCard } from '@/components/ui';
import { toDateInput, toLocalInput } from '@/utils/format';

interface RoundFV { id?: string; name: string; mode: 'Online' | 'On-campus' | 'Virtual'; date: string; location: string }
interface FV {
  companyId: string; title: string; domain: string; location: string; type: Job['type']; description: string; responsibilities: string; skills: string[];
  minCgpa: string; maxActiveArrears: string; maxArrearHistory: string; departmentIds: string[]; graduationYears: number[];
  openDate: string; deadline: string; driveDate: string; rounds: RoundFV[]; ctcLpa: string; stipendPerMonth: string;
}
const YEARS = [2026, 2027, 2028, 2029];
const SKILL_SUGGESTIONS = ['Java', 'Python', 'C++', 'SQL', 'React', 'TypeScript', 'Node.js', 'Data Structures', 'Algorithms', 'Cloud', 'Embedded Systems', 'AutoCAD'];
const EMPTY: FV = {
  companyId: '', title: '', domain: 'Software', location: '', type: 'Full-time', description: '', responsibilities: '', skills: [], minCgpa: '6.5', maxActiveArrears: '0', maxArrearHistory: '',
  departmentIds: [], graduationYears: [2027], openDate: toDateInput(), deadline: '', driveDate: '', rounds: [{ name: 'Online Assessment', mode: 'Online', date: '', location: '' }], ctcLpa: '', stipendPerMonth: '',
};
const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);

const toForm = (j: Job): FV => ({
  companyId: j.companyId, title: j.title, domain: j.domain, location: j.location, type: j.type, description: j.description, responsibilities: j.responsibilities.join('\n'), skills: j.skills,
  minCgpa: String(j.eligibility.minCgpa), maxActiveArrears: String(j.eligibility.maxActiveArrears), maxArrearHistory: j.eligibility.maxArrearHistory != null ? String(j.eligibility.maxArrearHistory) : '',
  departmentIds: j.eligibility.departmentIds, graduationYears: j.eligibility.graduationYears, openDate: toDateInput(j.openDate), deadline: toLocalInput(j.deadline), driveDate: j.driveDate ? toLocalInput(j.driveDate) : '',
  rounds: j.rounds.map((r) => ({ id: r.id, name: r.name, mode: r.mode, date: r.date ? toLocalInput(r.date) : '', location: r.location ?? '' })),
  ctcLpa: j.ctcLpa != null ? String(j.ctcLpa) : '', stipendPerMonth: j.stipendPerMonth != null ? String(j.stipendPerMonth) : '',
});

const toInput = (v: FV, id: string | undefined, status: 'draft' | 'published'): JobInput => ({
  id, status, companyId: v.companyId, title: v.title.trim(), domain: v.domain.trim() || 'General', location: v.location.trim(), type: v.type, description: v.description.trim(),
  responsibilities: v.responsibilities.split('\n').map((s) => s.trim()).filter(Boolean), skills: v.skills,
  eligibility: { minCgpa: Number(v.minCgpa), maxActiveArrears: Number(v.maxActiveArrears), maxArrearHistory: v.maxArrearHistory === '' ? undefined : Number(v.maxArrearHistory), departmentIds: v.departmentIds, graduationYears: v.graduationYears, requiredSkills: v.skills },
  rounds: v.rounds.map((r, i) => ({ id: r.id ?? `r_new_${i}_${Date.now()}`, name: r.name.trim(), mode: r.mode, date: iso(r.date), location: r.location.trim() || undefined })),
  ctcLpa: v.ctcLpa ? Number(v.ctcLpa) : undefined, stipendPerMonth: v.stipendPerMonth ? Number(v.stipendPerMonth) : undefined,
  openDate: iso(v.openDate)!, deadline: iso(v.deadline)!, driveDate: iso(v.driveDate),
});

export function FacultyJobForm() {
  const { jobId } = useParams();
  const [params] = useSearchParams();
  const base = useBase();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const editing = !!jobId;
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const existing = useAsync(() => (jobId ? jobsApi.get(jobId) : Promise.resolve(undefined)), [jobId]);
  const [confirm, setConfirm] = useState<FV>();
  const [serverError, setServerError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<FV>({ defaultValues: { ...EMPTY, companyId: params.get('companyId') ?? '' } });
  const { fields, append, remove, move } = useFieldArray({ control, name: 'rounds' });
  useEffect(() => { if (existing.data) reset(toForm(existing.data.job)); }, [existing.data, reset]);

  const job = existing.data?.job;
  const locked = !!job && (job.status === 'closed' || job.status === 'cancelled');
  const wasPublished = job?.status === 'published';
  const openDate = watch('openDate');
  const crumbs = [{ label: 'Jobs & drives', to: `${base}/jobs` }, ...(job ? [{ label: job.title, to: `${base}/jobs/${job.id}` }, { label: 'Edit' }] : [{ label: 'New job' }])];

  const save = async (v: FV, status: 'draft' | 'published') => {
    setSaving(true); setServerError(undefined);
    try {
      const saved = await jobsApi.save(toInput(v, jobId, status));
      toast.success(status === 'published' && !wasPublished ? 'Job published' : editing ? 'Changes saved' : 'Draft saved');
      navigate(`${base}/jobs/${saved.id}`);
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Could not save the job'); setConfirm(undefined); }
    finally { setSaving(false); }
  };

  const num = (name: 'minCgpa' | 'maxActiveArrears' | 'maxArrearHistory' | 'ctcLpa' | 'stipendPerMonth', label: string, rules: object, adornment?: string) => (
    <Controller name={name} control={control} rules={rules} render={({ field }) => (
      <TextField {...field} type="number" label={label} error={!!errors[name]} helperText={errors[name]?.message} slotProps={{ htmlInput: { step: 'any', min: 0 }, input: adornment ? { endAdornment: <Typography variant="caption" color="text.secondary">{adornment}</Typography> } : undefined }} />
    )} />
  );
  const txt = (name: 'title' | 'domain' | 'location' | 'description' | 'responsibilities', label: string, rules: object = {}, extra: object = {}) => (
    <Controller name={name} control={control} rules={rules} render={({ field }) => <TextField {...field} label={label} error={!!errors[name]} helperText={errors[name]?.message} {...extra} />} />
  );

  const body = (
    <Box component="form" noValidate onSubmit={(e) => e.preventDefault()}>
      <PageHeader title={editing ? `Edit ${job?.title ?? 'job'}` : 'New job'} subtitle="Roles belong to an existing company; the company record is never duplicated." crumbs={crumbs} />
      <Stack spacing={2.5}>
        {locked && <Alert severity="warning">This job is {job!.status} and can no longer be edited.</Alert>}
        {serverError && <Alert severity="error" onClose={() => setServerError(undefined)}>{serverError}</Alert>}
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Stack spacing={2.5}>
            <SectionCard title="Role details">
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Controller name="companyId" control={control} rules={{ required: 'Select a company' }} render={({ field }) => (
                    <TextField {...field} value={opts.data ? field.value : ""} select label="Company" error={!!errors.companyId} helperText={errors.companyId?.message ?? 'Pick an existing company'} disabled={editing}>
                      {(opts.data?.companies ?? []).map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                    </TextField>
                  )} />
                  {txt('title', 'Job title', { required: 'Job title is required' })}
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  {txt('domain', 'Domain')}
                  {txt('location', 'Location', { required: 'Location is required' })}
                  <Controller name="type" control={control} render={({ field }) => (
                    <TextField {...field} select label="Employment type">{['Full-time', 'Internship', 'Internship + PPO'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
                  )} />
                </Stack>
                {txt('description', 'Job description', { required: 'Add a description' }, { multiline: true, minRows: 3 })}
                {txt('responsibilities', 'Responsibilities (one per line)', {}, { multiline: true, minRows: 3 })}
                <Controller name="skills" control={control} render={({ field }) => (
                  <Autocomplete multiple freeSolo options={SKILL_SUGGESTIONS} value={field.value} onChange={(_, v) => field.onChange(v.map((s) => String(s).trim()).filter(Boolean))}
                    renderTags={(v, getProps) => v.map((o, i) => { const { key, ...p } = getProps({ index: i }); return <Chip key={key} size="small" label={o} {...p} />; })}
                    renderInput={(p) => <TextField {...p} label="Required skills" helperText="Type a skill and press Enter" />} />
                )} />
              </Stack>
            </SectionCard>

            <SectionCard title="Eligibility criteria" subtitle="Evaluated by the backend eligibility service for every student and again at application time.">
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  {num('minCgpa', 'Minimum CGPA', { required: 'Required', min: { value: 0, message: 'Min 0' }, max: { value: 10, message: 'Max 10' } })}
                  {num('maxActiveArrears', 'Max active arrears', { required: 'Required', min: { value: 0, message: 'Cannot be negative' } })}
                  {num('maxArrearHistory', 'Max arrear history (optional)', { min: { value: 0, message: 'Cannot be negative' } })}
                </Stack>
                <Controller name="departmentIds" control={control} rules={{ validate: (v) => v.length > 0 || 'Select at least one department' }} render={({ field }) => {
                  const dopts = opts.data?.departments ?? [];
                  return (
                    <Autocomplete multiple disableCloseOnSelect options={dopts.map((d) => d.value)} value={field.value} onChange={(_, v) => field.onChange(v)} getOptionLabel={(id) => dopts.find((d) => d.value === id)?.name ?? id}
                      renderTags={(v, getProps) => v.map((o, i) => { const { key, ...p } = getProps({ index: i }); return <Chip key={key} size="small" label={dopts.find((d) => d.value === o)?.label ?? o} {...p} />; })}
                      renderInput={(p) => <TextField {...p} label="Eligible departments" error={!!errors.departmentIds} helperText={errors.departmentIds?.message} />} />
                  );
                }} />
                <Controller name="graduationYears" control={control} rules={{ validate: (v) => v.length > 0 || 'Select at least one graduation year' }} render={({ field }) => (
                  <Box>
                    <Typography variant="subtitle2" id="gy-label">Eligible graduation years</Typography>
                    <FormGroup row aria-labelledby="gy-label">
                      {YEARS.map((y) => <FormControlLabel key={y} label={String(y)} control={<Checkbox checked={field.value.includes(y)} onChange={(e) => field.onChange(e.target.checked ? [...field.value, y].sort() : field.value.filter((x) => x !== y))} />} />)}
                    </FormGroup>
                    {errors.graduationYears && <FormHelperText error>{errors.graduationYears.message}</FormHelperText>}
                  </Box>
                )} />
              </Stack>
            </SectionCard>

            <SectionCard title="Schedule & compensation">
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Controller name="openDate" control={control} rules={{ required: 'Opening date is required' }} render={({ field }) => <TextField {...field} type="date" label="Applications open" error={!!errors.openDate} helperText={errors.openDate?.message} slotProps={{ inputLabel: { shrink: true } }} />} />
                  <Controller name="deadline" control={control} rules={{ required: 'Deadline is required', validate: (v) => !openDate || new Date(v) > new Date(openDate) || 'Deadline must be after the opening date' }} render={({ field }) => <TextField {...field} type="datetime-local" label="Application deadline" error={!!errors.deadline} helperText={errors.deadline?.message} slotProps={{ inputLabel: { shrink: true } }} />} />
                  <Controller name="driveDate" control={control} render={({ field }) => <TextField {...field} type="datetime-local" label="Hiring drive date (optional)" slotProps={{ inputLabel: { shrink: true } }} />} />
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  {num('ctcLpa', 'Package (CTC)', { min: { value: 0.1, message: 'Must be positive' } }, 'LPA')}
                  {num('stipendPerMonth', 'Stipend (internships)', { min: { value: 0, message: 'Cannot be negative' } }, '₹/month')}
                </Stack>
              </Stack>
            </SectionCard>

            <SectionCard title="Hiring rounds" subtitle="Rounds run in the order listed." action={<Button size="small" startIcon={<AddIcon />} onClick={() => append({ name: '', mode: 'On-campus', date: '', location: '' })}>Add round</Button>}>
              <Stack spacing={1.5}>
                {fields.length === 0 && <Typography variant="body2" color="text.secondary">No rounds yet. Add at least one.</Typography>}
                {fields.map((f, i) => (
                  <Stack key={f.id} direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                    <Chip label={i + 1} size="small" sx={{ mt: { md: 0.75 } }} />
                    <Controller name={`rounds.${i}.name`} control={control} rules={{ required: 'Round name required' }} render={({ field }) => <TextField {...field} label="Round name" error={!!errors.rounds?.[i]?.name} helperText={errors.rounds?.[i]?.name?.message} />} />
                    <Controller name={`rounds.${i}.mode`} control={control} render={({ field }) => <TextField {...field} select label="Mode" sx={{ minWidth: 150 }}>{['Online', 'On-campus', 'Virtual'].map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}</TextField>} />
                    <Controller name={`rounds.${i}.date`} control={control} render={({ field }) => <TextField {...field} type="datetime-local" label="Date & time" slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 210 }} />} />
                    <Controller name={`rounds.${i}.location`} control={control} render={({ field }) => <TextField {...field} label="Location / link" />} />
                    <Stack direction="row">
                      <Tooltip title="Move up"><span><IconButton aria-label={`Move round ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Move down"><span><IconButton aria-label={`Move round ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, i + 1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Remove"><IconButton aria-label={`Remove round ${i + 1}`} onClick={() => remove(i)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </SectionCard>
          </Stack>
        </fieldset>

        <Stack direction="row" spacing={1.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
          <Button color="inherit" onClick={() => navigate(job ? `${base}/jobs/${job.id}` : `${base}/jobs`)} disabled={saving}>Cancel</Button>
          {!locked && (wasPublished
            ? <Button variant="contained" color="secondary" disabled={saving} onClick={handleSubmit((v) => save(v, 'published'))}>Save changes</Button>
            : <>
                <Button variant="outlined" disabled={saving} onClick={handleSubmit((v) => save(v, 'draft'))}>Save draft</Button>
                {can('drives.publish') && <Button variant="contained" color="secondary" disabled={saving} onClick={handleSubmit((v) => setConfirm(v))}>Publish…</Button>}
              </>)}
        </Stack>
      </Stack>
      <ConfirmDialog open={!!confirm} title="Publish this job?" confirmLabel="Publish" onClose={() => setConfirm(undefined)} onConfirm={() => save(confirm!, 'published')}>
        <Typography variant="body2">Eligible students will be able to see <b>{confirm?.title}</b> and apply until the deadline. You can still edit details and close applications later.</Typography>
      </ConfirmDialog>
    </Box>
  );

  if (!editing) return body;
  return <Async state={existing}>{() => body}</Async>;
}
