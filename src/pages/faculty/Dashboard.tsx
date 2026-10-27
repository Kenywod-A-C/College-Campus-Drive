import { Link as RouterLink } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import { reportsApi, type DashboardFilters } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { Async, EmptyState } from '@/components/feedback';
import { FilterBar, FilterSelect } from '@/components/FilterBar';
import { BarChartCard, DonutCard } from '@/components/Charts';
import { APP_LABEL, ApplicationStatusChip, CompanyLogo, Grid, MetricCard, PageHeader, SectionCard, StatusChip } from '@/components/ui';
import { daysUntil, deadlineText, fmtDate, fmtDateTime, timeAgo } from '@/utils/format';

const DAYS = [{ value: 7, label: 'Last 7 days' }, { value: 30, label: 'Last 30 days' }, { value: 90, label: 'Last 90 days' }, { value: 365, label: 'Last 12 months' }];

function Row({ to, lead, title, sub, trailing }: { to?: string; lead?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode }) {
  const body = (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.1, minWidth: 0 }}>
      {lead}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>{title}</Typography>
        {sub && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{sub}</Typography>}
      </Box>
      {trailing}
    </Stack>
  );
  return (
    <Box component="li" sx={{ listStyle: 'none', borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
      {to ? <Link component={RouterLink} to={to} underline="none" color="inherit" sx={{ display: 'block', '&:hover': { bgcolor: 'rgba(37,99,235,.04)' } }}>{body}</Link> : body}
    </Box>
  );
}
const List = ({ children, empty }: { children: ReactNode[]; empty: string }) =>
  children.length ? <Box component="ul" sx={{ m: 0, p: 0 }}>{children}</Box> : <EmptyState title={empty} />;

export function FacultyDashboard() {
  const base = useBase();
  const [f, setF] = useState<DashboardFilters>({});
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const state = useAsync(() => reportsApi.facultyDashboard(f), [JSON.stringify(f)]);
  const set = (patch: DashboardFilters) => setF((x) => ({ ...x, ...patch }));

  return (
    <>
      <PageHeader title="Placement dashboard" subtitle="Operational overview of hiring drives, applicants and offers." actions={<Button component={RouterLink} to={`${base}/applications`} variant="outlined">Review applications</Button>} />
      <FilterBar trailing={<Button onClick={() => setF({})} disabled={!Object.values(f).some(Boolean)}>Clear filters</Button>}>
        <FilterSelect label="Department" value={f.dept} options={(opts.data?.departments ?? []).map((d) => ({ value: d.value, label: d.label }))} onChange={(v) => set({ dept: v || undefined })} />
        <FilterSelect label="Batch" value={f.graduationYear} options={(state.data?.graduationYears ?? []).map((y) => ({ value: y, label: `Batch ${y}` }))} onChange={(v) => set({ graduationYear: Number(v) || undefined })} />
        <FilterSelect label="Company" value={f.companyId} options={opts.data?.companies ?? []} onChange={(v) => set({ companyId: v || undefined })} />
        <FilterSelect label="Date range" value={f.days} options={DAYS} onChange={(v) => set({ days: Number(v) || undefined })} allLabel="All time" />
      </FilterBar>

      <Async state={state}>
        {(d) => (
          <Stack spacing={2.5} sx={{ opacity: state.loading ? 0.65 : 1, transition: 'opacity .15s' }}>
            <Grid cols={{ xs: 1, sm: 2, lg: 4 }}>
              <MetricCard label="Total companies" value={d.metrics.totalCompanies} icon={<BusinessOutlinedIcon />} to={`${base}/companies`} />
              <MetricCard label="Active jobs" value={d.metrics.activeJobs} icon={<WorkOutlineIcon />} to={`${base}/jobs`} tone="purple" />
              <MetricCard label="Total applications" value={d.metrics.totalApplications} icon={<AssignmentOutlinedIcon />} to={`${base}/applications`} />
              <MetricCard label="Eligible students" value={d.metrics.eligibleStudents} icon={<GroupsOutlinedIcon />} hint="Eligible for ≥1 open job" tone="success" to={`${base}/students`} />
              <MetricCard label="Shortlisted" value={d.metrics.shortlisted} icon={<StarBorderIcon />} tone="warning" />
              <MetricCard label="Selected" value={d.metrics.selected} icon={<TaskAltIcon />} tone="success" />
              <MetricCard label="Offers distributed" value={d.metrics.offers} icon={<HandshakeOutlinedIcon />} to={`${base}/offers`} tone="purple" />
            </Grid>

            <Grid cols={{ xs: 1, lg: '3fr 2fr' }}>
              <BarChartCard title="Department-wise placement" subtitle="Students with an accepted offer vs. the rest" data={d.deptChart} xKey="dept" stacked
                series={[{ key: 'placed', label: 'Placed' }, { key: 'notPlaced', label: 'Not yet placed' }]} />
              <DonutCard title="Application status" subtitle={`${d.metrics.totalApplications} applications`} data={d.statusDist} nameKey="status" valueKey="count" />
            </Grid>

            <Grid cols={{ xs: 1, lg: 2 }}>
              <SectionCard title="Upcoming hiring drives" action={<Button component={RouterLink} to={`${base}/drives`} size="small">All drives</Button>}>
                <List empty="No upcoming drives">{d.upcomingDrives.map((x) => (
                  <Row key={x.job.id} to={`${base}/jobs/${x.job.id}`} lead={<CompanyLogo company={x.company} size={36} />} title={`${x.company.name} — ${x.job.title}`} sub={`${fmtDate(x.job.driveDate)} · ${x.applicantCount} applicant(s)`} trailing={<StatusChip tone="info" label={`${daysUntil(x.job.driveDate!)}d`} />} />
                ))}</List>
              </SectionCard>
              <SectionCard title="Upcoming interviews" action={<Button component={RouterLink} to={`${base}/interviews`} size="small">Schedule</Button>}>
                <List empty="No interviews scheduled">{d.upcomingInterviews.map((x) => (
                  <Row key={x.interview.id} to={`${base}/interviews`} lead={<CompanyLogo company={x.company} size={36} />} title={`${x.interview.round} — ${x.company.name}`} sub={`${fmtDateTime(x.interview.at)} · ${x.interview.applicationIds.length} candidate(s)`} trailing={x.interview.notified ? <StatusChip tone="success" label="Notified" /> : <StatusChip tone="warning" label="Not notified" />} />
                ))}</List>
              </SectionCard>
              <SectionCard title="Jobs nearing deadline" subtitle="Closing within 5 days">
                <List empty="No deadlines in the next 5 days">{d.nearingDeadline.map((x) => (
                  <Row key={x.job.id} to={`${base}/jobs/${x.job.id}`} lead={<CompanyLogo company={x.company} size={36} />} title={`${x.company.name} — ${x.job.title}`} sub={`${x.applicantCount} applicant(s)`} trailing={<StatusChip tone="error" label={deadlineText(x.job.deadline)} />} />
                ))}</List>
              </SectionCard>
              <SectionCard title="Recent applications" action={<Button component={RouterLink} to={`${base}/applications`} size="small">View all</Button>}>
                <List empty="No applications for these filters">{d.recentApplications.map((x) => (
                  <Row key={x.application.id} lead={<CompanyLogo company={x.company} size={36} />} title={`${x.student?.name} · ${x.student?.studentCode}`} sub={`${x.job.title} at ${x.company.name} · ${timeAgo(x.application.appliedAt)}`} trailing={<ApplicationStatusChip status={x.application.status} />} />
                ))}</List>
              </SectionCard>
            </Grid>

            <SectionCard title="Recent placement activity">
              <List empty="No stage changes yet">{d.activity.map((a, i) => (
                <Row key={i} title={`${a.student} — ${APP_LABEL[a.status]}`} sub={`${a.job} · ${a.company}`} trailing={<Typography variant="caption" color="text.secondary">{timeAgo(a.at)}</Typography>} />
              ))}</List>
            </SectionCard>
          </Stack>
        )}
      </Async>
    </>
  );
}
