import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import type { Company } from '@/types';
import { companiesApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { CompanyLogo, StatusChip, TierChip } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { ListHeader } from './parts/Header';
import { CompanyDialog } from './parts/CompanyDialog';

type Row = { company: Company; jobCount: number; activeJobs: number; offers: number };

export function FacultyCompanies({ embedded }: { embedded?: boolean }) {
  const base = useBase();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [industry, setIndustry] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ company?: Company } | null>(null);
  const [archived, setArchived] = useState<'include' | 'only' | ''>('');
  const [toggle, setToggle] = useState<Company>();
  const toast = useToast();
  const dq = useDebounced(q);
  const state = useAsync(() => companiesApi.list({ q: dq, industry: industry || undefined, tier: tier || undefined, archived: archived || undefined, page }), [dq, industry, tier, archived, page]);
  const manage = can('companies.manage');

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Company', render: (r) => (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CompanyLogo company={r.company} size={38} />
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center"><Typography variant="body2" fontWeight={600}>{r.company.name}</Typography>{r.company.archivedAt && <StatusChip label="Archived" />}</Stack>
          <Link href={r.company.website} target="_blank" rel="noopener noreferrer" variant="caption" onClick={(e) => e.stopPropagation()} underline="hover">{r.company.website.replace(/^https?:\/\//, '')}</Link>
        </Box>
      </Stack>
    ) },
    { key: 'industry', header: 'Industry', render: (r) => r.company.industry, hideBelow: 'sm' },
    { key: 'tier', header: 'Tier', render: (r) => <TierChip tier={r.company.tier} />, hideBelow: 'md' },
    { key: 'jobs', header: 'Jobs', render: (r) => `${r.activeJobs} active / ${r.jobCount}`, hideBelow: 'sm' },
    { key: 'offers', header: 'Offers', align: 'right', render: (r) => r.offers, hideBelow: 'md' },
    { key: 'contact', header: 'Contact', render: (r) => r.company.contactName, hideBelow: 'lg' },
    ...(manage ? [{ key: 'actions', header: <span style={{ position: 'absolute', left: -9999 }}>Actions</span>, align: 'right' as const, width: 70, render: (r: Row) => (
      <Stack direction="row" justifyContent="flex-end">
        {!r.company.archivedAt && <Button size="small" startIcon={<EditOutlinedIcon />} aria-label={`Edit ${r.company.name}`} onClick={(e) => { e.stopPropagation(); setDialog({ company: r.company }); }}>Edit</Button>}
        <Button size="small" color="inherit" aria-label={`${r.company.archivedAt ? 'Restore' : 'Archive'} ${r.company.name}`} onClick={(e) => { e.stopPropagation(); setToggle(r.company); }}>{r.company.archivedAt ? 'Restore' : 'Archive'}</Button>
      </Stack>
    ) }] : []),
  ];

  return (
    <>
      <ListHeader embedded={embedded} title="Companies" subtitle="One master record per company, with many jobs and drives."
        actions={manage ? <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setDialog({})}>Add company</Button> : undefined} />
      <FilterBar>
        <SearchField value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search companies or industries" />
        <FilterSelect label="Industry" value={industry} options={(state.data?.industries ?? []).map((i) => ({ value: i, label: i }))} onChange={(v) => { setIndustry(v); setPage(1); }} />
        <FilterSelect label="Archived" value={archived} allLabel="Hide archived" options={[{ value: 'include', label: 'Include archived' }, { value: 'only', label: 'Archived only' }]} onChange={(v) => { setArchived(v as typeof archived); setPage(1); }} minWidth={170} />
        <FilterSelect label="Tier" value={tier} options={[{ value: 'regular', label: 'Regular' }, { value: 'dream', label: 'Dream' }, { value: 'super_dream', label: 'Super Dream' }]} onChange={(v) => { setTier(v); setPage(1); }} minWidth={130} />
      </FilterBar>
      <DataTable caption="Companies" columns={columns} rows={state.data?.items} getId={(r) => r.company.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} total={state.data?.total} pageSize={state.data?.pageSize} onPageChange={setPage} onRowClick={(r) => navigate(`${base}/companies/${r.company.id}`)}
        emptyTitle="No companies found" emptyMessage="Try a different search or filter." emptyAction={manage ? <Button onClick={() => setDialog({})}>Add company</Button> : undefined} />
      <ConfirmDialog open={!!toggle} title={toggle?.archivedAt ? `Restore ${toggle.name}?` : `Archive ${toggle?.name}?`} confirmLabel={toggle?.archivedAt ? 'Restore' : 'Archive'} tone={toggle?.archivedAt ? 'primary' : 'warning'} onClose={() => setToggle(undefined)}
        onConfirm={async () => { await companiesApi.archive(toggle!.id, !toggle!.archivedAt); toast.success(`${toggle!.name} ${toggle!.archivedAt ? 'restored' : 'archived'}`); state.reload(); }}>
        {toggle?.archivedAt ? 'The company returns to the default lists and can be given new jobs again.' : 'The company is hidden from the default lists and cannot be given new jobs. Its jobs, applications and offers are kept. Companies with published jobs cannot be archived.'}
      </ConfirmDialog>
      <CompanyDialog open={!!dialog} company={dialog?.company} onClose={() => setDialog(null)} onSaved={() => state.reload()} />
    </>
  );
}
