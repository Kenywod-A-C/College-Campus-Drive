import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Autocomplete, Box, Button, Card, Chip, LinearProgress, MenuItem, Step, StepLabel, Stepper, Stack, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { authApi, documentsApi, reportsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useToast } from '@/components/Toast';
import { ApiError } from '@/types';
import { DemoBanner, Grid } from '@/components/ui';

interface Values {
  studentCode: string; departmentId: string; degree: string; currentYear: string; graduationYear: string;
  cgpa: string; activeArrears: string; arrearHistory: string;
  skills: string[]; interests: string[]; preferredRoles: string[]; portfolioUrl: string;
}
const STEPS = ['Academics', 'Skills & interests', 'Resume & links'];
const FIELDS: (keyof Values)[][] = [
  ['studentCode', 'departmentId', 'degree', 'currentYear', 'graduationYear', 'cgpa', 'activeArrears', 'arrearHistory'],
  ['skills', 'preferredRoles'],
  ['portfolioUrl'],
];
const SKILL_SUGGESTIONS = ['Python', 'Java', 'C++', 'SQL', 'React', 'TypeScript', 'Node.js', 'Data Structures', 'Algorithms', 'Machine Learning', 'Cloud', 'Embedded Systems', 'AutoCAD'];
const INTEREST_SUGGESTIONS = ['Web Development', 'Data Science', 'Cloud', 'Embedded', 'Core Engineering', 'Product', 'Cybersecurity'];
const ROLE_SUGGESTIONS = ['Software Engineer', 'Full Stack Developer', 'Data Analyst', 'Graduate Engineer Trainee', 'QA Engineer'];

function ChipInput({ label, value, onChange, options, error, helperText }: { label: string; value: string[]; onChange: (v: string[]) => void; options: string[]; error?: boolean; helperText?: string }) {
  return (
    <Autocomplete multiple freeSolo options={options} value={value} onChange={(_, v) => onChange(v as string[])}
      renderValue={(vals, getItemProps) => vals.map((v, i) => { const { key, ...p } = getItemProps({ index: i }); return <Chip key={key} size="small" label={v} {...p} />; })}
      renderInput={(params) => <TextField {...params} label={label} error={error} helperText={helperText ?? 'Type and press Enter to add'} />} />
  );
}

export function OnboardingPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { control, trigger, getValues, watch, formState: { errors } } = useForm<Values>({
    mode: 'onTouched',
    defaultValues: { studentCode: '', departmentId: '', degree: '', currentYear: '4', graduationYear: '2027', cgpa: '', activeArrears: '0', arrearHistory: '0', skills: [], interests: [], preferredRoles: [], portfolioUrl: '' },
  });

  // Live profile-completion estimate
  const v = watch();
  const done = [v.studentCode, v.departmentId, v.degree, v.cgpa, v.skills.length >= 3 ? 'x' : '', v.interests.length ? 'x' : '', v.preferredRoles.length ? 'x' : '', file ? 'x' : '', v.portfolioUrl].filter(Boolean).length;
  const completion = Math.round((done / 9) * 100);

  const next = async () => { if (await trigger(FIELDS[step])) setStep((s) => s + 1); };
  const pickFile = (f?: File) => {
    setFile(f); setFileError(undefined);
    if (!f) return;
    if (!(f.type === 'application/pdf' || /word/.test(f.type))) setFileError('Only PDF or Word files are accepted.');
    else if (f.size > 5 * 1024 * 1024) setFileError('File is larger than the 5 MB limit.');
  };

  const finish = async () => {
    if (!(await trigger(FIELDS[2]))) return;
    if (fileError) return;
    const val = getValues();
    setBusy(true); setError(undefined);
    try {
      let resumeFile = file?.name;
      if (file) {
        try { await documentsApi.upload({ title: `${user!.name} — Resume`, type: 'resume', fileName: file.name, fileSizeKb: Math.ceil(file.size / 1024), mime: file.type }); }
        catch (e) {
          // Document storage is not available on every backend yet: finish onboarding, but never record a resume that was not stored.
          if (!(e instanceof ApiError && e.status === 501)) throw e;
          resumeFile = undefined;
          toast.toast('Your resume could not be uploaded because document storage is not available yet. You can add it later.', 'warning');
        }
      }
      await authApi.completeOnboarding({
        studentCode: val.studentCode.trim(), departmentId: val.departmentId, degree: val.degree, currentYear: Number(val.currentYear), graduationYear: Number(val.graduationYear),
        cgpa: Number(val.cgpa), activeArrears: Number(val.activeArrears), arrearHistory: Number(val.arrearHistory),
        skills: val.skills, interests: val.interests, preferredRoles: val.preferredRoles, resumeFile, portfolioUrl: val.portfolioUrl.trim() || undefined,
      });
      await refresh();
      navigate('/student/dashboard', { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your profile'); setBusy(false); }
  };

  const num = (min: number, max: number, label: string) => ({
    required: `${label} is required`,
    validate: (x: string) => (!isNaN(Number(x)) && Number(x) >= min && Number(x) <= max) || `Enter a value between ${min} and ${max}`,
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <DemoBanner />
      <Box sx={{ maxWidth: 760, mx: 'auto', p: { xs: 2, sm: 4 } }}>
        <Typography variant="h2" component="h1">Welcome, {user?.name.split(' ')[0]}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>Let’s set up your placement profile. This takes about two minutes, and you can edit most of it later.</Typography>

        <Card sx={{ p: 2, mb: 2.5 }}>
          <Stack direction="row" justifyContent="space-between"><Typography variant="subtitle2">Profile completion</Typography><Typography variant="subtitle2">{completion}%</Typography></Stack>
          <LinearProgress variant="determinate" value={completion} sx={{ mt: 1, height: 8, borderRadius: 4 }} aria-label="Profile completion" />
        </Card>

        <Card sx={{ p: { xs: 2, sm: 3.5 } }}>
          <Stepper activeStep={step} alternativeLabel sx={{ mb: 3.5 }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>

          {step === 0 && (
            <Stack spacing={2.5}>
              <Controller name="studentCode" control={control} rules={{ required: 'Student ID is required', pattern: { value: /^[A-Za-z0-9-]{5,16}$/, message: '5–16 letters or digits, e.g. 23CSE101' } }} render={({ field }) => <TextField {...field} label="Student ID" error={!!errors.studentCode} helperText={errors.studentCode?.message} />} />
              <Grid cols={{ xs: 1, sm: 2 }}>
                <Controller name="departmentId" control={control} rules={{ required: 'Choose your department' }} render={({ field }) => (
                  <TextField {...field} select label="Department" error={!!errors.departmentId} helperText={errors.departmentId?.message}>{(opts.data?.departments ?? []).map((d) => <MenuItem key={d.value} value={d.value}>{d.name}</MenuItem>)}</TextField>
                )} />
                <Controller name="degree" control={control} rules={{ required: 'Choose your degree' }} render={({ field }) => (
                  <TextField {...field} select label="Degree" error={!!errors.degree} helperText={errors.degree?.message}>{['B.E.', 'B.Tech', 'M.E.', 'M.Tech', 'MBA', 'MCA'].map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}</TextField>
                )} />
                <Controller name="currentYear" control={control} rules={{ required: true }} render={({ field }) => <TextField {...field} select label="Current academic year">{[1, 2, 3, 4].map((y) => <MenuItem key={y} value={String(y)}>Year {y}</MenuItem>)}</TextField>} />
                <Controller name="graduationYear" control={control} rules={{ required: true }} render={({ field }) => <TextField {...field} select label="Graduation year">{[2026, 2027, 2028, 2029].map((y) => <MenuItem key={y} value={String(y)}>{y}</MenuItem>)}</TextField>} />
              </Grid>
              <Controller name="cgpa" control={control} rules={num(0, 10, 'CGPA')} render={({ field }) => <TextField {...field} label="Current CGPA" inputMode="decimal" error={!!errors.cgpa} helperText={errors.cgpa?.message ?? 'Self-reported. The placement cell verifies it before you can apply to jobs.'} />} />
              <Grid cols={{ xs: 1, sm: 2 }}>
                <Controller name="activeArrears" control={control} rules={num(0, 30, 'Active arrears')} render={({ field }) => <TextField {...field} label="Active arrears" inputMode="numeric" error={!!errors.activeArrears} helperText={errors.activeArrears?.message ?? 'Standing arrears right now'} />} />
                <Controller name="arrearHistory" control={control} rules={num(0, 30, 'Arrear history')} render={({ field }) => <TextField {...field} label="Arrear history" inputMode="numeric" error={!!errors.arrearHistory} helperText={errors.arrearHistory?.message ?? 'Total arrears ever cleared'} />} />
              </Grid>
            </Stack>
          )}

          {step === 1 && (
            <Stack spacing={2.5}>
              <Controller name="skills" control={control} rules={{ validate: (x) => x.length >= 3 || 'Add at least 3 skills' }} render={({ field }) => <ChipInput label="Technical & domain skills" value={field.value} onChange={field.onChange} options={SKILL_SUGGESTIONS} error={!!errors.skills} helperText={(errors.skills?.message as string) ?? 'Type and press Enter to add'} />} />
              <Controller name="interests" control={control} render={({ field }) => <ChipInput label="Areas of interest" value={field.value} onChange={field.onChange} options={INTEREST_SUGGESTIONS} />} />
              <Controller name="preferredRoles" control={control} rules={{ validate: (x) => x.length >= 1 || 'Add at least one preferred role' }} render={({ field }) => <ChipInput label="Preferred job roles" value={field.value} onChange={field.onChange} options={ROLE_SUGGESTIONS} error={!!errors.preferredRoles} helperText={(errors.preferredRoles?.message as string) ?? 'Type and press Enter to add'} />} />
            </Stack>
          )}

          {step === 2 && (
            <Stack spacing={2.5}>
              <Box>
                <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx" onChange={(e) => pickFile(e.target.files?.[0])} />
                <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>Upload resume</Button>
                {file && <Chip sx={{ ml: 1.5 }} label={`${file.name} · ${Math.ceil(file.size / 1024)} KB`} onDelete={() => pickFile(undefined)} />}
                <Typography variant="caption" color={fileError ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.75 }} role={fileError ? 'alert' : undefined}>{fileError ?? 'PDF or Word, up to 5 MB. You can skip this and add it later, but you will not be able to complete a strong profile.'}</Typography>
              </Box>
              <Controller name="portfolioUrl" control={control} rules={{ pattern: { value: /^$|^https?:\/\/\S+\.\S+/, message: 'Enter a full URL starting with https://' } }} render={({ field }) => <TextField {...field} label="Portfolio or GitHub URL (optional)" error={!!errors.portfolioUrl} helperText={errors.portfolioUrl?.message} />} />
              <Alert severity="info">Your role, placement status and official CGPA verification are managed by the placement cell and cannot be changed from your profile.</Alert>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          )}

          <Stack direction="row" justifyContent="space-between" sx={{ mt: 4 }}>
            <Button color="inherit" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
            {step < STEPS.length - 1
              ? <Button variant="contained" color="secondary" onClick={next}>Continue</Button>
              : <Button variant="contained" color="secondary" onClick={finish} disabled={busy}>{busy ? 'Saving…' : 'Finish setup'}</Button>}
          </Stack>
        </Card>
      </Box>
    </Box>
  );
}
