import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { ApplicationStatus } from '@/types';
import type { ApplicationView } from '@/types/views';
import { applicationsApi } from '@/api';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { ApplicationStatusChip, CompanyLogo, PageHeader } from '@/components/ui';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { fmtDate, timeAgo } from '@/utils/format';

const STATUSES: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected', 'offer_received', 'rejected', 'withdrawn'];
const PAGE_SIZE = 10;

export function StudentApplications() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const state = useAsync(() => applicationsApi.listMine({ q: dq || undefined, status: status || 'all', page, pageSize: PAGE_SIZE }), [dq, status, page]);

  const columns: Column<ApplicationView>[] = [
    { key: 'company', header: 'Company', render: (r) => <Stack direction="row" spacing={1.25} alignItems="center"><CompanyLogo company={r.company} size={32} /><Typography variant="body2" fontWeight={600}>{r.company.name}</Typography></Stack> },
    { key: 'job', header: 'Job title', render: (r) => r.job.title },
    { key: 'applied', header: 'Applied', hideBelow: 'md', render: (r) => fmtDate(r.application.appliedAt) },
    { key: 'status', header: 'Status', render: (r) => <ApplicationStatusChip status={r.application.status} /> },
    { key: 'next', header: 'Next step', hideBelow: 'lg', render: (r) => r.nextAction ?? <Typography variant="body2" color="text.secondary">—</Typography> },
    { key: 'updated', header: 'Last updated', hideBelow: 'md', render: (r) => timeAgo(r.application.updatedAt) },
    { key: 'view', header: '', align: 'right', render: (r) => <Button size="small" component={RouterLink} to={`/student/applications/${r.application.id}`} onClick={(e) => e.stopPropagation()}>View details</Button> },
  ];

  return (
    <>
      <PageHeader title="My Applications" subtitle="Track every application from submission to offer." actions={<Button variant="contained" color="secondary" component={RouterLink} to="/student/jobs">Browse jobs</Button>} />
      <FilterBar>
        <SearchField value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search company or job title" />
        <FilterSelect label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()) }))} onChange={(v) => { setStatus(v as ApplicationStatus | ''); setPage(1); }} />
      </FilterBar>
      <DataTable
        caption="My applications" columns={columns} rows={state.data?.items} getId={(r) => r.application.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} pageSize={PAGE_SIZE} total={state.data?.total} onPageChange={setPage} onRowClick={(r) => navigate(`/student/applications/${r.application.id}`)}
        emptyTitle={q || status ? 'No matching applications' : 'No applications yet'} emptyMessage={q || status ? 'Try a different search or status.' : 'Apply to an eligible job to start tracking it here.'}
        emptyAction={!q && !status ? <Button component={RouterLink} to="/student/jobs" variant="contained" color="secondary">Find jobs</Button> : <Box component="span" />}
      />
    </>
  );
}
