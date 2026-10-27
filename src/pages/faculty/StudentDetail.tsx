import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, Link, Stack, Typography } from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import type { ApplicationView, OfferView } from '@/types/views';
import { studentsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Async } from '@/components/feedback';
import { DataTable, type Column } from '@/components/DataTable';
import { useToast } from '@/components/Toast';
import { ApplicationStatusChip, Grid, KeyValue, OfferStatusChip, PageHeader, PlacementChip, SectionCard, StatusChip } from '@/components/ui';
import { useDeptName } from '@/hooks/useDeptName';
import { fmtDate, fmtLpa } from '@/utils/format';

export function FacultyStudentDetail() {
  const deptName = useDeptName();
  const { studentId = '' } = useParams();
  const base = useBase();
  const { can } = useAuth();
  const toast = useToast();
  const state = useAsync(() => studentsApi.get(studentId), [studentId]);
  const [verify, setVerify] = useState(false);

  const appCols: Column<ApplicationView>[] = [
    { key: 'job', header: 'Job', render: (a) => <Box><Link component={RouterLink} to={`${base}/jobs/${a.job.id}`} underline="hover" fontWeight={600}>{a.job.title}</Link><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{a.company.name}</Typography></Box> },
    { key: 'status', header: 'Stage', render: (a) => <ApplicationStatusChip status={a.application.status} /> },
    { key: 'applied', header: 'Applied', render: (a) => fmtDate(a.application.appliedAt), hideBelow: 'sm' },
    { key: 'next', header: 'Next step', render: (a) => a.nextAction ?? '—', hideBelow: 'md' },
  ];
  const offerCols: Column<OfferView>[] = [
    { key: 'co', header: 'Company', render: (o) => `${o.company.name} — ${o.job.title}` },
    { key: 'ctc', header: 'Package', render: (o) => fmtLpa(o.offer.ctcLpa) },
    { key: 'status', header: 'Status', render: (o) => <OfferStatusChip status={o.offer.status} /> },
    { key: 'by', header: 'Respond by', render: (o) => fmtDate(o.offer.acceptBy), hideBelow: 'sm' },
  ];

  return (
    <Async state={state}>
      {({ student: s, applications, offers }) => (
        <>
          <PageHeader title={s.name} subtitle={`${s.studentCode || 'No ID yet'} · ${deptName(s.departmentId)} · Batch ${s.graduationYear}`} crumbs={[{ label: 'Students', to: `${base}/students` }, { label: s.name }]}
            actions={<>
              <PlacementChip status={s.placementStatus} />
              {can('students.edit') && !s.academic.cgpaVerified && s.academic.cgpa != null && <Button variant="contained" color="secondary" startIcon={<VerifiedIcon />} onClick={() => setVerify(true)}>Verify CGPA</Button>}
            </>} />
          <Stack spacing={2.5}>
            {s.academic.cgpa == null && <Alert severity="warning">This student has not entered a CGPA, so eligibility cannot be evaluated (Profile incomplete).</Alert>}
            {s.academic.cgpa != null && !s.academic.cgpaVerified && <Alert severity="info">CGPA is self-reported and awaiting verification. Students stay in “Needs verification” until it is verified.</Alert>}
            <Grid cols={{ xs: 1, md: 2 }}>
              <SectionCard title="Profile">
                <Grid cols={{ xs: 1, sm: 2 }}>
                  <KeyValue label="Email">{s.email}</KeyValue>
                  <KeyValue label="Phone">{s.phone}</KeyValue>
                  <KeyValue label="Degree">{s.degree || '—'}</KeyValue>
                  <KeyValue label="Current year">Year {s.currentYear}</KeyValue>
                  <KeyValue label="Profile completion">{s.profileCompletion}%</KeyValue>
                  <KeyValue label="Resume">{s.resumeFile ?? 'Not uploaded'}</KeyValue>
                  <KeyValue label="Portfolio / GitHub">{s.portfolioUrl ? <Link href={s.portfolioUrl} target="_blank" rel="noopener noreferrer">{s.portfolioUrl.replace('https://', '')}</Link> : '—'}</KeyValue>
                </Grid>
              </SectionCard>
              <SectionCard title="Academics">
                <Grid cols={{ xs: 2, sm: 4 }}>
                  <KeyValue label="CGPA">{s.academic.cgpa?.toFixed(2) ?? 'Missing'}</KeyValue>
                  <KeyValue label="Verification"><StatusChip label={s.academic.cgpaVerified ? 'Verified' : 'Unverified'} tone={s.academic.cgpaVerified ? 'success' : 'warning'} /></KeyValue>
                  <KeyValue label="Active arrears">{s.academic.activeArrears}</KeyValue>
                  <KeyValue label="Arrear history">{s.academic.arrearHistory}</KeyValue>
                </Grid>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">Skills</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>{s.skills.length ? s.skills.map((k) => <Chip key={k} size="small" variant="outlined" label={k} />) : <Typography variant="body2">—</Typography>}</Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Interests &amp; preferred roles</Typography>
                  <Typography variant="body2">{[...s.interests, ...s.preferredRoles].join(', ') || '—'}</Typography>
                </Box>
              </SectionCard>
            </Grid>
            <Box>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Applications ({applications.length})</Typography>
              <DataTable caption="Applications" columns={appCols} rows={applications} getId={(a) => a.application.id} emptyTitle="No applications yet" />
            </Box>
            <Box>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Offers ({offers.length})</Typography>
              <DataTable caption="Offers" columns={offerCols} rows={offers} getId={(o) => o.offer.id} emptyTitle="No offers yet" />
            </Box>
          </Stack>
          <ConfirmDialog open={verify} title="Verify CGPA" confirmLabel="Verify" onClose={() => setVerify(false)} onConfirm={async () => { await studentsApi.verifyCgpa(s.id); toast.success('CGPA verified'); state.reload(); }}>
            Confirm that <b>{s.name}</b>&apos;s CGPA of <b>{s.academic.cgpa?.toFixed(2)}</b> matches the official academic record. This is recorded in the audit log.
          </ConfirmDialog>
        </>
      )}
    </Async>
  );
}
