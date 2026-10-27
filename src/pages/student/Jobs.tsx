import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Pagination, Stack, Tab, Tabs, TextField } from '@mui/material';
import type { JobQuery, JobView } from '@/types/views';
import { jobsApi, reportsApi } from '@/api';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { PageHeader, Grid } from '@/components/ui';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { JobCard } from '@/components/JobCard';
import { Async, CardGridSkeleton, EmptyState } from '@/components/feedback';
import { useToast } from '@/components/Toast';
import { ApplyDialog } from './parts/ApplyDialog';

const TABS: { value: NonNullable<JobQuery['tab']>; label: string }[] = [
  { value: 'all', label: 'All jobs' }, { value: 'eligible', label: 'Eligible' }, { value: 'not_eligible', label: 'Not eligible' }, { value: 'saved', label: 'Saved' }, { value: 'applied', label: 'Applied' },
];
const PAGE_SIZE = 9;

export function StudentJobs() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [f, setF] = useState<Omit<JobQuery, 'q'>>({ tab: 'all', sort: 'deadline', page: 1 });
  const [location, setLocation] = useState('');
  const [applying, setApplying] = useState<JobView | null>(null);
  const dq = useDebounced(q);
  const dloc = useDebounced(location);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const patch = (p: Partial<typeof f>) => setF((x) => ({ ...x, page: 1, ...p }));
  const setQ = (v: string) => { setParams(v ? { q: v } : {}, { replace: true }); setF((x) => ({ ...x, page: 1 })); };

  const state = useAsync(() => jobsApi.list({ ...f, q: dq || undefined, location: dloc || undefined, pageSize: PAGE_SIZE }), [dq, dloc, f.tab, f.sort, f.dept, f.minCgpa, f.type, f.deadlineDays, f.page]);

  const toggleSave = async (v: JobView) => {
    try { const r = await jobsApi.toggleSave(v.job.id); toast.success(r.saved ? 'Job saved' : 'Removed from saved'); state.reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update saved jobs'); }
  };
  const clear = () => { setQ(''); setLocation(''); setF((x) => ({ tab: x.tab, sort: x.sort, page: 1 })); };
  const filtered = !!(q || location || f.dept || f.minCgpa || f.type || f.deadlineDays);

  return (
    <>
      <PageHeader title="Jobs & Opportunities" subtitle="Published hiring drives. Eligibility is calculated from your profile by the placement system." />
      <Tabs value={f.tab} onChange={(_, v) => patch({ tab: v })} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} aria-label="Job lists">
        {TABS.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      <FilterBar>
        <SearchField value={q} onChange={setQ} placeholder="Search company, title, skill or domain" width={320} />
        <FilterSelect label="Department" value={f.dept} options={(opts.data?.departments ?? []).map((d) => ({ value: d.value, label: d.label }))} onChange={(v) => patch({ dept: v || undefined })} />
        <FilterSelect label="CGPA required up to" value={f.minCgpa} options={[6, 6.5, 7, 7.5, 8, 8.5, 9].map((n) => ({ value: n, label: n.toFixed(1) }))} onChange={(v) => patch({ minCgpa: v ? Number(v) : undefined })} minWidth={170} />
        <TextField label="Location" value={location} onChange={(e) => { setLocation(e.target.value); setF((x) => ({ ...x, page: 1 })); }} sx={{ width: { xs: '100%', sm: 150 } }} />
        <FilterSelect label="Job type" value={f.type} options={['Full-time', 'Internship', 'Internship + PPO'].map((t) => ({ value: t, label: t }))} onChange={(v) => patch({ type: v || undefined })} />
        <FilterSelect label="Deadline" value={f.deadlineDays} options={[{ value: 3, label: 'Within 3 days' }, { value: 7, label: 'Within 7 days' }, { value: 14, label: 'Within 14 days' }]} onChange={(v) => patch({ deadlineDays: v ? Number(v) : undefined })} />
        <FilterSelect label="Sort by" value={f.sort} allLabel="Deadline" options={[{ value: 'deadline', label: 'Deadline (soonest)' }, { value: 'relevance', label: 'Relevance' }, { value: 'recent', label: 'Recently published' }]} onChange={(v) => patch({ sort: (v || 'deadline') as JobQuery['sort'] })} />
      </FilterBar>

      <Async state={state} skeleton={<CardGridSkeleton />}>
        {(page) => page.items.length === 0 ? (
          <EmptyState title="No jobs found" message={filtered ? 'Try removing some filters or searching for something else.' : f.tab === 'saved' ? 'Save jobs with the bookmark icon to find them here.' : f.tab === 'applied' ? "You haven't applied to any jobs yet." : 'There are no jobs in this list right now.'} action={filtered ? <Box component="button" onClick={clear} sx={{ all: 'unset', cursor: 'pointer', color: 'secondary.main', fontWeight: 600 }}>Clear filters</Box> : undefined} />
        ) : (
          <Stack spacing={2.5} sx={{ opacity: state.loading ? 0.6 : 1 }} aria-busy={state.loading}>
            <Grid cols={{ xs: 1, md: 2, xl: 3 }}>
              {page.items.map((v) => <JobCard key={v.job.id} view={v} base="/student" onApply={setApplying} onSave={toggleSave} />)}
            </Grid>
            {page.total > PAGE_SIZE && (
              <Stack alignItems="center"><Pagination count={Math.ceil(page.total / PAGE_SIZE)} page={f.page ?? 1} onChange={(_, p) => setF((x) => ({ ...x, page: p }))} shape="rounded" color="primary" /></Stack>
            )}
          </Stack>
        )}
      </Async>
      <ApplyDialog view={applying} onClose={() => setApplying(null)} onApplied={() => { setApplying(null); state.reload(); }} />
    </>
  );
}
