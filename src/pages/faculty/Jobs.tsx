import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, IconButton, Link, Menu, MenuItem, Stack, Tab, Tabs, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { JobStatus } from '@/types';
import type { JobView } from '@/types/views';
import { jobsApi, reportsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { CompanyLogo, JobStatusChip, StatusChip } from '@/components/ui';
import { deadlineText, fmtDate } from '@/utils/format';
import { ListHeader } from './parts/Header';
import { ACTION_LABEL, JobActionDialog, actionsFor, canEditJob, type JobActionTarget } from './parts/JobActions';

const TABS: { value: JobStatus | 'all'; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }];

export function FacultyJobs({ embedded }: { embedded?: boolean }) {
  const base = useBase();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [archived, setArchived] = useState<'include' | 'only' | ''>('');
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState<{ el: HTMLElement; view: JobView } | null>(null);
  const [target, setTarget] = useState<JobActionTarget>();
  const dq = useDebounced(q);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const state = useAsync(() => jobsApi.list({ status, q: dq, companyId: companyId || undefined, archived: archived || undefined, page, pageSize: 10, sort: 'recent' }), [status, dq, companyId, archived, page]);

  const columns: Column<JobView>[] = [
    { key: 'job', header: 'Job', render: (v) => (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CompanyLogo company={v.company} size={36} />
        <Box sx={{ minWidth: 0 }}>
          <Link component={RouterLink} to={`${base}/jobs/${v.job.id}`} underline="hover" fontWeight={600} color="inherit" onClick={(e) => e.stopPropagation()}>{v.job.title}</Link>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{v.company.name} · {v.job.location}</Typography>
        </Box>
      </Stack>
    ) },
    { key: 'status', header: 'Status', render: (v) => <Stack direction="row" spacing={0.5}><JobStatusChip status={v.job.status} />{v.job.archivedAt && <StatusChip label="Archived" />}</Stack> },
    { key: 'applicants', header: 'Applicants', align: 'right', render: (v) => v.applicantCount ?? 0 },
    { key: 'deadline', header: 'Deadline', render: (v) => (<><Typography variant="body2">{fmtDate(v.job.deadline)}</Typography>{v.job.status === 'published' && <Typography variant="caption" color="text.secondary">{deadlineText(v.job.deadline)}</Typography>}</>), hideBelow: 'sm' },
    { key: 'drive', header: 'Drive date', render: (v) => fmtDate(v.job.driveDate), hideBelow: 'md' },
    { key: 'cgpa', header: 'Min CGPA', align: 'right', render: (v) => v.job.eligibility.minCgpa.toFixed(1), hideBelow: 'lg' },
    { key: 'actions', header: <span style={{ position: 'absolute', left: -9999 }}>Actions</span>, align: 'right', width: 56, render: (v) => (
      <IconButton size="small" aria-label={`Actions for ${v.job.title}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, view: v }); }}><MoreVertIcon fontSize="small" /></IconButton>
    ) },
  ];

  const mv = menu?.view;
  return (
    <>
      <ListHeader embedded={embedded} title="Jobs & hiring drives" subtitle="Create postings, configure eligibility and run each drive through its lifecycle."
        actions={<>
          <Button component={RouterLink} to={`${base}/drives`} variant="outlined">Drive calendar</Button>
          {can('jobs.create') && <Button component={RouterLink} to={`${base}/jobs/new`} variant="contained" color="secondary" startIcon={<AddIcon />}>New job</Button>}
        </>} />
      <Tabs value={status} onChange={(_, v) => { setStatus(v); setPage(1); }} variant="scrollable" scrollButtons="auto" aria-label="Filter jobs by status" sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      <FilterBar>
        <SearchField value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by title, company or skill" />
        <FilterSelect label="Company" value={companyId} options={opts.data?.companies ?? []} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <FilterSelect label="Archived" value={archived} allLabel="Hide archived" options={[{ value: 'include', label: 'Include archived' }, { value: 'only', label: 'Archived only' }]} onChange={(v) => { setArchived(v as typeof archived); setPage(1); }} minWidth={170} />
      </FilterBar>
      <DataTable caption="Jobs" columns={columns} rows={state.data?.items} getId={(v) => v.job.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} pageSize={state.data?.pageSize} total={state.data?.total} onPageChange={setPage} onRowClick={(v) => navigate(`${base}/jobs/${v.job.id}`)}
        emptyTitle="No jobs match" emptyMessage="Change the status tab or filters, or create a new job." />
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => navigate(`${base}/jobs/${mv!.job.id}`)}>View drive details</MenuItem>
        {mv && canEditJob(mv.job, can) && <MenuItem onClick={() => navigate(`${base}/jobs/${mv.job.id}/edit`)}>Edit job</MenuItem>}
        {mv && actionsFor(mv.job, can).map((a) => <MenuItem key={a} sx={a === 'cancel' ? { color: 'error.main' } : undefined} onClick={() => { setTarget({ job: mv.job, action: a }); setMenu(null); }}>{ACTION_LABEL[a]}</MenuItem>)}
      </Menu>
      <JobActionDialog target={target} onClose={() => setTarget(undefined)} onDone={state.reload} />
    </>
  );
}
