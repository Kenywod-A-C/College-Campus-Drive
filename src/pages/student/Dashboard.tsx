import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import { studentApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { ApplicationStatusChip, Grid, KeyValue, MetricCard, PageHeader, SectionCard, StatusChip } from '@/components/ui';
import { Async, EmptyState } from '@/components/feedback';
import { JobCard } from '@/components/JobCard';
import { useDeptName } from '@/hooks/useDeptName';
import { deadlineText, fmtDate, fmtDateTime, timeAgo } from '@/utils/format';

export function StudentDashboard() {
  const deptName = useDeptName();
  const { user } = useAuth();
  const state = useAsync(() => studentApi.dashboard(), []);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`} subtitle="Here is where your placement journey stands today."
        actions={<Button variant="contained" color="secondary" startIcon={<SmartToyOutlinedIcon />} component={RouterLink} to="/student/assistant">Ask the AI assistant</Button>}
      />
      <Async state={state}>
        {({ student: s, metrics: m, events, deadlines, recommended, activity }) => (
          <Stack spacing={2.5}>
            <Grid cols={{ xs: 1, md: 'minmax(0,1.2fr) minmax(0,2fr)' }} gap={2.5}>
              <SectionCard title="Profile completion" action={<Button size="small" component={RouterLink} to="/student/profile">{s.profileCompletion < 100 ? 'Complete profile' : 'View profile'}</Button>}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography variant="h1" component="p">{s.profileCompletion}%</Typography>
                  <Box sx={{ flex: 1 }}><LinearProgress variant="determinate" value={s.profileCompletion} sx={{ height: 10, borderRadius: 5 }} aria-label="Profile completion" /></Box>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{s.profileCompletion < 100 ? 'A complete profile makes sure eligibility is evaluated accurately.' : 'Your profile is complete.'}</Typography>
              </SectionCard>
              <SectionCard title="Academic summary">
                <Grid cols={{ xs: 2, sm: 4 }}>
                  <KeyValue label="CGPA">{s.academic.cgpa != null ? <>{s.academic.cgpa.toFixed(2)} <StatusChip label={s.academic.cgpaVerified ? 'Verified' : 'Unverified'} tone={s.academic.cgpaVerified ? 'success' : 'warning'} /></> : 'Not added'}</KeyValue>
                  <KeyValue label="Department">{deptName(s.departmentId)}</KeyValue>
                  <KeyValue label="Year">Year {s.currentYear} · {s.degree}</KeyValue>
                  <KeyValue label="Batch">{s.graduationYear}</KeyValue>
                </Grid>
              </SectionCard>
            </Grid>

            <Grid cols={{ xs: 1, sm: 2, lg: 4 }}>
              <MetricCard label="Eligible jobs" value={m.eligibleJobs} icon={<WorkOutlineIcon />} to="/student/jobs" hint="Open now" />
              <MetricCard label="Active applications" value={m.activeApplications} icon={<AssignmentOutlinedIcon />} tone="purple" to="/student/applications" />
              <MetricCard label="Upcoming events" value={m.upcoming} icon={<EventOutlinedIcon />} tone="warning" hint="Interviews & drives" />
              <MetricCard label="Offers received" value={m.offers} icon={<CardGiftcardOutlinedIcon />} tone="success" to="/student/offers" />
            </Grid>

            <Grid cols={{ xs: 1, lg: 2 }} gap={2.5}>
              <SectionCard title="Upcoming interviews & drives">
                {events.length === 0 ? <EmptyState title="Nothing scheduled" message="Interviews and drives for your active applications will appear here." /> : (
                  <Stack component="ul" spacing={1.75} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {events.map((e) => (
                      <Stack component="li" key={e.id} direction="row" spacing={1.5} alignItems="center">
                        <Box aria-hidden sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: e.kind === 'interview' ? '#fef3c7' : '#dbeafe', color: e.kind === 'interview' ? '#92400e' : '#1e40af', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{e.kind === 'interview' ? <MicNoneOutlinedIcon fontSize="small" /> : <BusinessOutlinedIcon fontSize="small" />}</Box>
                        <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600}>{e.title}</Typography><Typography variant="caption" color="text.secondary">{e.sub} · {fmtDateTime(e.at)}</Typography></Box>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </SectionCard>
              <SectionCard title="Upcoming deadlines" subtitle="Jobs you haven't applied to yet">
                {deadlines.length === 0 ? <EmptyState title="No open deadlines" /> : (
                  <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {deadlines.map((d) => (
                      <Stack component="li" key={d.job.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{d.company.name} — {d.job.title}</Typography><Typography variant="caption" color="text.secondary">Closes {fmtDate(d.job.deadline)}</Typography></Box>
                        <Button size="small" component={RouterLink} to={`/student/jobs/${d.job.id}`}>{deadlineText(d.job.deadline)}</Button>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </SectionCard>
            </Grid>

            <SectionCard title="Recommended for you" action={<Button size="small" component={RouterLink} to="/student/jobs">All jobs</Button>}>
              {recommended.length === 0 ? <EmptyState title="No recommendations yet" message="Add skills and complete your profile to get tailored job matches." /> : (
                <Grid cols={{ xs: 1, md: 2, xl: 3 }}>{recommended.map((v) => <JobCard key={v.job.id} view={v} base="/student" compact />)}</Grid>
              )}
            </SectionCard>

            <SectionCard title="Recent application activity">
              {activity.length === 0 ? <EmptyState title="No activity yet" /> : (
                <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {activity.map((a, i) => (
                    <Stack component="li" key={i} direction="row" spacing={1.5} alignItems="center">
                      <ApplicationStatusChip status={a.status} />
                      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" noWrap component={RouterLink} to={`/student/applications/${a.applicationId}`} sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{a.text}</Typography></Box>
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{timeAgo(a.at)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </SectionCard>
          </Stack>
        )}
      </Async>
    </>
  );
}
