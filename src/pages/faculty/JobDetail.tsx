import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, Button, Chip, Link, Stack, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { jobsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { Async, EmptyState } from '@/components/feedback';
import { FunnelCard } from '@/components/Charts';
import { DOC_TYPE_LABEL } from '@/components/DocumentUpload';
import { CompanyLogo, Grid, InterviewStatusChip, JobStatusChip, KeyValue, MetricCard, PageHeader, ProcessingChip, SectionCard, StatusChip } from '@/components/ui';
import { useDeptName } from '@/hooks/useDeptName';
import { deadlineText, fmtDate, fmtDateTime, fmtLpa, fmtStipend } from '@/utils/format';
import { ACTION_LABEL, JobActionDialog, actionsFor, canEditJob, type JobActionTarget } from './parts/JobActions';

export function FacultyJobDetail() {
  const deptName = useDeptName();
  const { jobId = '' } = useParams();
  const base = useBase();
  const { can } = useAuth();
  const state = useAsync(() => jobsApi.drive(jobId), [jobId]);
  const [target, setTarget] = useState<JobActionTarget>();

  return (
    <Async state={state}>
      {({ view, eligibleStudents, counts, interviews, documents }) => {
        const { job, company } = view;
        const r = job.eligibility;
        const sel = counts.selected + counts.offers;
        const funnel = [
          { stage: 'Eligible students', count: eligibleStudents },
          { stage: 'Applied', count: counts.applied },
          { stage: 'Shortlisted', count: counts.shortlisted + counts.interview + sel },
          { stage: 'Interview', count: counts.interview + sel },
          { stage: 'Selected', count: sel },
          { stage: 'Offers', count: counts.offers },
        ];
        return (
          <>
            <PageHeader title={job.title} crumbs={[{ label: 'Jobs & drives', to: `${base}/jobs` }, { label: job.title }]}
              subtitle={<Stack direction="row" spacing={1.25} alignItems="center" component="span"><CompanyLogo company={company} size={24} /><Link component={RouterLink} to={`${base}/companies/${company.id}`} underline="hover" color="inherit">{company.name}</Link><JobStatusChip status={job.status} />{job.archivedAt && <StatusChip label="Archived" />}</Stack>}
              actions={<>
                <Button component={RouterLink} to={`${base}/applications?jobId=${job.id}`} variant="outlined">View applicants</Button>
                {canEditJob(job, can) && <Button component={RouterLink} to={`${base}/jobs/${job.id}/edit`} variant="outlined" startIcon={<EditOutlinedIcon />}>Edit</Button>}
                {actionsFor(job, can).map((a) => <Button key={a} variant={a === 'cancel' ? 'outlined' : 'contained'} color={a === 'cancel' ? 'error' : 'secondary'} onClick={() => setTarget({ job, action: a })}>{ACTION_LABEL[a]}</Button>)}
              </>} />
            <Stack spacing={2.5}>
              <Grid cols={{ xs: 2, md: 5 }}>
                <MetricCard label="Eligible students" value={eligibleStudents} tone="success" />
                <MetricCard label="Applicants" value={counts.applied} />
                <MetricCard label="Shortlisted" value={counts.shortlisted} tone="purple" />
                <MetricCard label="Selected" value={sel} tone="success" />
                <MetricCard label="Offers" value={counts.offers} tone="warning" />
              </Grid>
              <Grid cols={{ xs: 1, lg: '3fr 2fr' }}>
                <Stack spacing={2.5}>
                  <SectionCard title="Overview">
                    <Typography variant="body2" sx={{ mb: 2 }}>{job.description}</Typography>
                    <Grid cols={{ xs: 2, md: 3 }}>
                      <KeyValue label="Location">{job.location}</KeyValue>
                      <KeyValue label="Type">{job.type}</KeyValue>
                      <KeyValue label="Domain">{job.domain}</KeyValue>
                      <KeyValue label="Compensation">{job.ctcLpa != null ? fmtLpa(job.ctcLpa) : fmtStipend(job.stipendPerMonth)}</KeyValue>
                      <KeyValue label="Applications open">{fmtDate(job.openDate)}</KeyValue>
                      <KeyValue label="Deadline">{fmtDate(job.deadline)}{job.status === 'published' ? ` · ${deadlineText(job.deadline)}` : ''}</KeyValue>
                      <KeyValue label="Drive date">{fmtDate(job.driveDate)}</KeyValue>
                    </Grid>
                    {job.responsibilities.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">Responsibilities</Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{job.responsibilities.map((x) => <li key={x}><Typography variant="body2">{x}</Typography></li>)}</Box>
                      </Box>
                    )}
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>{job.skills.map((s) => <Chip key={s} size="small" variant="outlined" label={s} />)}</Stack>
                  </SectionCard>
                  <SectionCard title="Schedule & hiring rounds">
                    <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                      {job.rounds.map((rd, i) => (
                        <Stack key={rd.id} component="li" direction="row" spacing={1.5} alignItems="center">
                          <Chip size="small" label={i + 1} />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight={600}>{rd.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{rd.mode}{rd.date ? ` · ${fmtDateTime(rd.date)}` : ' · date to be announced'}{rd.location ? ` · ${rd.location}` : ''}</Typography>
                          </Box>
                        </Stack>
                      ))}
                    </Stack>
                  </SectionCard>
                </Stack>
                <Stack spacing={2.5}>
                  <SectionCard title="Eligibility criteria">
                    <Stack spacing={1.5}>
                      <KeyValue label="Minimum CGPA">{r.minCgpa.toFixed(1)}</KeyValue>
                      <KeyValue label="Active arrears allowed">{r.maxActiveArrears}</KeyValue>
                      <KeyValue label="Arrear history allowed">{r.maxArrearHistory ?? 'No limit'}</KeyValue>
                      <KeyValue label="Departments">{r.departmentIds.map(deptName).join(', ')}</KeyValue>
                      <KeyValue label="Graduation years">{r.graduationYears.join(', ')}</KeyValue>
                    </Stack>
                  </SectionCard>
                  <FunnelCard title="Recruitment progress" subtitle="Students reaching each stage" stages={funnel} />
                </Stack>
              </Grid>
              <Grid cols={{ xs: 1, lg: 2 }}>
                <SectionCard title="Interviews" action={can('applications.review') ? <Button size="small" component={RouterLink} to={`${base}/interviews`}>Manage</Button> : undefined}>
                  {interviews.length === 0 ? <EmptyState title="No interviews scheduled" /> : (
                    <Stack spacing={1.25}>{interviews.map((i) => (
                      <Stack key={i.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600}>{i.round}</Typography><Typography variant="caption" color="text.secondary">{fmtDateTime(i.at)} · {i.applicationIds.length} candidate(s) · {i.location}</Typography></Box>
                        <InterviewStatusChip status={i.status} />
                      </Stack>
                    ))}</Stack>
                  )}
                </SectionCard>
                <SectionCard title="Documents" action={<Button size="small" component={RouterLink} to={`${base}/documents`}>Library</Button>}>
                  {documents.length === 0 ? <EmptyState title="No documents attached" message="Upload circulars or eligibility documents and link them to this company or job." /> : (
                    <Stack spacing={1.25}>{documents.map((d) => (
                      <Stack key={d.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{d.title}</Typography><Typography variant="caption" color="text.secondary">{DOC_TYPE_LABEL[d.type]} · v{d.version} · {fmtDate(d.uploadedAt)}</Typography></Box>
                        <ProcessingChip status={d.processing} />
                      </Stack>
                    ))}</Stack>
                  )}
                </SectionCard>
              </Grid>
            </Stack>
            <JobActionDialog target={target} onClose={() => setTarget(undefined)} onDone={state.reload} />
          </>
        );
      }}
    </Async>
  );
}
