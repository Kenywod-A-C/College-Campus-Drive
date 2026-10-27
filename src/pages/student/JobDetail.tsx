import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import { jobsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { ApplicationStatusChip, CompanyLogo, Grid, JobStatusChip, KeyValue, PageHeader, SectionCard, TierChip } from '@/components/ui';
import { Async } from '@/components/feedback';
import { EligibilityReasons } from '@/components/Eligibility';
import { useToast } from '@/components/Toast';
import { useDeptName } from '@/hooks/useDeptName';
import { deadlineText, fmtDate, fmtLpa, fmtStipend } from '@/utils/format';
import { ApplyDialog } from './parts/ApplyDialog';
import { Link as RouterLink } from 'react-router-dom';

export function StudentJobDetail() {
  const deptName = useDeptName();
  const { jobId = '' } = useParams();
  const toast = useToast();
  const state = useAsync(() => jobsApi.get(jobId), [jobId]);
  const [applying, setApplying] = useState(false);

  const toggleSave = async () => {
    try { const r = await jobsApi.toggleSave(jobId); toast.success(r.saved ? 'Job saved' : 'Removed from saved'); state.reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update saved jobs'); }
  };

  return (
    <Async state={state}>
      {(v) => {
        const { job, company, eligibility: el } = v;
        const open = job.status === 'published' && new Date(job.deadline) > new Date();
        const canApply = el?.state === 'eligible' && open && !v.applicationId;
        const r = job.eligibility;
        return (
          <>
            <PageHeader
              title={job.title}
              crumbs={[{ label: 'Jobs & Opportunities', to: '/student/jobs' }, { label: `${company.name} — ${job.title}` }]}
              subtitle={<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><CompanyLogo company={company} size={24} /><span>{company.name}</span><TierChip tier={company.tier} /><JobStatusChip status={job.status} /></Stack>}
              actions={<>
                <Button startIcon={v.saved ? <BookmarkIcon /> : <BookmarkBorderIcon />} onClick={toggleSave} color="inherit" aria-pressed={!!v.saved}>{v.saved ? 'Saved' : 'Save'}</Button>
                <Button variant="contained" color="secondary" disabled={!canApply} onClick={() => setApplying(true)}>{v.applicationId ? 'Applied' : !open ? 'Applications closed' : 'Apply now'}</Button>
              </>}
            />
            <Grid cols={{ xs: 1, lg: 'minmax(0,2fr) minmax(0,1fr)' }} gap={2.5}>
              <Stack spacing={2.5}>
                <SectionCard title="About the role">
                  <Typography variant="body2" sx={{ mb: 2 }}>{job.description}</Typography>
                  <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Responsibilities</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{job.responsibilities.map((x) => <li key={x}><Typography variant="body2">{x}</Typography></li>)}</Box>
                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.75 }}>Required skills</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>{job.skills.length ? job.skills.map((s) => <Chip key={s} size="small" variant="outlined" label={s} />) : <Typography variant="body2" color="text.secondary">No specific skills listed.</Typography>}</Stack>
                </SectionCard>
                <SectionCard title="Eligibility requirements">
                  <Grid cols={{ xs: 1, sm: 2 }}>
                    <KeyValue label="Minimum CGPA">{r.minCgpa.toFixed(1)}</KeyValue>
                    <KeyValue label="Active arrears">{r.maxActiveArrears === 0 ? 'None allowed' : `Up to ${r.maxActiveArrears}`}</KeyValue>
                    <KeyValue label="Arrear history">{r.maxArrearHistory == null ? 'No restriction' : `Up to ${r.maxArrearHistory} cleared`}</KeyValue>
                    <KeyValue label="Graduation batch">{r.graduationYears.join(', ')}</KeyValue>
                    <Box sx={{ gridColumn: { sm: '1 / -1' } }}><KeyValue label="Eligible departments">{r.departmentIds.map(deptName).join(', ')}</KeyValue></Box>
                  </Grid>
                </SectionCard>
                <SectionCard title="Hiring rounds">
                  <Stack component="ol" spacing={1.25} sx={{ m: 0, pl: 2.5 }}>
                    {job.rounds.map((rd) => <li key={rd.id}><Typography variant="body2"><b>{rd.name}</b> · {rd.mode}{rd.date ? ` · ${fmtDate(rd.date)}` : ''}{rd.location ? ` · ${rd.location}` : ''}</Typography></li>)}
                  </Stack>
                </SectionCard>
              </Stack>

              <Stack spacing={2.5}>
                <SectionCard title="Your eligibility">
                  {el ? <EligibilityReasons result={el} /> : <Typography variant="body2" color="text.secondary">Not available.</Typography>}
                  {v.applicationId && (
                    <>
                      <Divider sx={{ my: 2 }} />
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2">Application:</Typography>{v.applicationStatus && <ApplicationStatusChip status={v.applicationStatus} />}</Stack>
                        <Button size="small" component={RouterLink} to={`/student/applications/${v.applicationId}`}>View</Button>
                      </Stack>
                    </>
                  )}
                  {!open && !v.applicationId && <Alert severity="warning" sx={{ mt: 2 }}>This job is {job.status === 'published' ? 'past its deadline' : job.status} and is not accepting applications.</Alert>}
                </SectionCard>
                <SectionCard title="Key details">
                  <Stack spacing={1.75}>
                    <KeyValue label="Compensation">{job.ctcLpa != null ? fmtLpa(job.ctcLpa) : fmtStipend(job.stipendPerMonth)}</KeyValue>
                    <KeyValue label="Location & type">{job.location} · {job.type}</KeyValue>
                    <KeyValue label="Application deadline">{fmtDate(job.deadline)} · {deadlineText(job.deadline)}</KeyValue>
                    <KeyValue label="Hiring drive">{fmtDate(job.driveDate)}</KeyValue>
                    <KeyValue label="Domain">{job.domain}</KeyValue>
                  </Stack>
                </SectionCard>
              </Stack>
            </Grid>
            <ApplyDialog view={applying ? v : null} onClose={() => setApplying(false)} onApplied={() => { setApplying(false); state.reload(); }} />
          </>
        );
      }}
    </Async>
  );
}
