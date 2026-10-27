import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardActionArea, CardContent, LinearProgress, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { JobView } from '@/types/views';
import { jobsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { Async, CardGridSkeleton, EmptyState } from '@/components/feedback';
import { CompanyLogo, Grid, JobStatusChip, PageHeader, StatusChip } from '@/components/ui';
import { daysUntil, fmtDate, fmtDateTime } from '@/utils/format';

/** Phase of a drive derived from its dates; progress = how far through the application window it is. */
function phase(j: JobView['job']) {
  const now = Date.now();
  if (j.status === 'closed') return { label: 'Completed', tone: 'neutral' as const, pct: 100 };
  if (j.status === 'cancelled') return { label: 'Cancelled', tone: 'error' as const, pct: 0 };
  const open = +new Date(j.openDate), end = +new Date(j.deadline), drive = j.driveDate ? +new Date(j.driveDate) : end;
  if (now < end) return { label: 'Applications open', tone: 'info' as const, pct: Math.round(((now - open) / (end - open)) * 70) };
  if (now < drive) return { label: 'Applications closed · drive pending', tone: 'warning' as const, pct: 80 };
  return { label: 'Drive held · results pending', tone: 'purple' as const, pct: 92 };
}

export function FacultyDrives() {
  const base = useBase();
  const { can } = useAuth();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const state = useAsync(() => jobsApi.list({ status: 'all', pageSize: 100, sort: 'deadline' }), []);

  return (
    <>
      <PageHeader title="Hiring drives" subtitle="All drives by date, with their application window and applicant counts."
        actions={can('jobs.create') ? <Button component={RouterLink} to={`${base}/jobs/new`} variant="contained" color="secondary">New job</Button> : undefined} />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Drive timing" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="upcoming" label="Upcoming & open" /><Tab value="past" label="Past & closed" />
      </Tabs>
      <Async state={state} skeleton={<CardGridSkeleton count={6} />}>
        {(d) => {
          const drives = d.items.filter((v) => v.job.status !== 'draft');
          const upcoming = drives.filter((v) => v.job.status === 'published' && (!v.job.driveDate || new Date(v.job.driveDate) > new Date() || new Date(v.job.deadline) > new Date()))
            .sort((a, b) => +new Date(a.job.driveDate ?? a.job.deadline) - +new Date(b.job.driveDate ?? b.job.deadline));
          const upIds = new Set(upcoming.map((v) => v.job.id));
          const past = drives.filter((v) => !upIds.has(v.job.id)).sort((a, b) => +new Date(b.job.driveDate ?? b.job.deadline) - +new Date(a.job.driveDate ?? a.job.deadline));
          const list = tab === 'upcoming' ? upcoming : past;
          if (!list.length) return <Card><EmptyState title={tab === 'upcoming' ? 'No upcoming drives' : 'No past drives'} message="Published jobs with a drive date appear here." /></Card>;
          return (
            <Grid cols={{ xs: 1, md: 2, xl: 3 }}>
              {list.map((v) => {
                const p = phase(v.job);
                return (
                  <Card key={v.job.id} sx={{ height: '100%' }}>
                    <CardActionArea component={RouterLink} to={`${base}/jobs/${v.job.id}`} sx={{ height: '100%' }} aria-label={`${v.company.name} ${v.job.title} drive details`}>
                      <CardContent>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <CompanyLogo company={v.company} />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="caption" color="text.secondary">{v.company.name}</Typography>
                            <Typography variant="h5" component="h3">{v.job.title}</Typography>
                          </Box>
                          <JobStatusChip status={v.job.status} />
                        </Stack>
                        <Stack spacing={0.5} sx={{ mt: 2 }}>
                          <Typography variant="body2"><b>Drive:</b> {v.job.driveDate ? `${fmtDateTime(v.job.driveDate)}${tab === 'upcoming' && new Date(v.job.driveDate) > new Date() ? ` (in ${daysUntil(v.job.driveDate)}d)` : ''}` : 'Not scheduled'}</Typography>
                          <Typography variant="body2"><b>Apply by:</b> {fmtDate(v.job.deadline)}</Typography>
                          <Typography variant="body2"><b>Applicants:</b> {v.applicantCount ?? 0}</Typography>
                        </Stack>
                        <Box sx={{ mt: 2 }}>
                          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}><StatusChip label={p.label} tone={p.tone} /><Typography variant="caption" color="text.secondary">{p.pct}%</Typography></Stack>
                          <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, p.pct))} aria-label={`Drive progress ${p.pct}%`} sx={{ height: 6, borderRadius: 3 }} />
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                );
              })}
            </Grid>
          );
        }}
      </Async>
    </>
  );
}
