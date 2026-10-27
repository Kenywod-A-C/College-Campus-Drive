import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Chip, LinearProgress, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import type { Student } from '@/types';
import { documentsApi, studentApi, type ProfilePatch } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Grid, PageHeader, PlacementChip, SectionCard, StatusChip } from '@/components/ui';
import { Async, EmptyState } from '@/components/feedback';
import { DOC_TYPE_LABEL, UploadDialog } from '@/components/DocumentUpload';
import { useToast } from '@/components/Toast';
import { useDeptName } from '@/hooks/useDeptName';
import { fmtDate } from '@/utils/format';
import { ChipInput } from './parts/ChipInput';

interface Values { phone: string; degree: string; currentYear: string; cgpa: string; activeArrears: string; arrearHistory: string; skills: string[]; interests: string[]; preferredRoles: string[]; portfolioUrl: string }
const toValues = (s: Student): Values => ({
  phone: s.phone ?? '', degree: s.degree, currentYear: String(s.currentYear), cgpa: s.academic.cgpa?.toString() ?? '', activeArrears: String(s.academic.activeArrears), arrearHistory: String(s.academic.arrearHistory),
  skills: s.skills, interests: s.interests, preferredRoles: s.preferredRoles, portfolioUrl: s.portfolioUrl ?? '',
});
const SKILL_OPTIONS = ['React', 'TypeScript', 'JavaScript', 'Python', 'Java', 'C++', 'C', 'SQL', 'Node.js', 'Data Structures', 'Algorithms', 'Cloud', 'Machine Learning', 'Embedded Systems', 'AutoCAD'];
const INTEREST_OPTIONS = ['Web Development', 'Data Science', 'Cloud', 'Embedded', 'Core Engineering', 'Product', 'Cybersecurity', 'AI / ML'];
const ROLE_OPTIONS = ['Software Engineer', 'Full Stack Developer', 'Data Analyst', 'Graduate Engineer Trainee', 'Embedded Engineer', 'DevOps Engineer'];

function Locked({ label, value, hint = 'Managed by the placement cell' }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><LockOutlinedIcon sx={{ fontSize: 12 }} />{label}</Typography>
      <Typography variant="body2" fontWeight={500} component="div">{value || '—'}</Typography>
      <Typography variant="caption" color="text.secondary">{hint}</Typography>
    </Box>
  );
}

function ProfileEditor({ student, onSaved }: { student: Student; onSaved: () => void }) {
  const deptName = useDeptName();
  const toast = useToast();
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const docs = useAsync(() => documentsApi.list(), []);
  const { control, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<Values>({ defaultValues: toValues(student) });
  const a = student.academic;
  const ro = !editing;

  const cancel = () => { reset(toValues(student)); setEditing(false); setServerError(undefined); };
  const save = handleSubmit(async (v) => {
    setServerError(undefined);
    const patch: ProfilePatch = {
      phone: v.phone.trim() || undefined, degree: v.degree.trim(), currentYear: Number(v.currentYear), skills: v.skills, interests: v.interests, preferredRoles: v.preferredRoles,
      portfolioUrl: v.portfolioUrl.trim() || undefined, activeArrears: Number(v.activeArrears), arrearHistory: Number(v.arrearHistory),
      ...(v.cgpa.trim() ? { cgpa: Number(v.cgpa) } : {}),
    };
    try {
      const updated = await studentApi.updateProfile(patch);
      reset(toValues(updated)); setEditing(false); toast.success('Profile saved'); onSaved();
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Could not save profile'); }
  });

  // After an upload, point the profile's resume at the newest resume document.
  const syncResume = async () => {
    const list = await documentsApi.list({ type: 'resume' });
    const latest = list.find((d) => d.canManage);
    if (latest) await studentApi.updateProfile({ resumeFile: latest.doc.title });
    docs.reload(); onSaved();
  };
  const own = docs.data?.filter((d) => d.canManage) ?? [];

  const missing = [
    !student.phone && 'phone number', student.academic.cgpa == null && 'CGPA', student.skills.length < 3 && 'at least 3 skills', !student.interests.length && 'interests',
    !student.preferredRoles.length && 'preferred roles', !student.resumeFile && 'resume', !student.portfolioUrl && 'portfolio / GitHub link',
  ].filter(Boolean) as string[];

  const num = (label: string, name: 'cgpa' | 'activeArrears' | 'arrearHistory' | 'currentYear', rules: object, helper?: string) => (
    <Controller name={name} control={control} rules={rules} render={({ field }) => <TextField {...field} type="number" label={label} disabled={ro} error={!!errors[name]} helperText={errors[name]?.message ?? helper} slotProps={{ htmlInput: { step: name === 'cgpa' ? 0.01 : 1, min: 0 } }} />} />
  );

  return (
    <>
      <PageHeader title="My Profile" subtitle="Keep your details current. Eligibility is calculated from them." actions={editing ? (
        <>
          <Button color="inherit" onClick={cancel} disabled={isSubmitting}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={save} disabled={isSubmitting || !isDirty}>{isSubmitting ? 'Saving…' : 'Save changes'}</Button>
        </>
      ) : <Button variant="contained" color="secondary" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(true)}>Edit profile</Button>} />

      <SectionCard sx={{ mb: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between"><Typography variant="subtitle2">Profile completion</Typography><Typography variant="subtitle2">{student.profileCompletion}%</Typography></Stack>
            <LinearProgress variant="determinate" value={student.profileCompletion} sx={{ height: 8, borderRadius: 4, my: 1 }} aria-label="Profile completion" />
            <Typography variant="body2" color="text.secondary">{missing.length ? `Still missing: ${missing.join(', ')}.` : 'Your profile is complete.'}</Typography>
          </Box>
          <PlacementChip status={student.placementStatus} />
        </Stack>
      </SectionCard>
      {serverError && <Alert severity="error" sx={{ mb: 2 }}>{serverError}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }} aria-label="Profile sections">
        <Tab label="Personal" /><Tab label="Academic" /><Tab label="Skills & interests" /><Tab label="Resume & documents" /><Tab label="Placement preferences" />
      </Tabs>

      {tab === 0 && (
        <SectionCard title="Personal information">
          <Grid cols={{ xs: 1, sm: 2 }} gap={2.5}>
            <Locked label="Full name" value={student.name} />
            <Locked label="College email" value={student.email} />
            <Controller name="phone" control={control} rules={{ pattern: { value: /^\+?[0-9 ]{10,15}$/, message: 'Enter a valid phone number (10–15 digits)' } }} render={({ field }) => <TextField {...field} label="Phone" disabled={ro} error={!!errors.phone} helperText={errors.phone?.message} />} />
            <Locked label="Student ID" value={student.studentCode} />
          </Grid>
        </SectionCard>
      )}
      {tab === 1 && (
        <SectionCard title="Academic information">
          {editing && <Alert severity="warning" sx={{ mb: 2.5 }}>Changing your CGPA or active arrears marks it <b>unverified</b> until the placement cell verifies it again, and you cannot apply to jobs while it is unverified.</Alert>}
          <Grid cols={{ xs: 1, sm: 2 }} gap={2.5}>
            <Locked label="Department" value={deptName(student.departmentId)} />
            <Locked label="Graduation year" value={student.graduationYear} />
            <Controller name="degree" control={control} rules={{ required: 'Degree is required' }} render={({ field }) => <TextField {...field} label="Degree" disabled={ro} error={!!errors.degree} helperText={errors.degree?.message} />} />
            {num('Current academic year', 'currentYear', { required: 'Required', min: { value: 1, message: 'Between 1 and 6' }, max: { value: 6, message: 'Between 1 and 6' } })}
            <Box>
              {num('CGPA', 'cgpa', { min: { value: 0, message: 'CGPA must be between 0 and 10' }, max: { value: 10, message: 'CGPA must be between 0 and 10' } }, a.cgpa == null ? 'Not added yet' : undefined)}
              <Box sx={{ mt: 0.75 }}><StatusChip label={a.cgpa == null ? 'Missing' : a.cgpaVerified ? 'Verified by placement cell' : 'Unverified'} tone={a.cgpa == null ? 'warning' : a.cgpaVerified ? 'success' : 'warning'} /></Box>
            </Box>
            <Stack spacing={2}>
              {num('Active arrears', 'activeArrears', { required: 'Required', min: { value: 0, message: 'Cannot be negative' }, validate: (x: string) => Number.isInteger(Number(x)) || 'Whole number only' })}
              {num('Arrear history (cleared)', 'arrearHistory', { required: 'Required', min: { value: 0, message: 'Cannot be negative' }, validate: (x: string) => Number.isInteger(Number(x)) || 'Whole number only' })}
            </Stack>
          </Grid>
        </SectionCard>
      )}
      {tab === 2 && (
        <SectionCard title="Skills and interests">
          <Stack spacing={2.5}>
            <ChipInput name="skills" control={control} label="Technical & domain skills" options={SKILL_OPTIONS} disabled={ro} />
            <ChipInput name="interests" control={control} label="Areas of interest" options={INTEREST_OPTIONS} disabled={ro} />
          </Stack>
        </SectionCard>
      )}
      {tab === 3 && (
        <Stack spacing={2.5}>
          <SectionCard title="Resume" action={<Button startIcon={<UploadFileIcon />} onClick={() => setUploading(true)}>Upload</Button>}>
            <Typography variant="body2" sx={{ mb: 2 }}>{student.resumeFile ? <>Current resume: <b>{student.resumeFile}</b></> : 'No resume uploaded yet.'}</Typography>
            <Controller name="portfolioUrl" control={control} rules={{ pattern: { value: /^https?:\/\/\S+\.\S+/, message: 'Enter a full URL starting with http:// or https://' } }} render={({ field }) => <TextField {...field} label="Portfolio or GitHub URL (optional)" disabled={ro} error={!!errors.portfolioUrl} helperText={errors.portfolioUrl?.message} />} />
          </SectionCard>
          <SectionCard title="My documents" action={<Button size="small" component={RouterLink} to="/student/documents">Document library</Button>}>
            <Async state={docs} skeleton={<Typography variant="body2" color="text.secondary">Loading…</Typography>}>
              {() => own.length === 0 ? <EmptyState title="No documents uploaded" message="Upload your resume and certificates so recruiters and the placement cell can see them." /> : (
                <Stack spacing={1.25}>{own.map(({ doc }) => (
                  <Stack key={doc.id} direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{doc.title}</Typography><Typography variant="caption" color="text.secondary">Uploaded {fmtDate(doc.uploadedAt)} · v{doc.version}</Typography></Box>
                    <Chip size="small" label={DOC_TYPE_LABEL[doc.type]} />
                  </Stack>
                ))}</Stack>
              )}
            </Async>
          </SectionCard>
        </Stack>
      )}
      {tab === 4 && (
        <SectionCard title="Placement preferences">
          <Stack spacing={2.5}>
            <ChipInput name="preferredRoles" control={control} label="Preferred job roles" options={ROLE_OPTIONS} disabled={ro} />
            <Locked label="Placement status" value={<PlacementChip status={student.placementStatus} />} hint="Updated automatically from offers; you cannot change it" />
          </Stack>
        </SectionCard>
      )}
      <UploadDialog open={uploading} mode="student" onClose={() => setUploading(false)} onDone={syncResume} />
    </>
  );
}

export function StudentProfile() {
  const state = useAsync(() => studentApi.getProfile(), []);
  return <Async state={state}>{(s) => <ProfileEditor key={s.id} student={s} onSaved={state.reload} />}</Async>;
}
