import { Button, Stack } from '@mui/material';
import type { ApplicationStatus, OfferStatus } from '@/types';
import type { ReportFilters as RF } from '@/types/views';
import { reportsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { FilterSelect } from './FilterBar';

const APP_STATUSES: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected', 'offer_received', 'rejected', 'withdrawn'];
const OFFER_STATUSES: OfferStatus[] = ['pending', 'received', 'accepted', 'declined', 'withdrawn'];
const lbl = (s: string) => s.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

export function ReportFilterBar({ value, onChange }: { value: RF; onChange: (v: RF) => void }) {
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const o = opts.data;
  const set = (patch: Partial<RF>) => onChange({ ...value, ...patch });
  const jobs = (o?.jobs ?? []).filter((j) => !value.companyId || j.companyId === value.companyId);
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 2 }} role="search" aria-label="Report filters">
      <FilterSelect label="Batch" value={value.academicYear} options={o?.graduationYears ?? []} onChange={(v) => set({ academicYear: v || undefined })} minWidth={170} />
      <FilterSelect label="Department" value={value.dept} options={(o?.departments ?? []).map((d) => ({ value: d.value, label: d.label }))} onChange={(v) => set({ dept: v || undefined })} />
      <FilterSelect label="Company" value={value.companyId} options={o?.companies ?? []} onChange={(v) => set({ companyId: v || undefined, jobId: undefined })} />
      <FilterSelect label="Job role" value={value.jobId} options={jobs} onChange={(v) => set({ jobId: v || undefined })} minWidth={200} />
      <FilterSelect label="Application status" value={value.appStatus === 'all' ? '' : value.appStatus} options={APP_STATUSES.map((s) => ({ value: s, label: lbl(s) }))} onChange={(v) => set({ appStatus: (v || undefined) as ApplicationStatus | undefined })} minWidth={170} />
      <FilterSelect label="Offer status" value={value.offerStatus === 'all' ? '' : value.offerStatus} options={OFFER_STATUSES.map((s) => ({ value: s, label: lbl(s) }))} onChange={(v) => set({ offerStatus: (v || undefined) as OfferStatus | undefined })} />
      <Button onClick={() => onChange({})} disabled={!Object.values(value).some(Boolean)}>Clear filters</Button>
    </Stack>
  );
}
