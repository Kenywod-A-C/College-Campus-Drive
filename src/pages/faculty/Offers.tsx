import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { OfferStatus } from '@/types';
import type { ApplicationView, OfferView } from '@/types/views';
import { offersApi, reportsApi, type OfferList } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Async } from '@/components/feedback';
import { BarChartCard } from '@/components/Charts';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { useToast } from '@/components/Toast';
import { Grid, MetricCard, OfferStatusChip, PageHeader, SectionCard } from '@/components/ui';
import { toDateInput, fmtDate, fmtLpa } from '@/utils/format';

const STATUSES: OfferStatus[] = ['pending', 'received', 'accepted', 'declined', 'withdrawn'];
const NEXT: Record<OfferStatus, OfferStatus[]> = { pending: ['received', 'withdrawn'], received: ['accepted', 'declined', 'withdrawn'], accepted: ['withdrawn'], declined: [], withdrawn: [] };
const lbl = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const PAGE = 10;

export function FacultyOffers() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('offers.manage');
  const [tab, setTab] = useState<'offers' | 'awaiting' | 'summary'>('offers');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState<{ el: HTMLElement; row: OfferView } | null>(null);
  const [change, setChange] = useState<{ row: OfferView; status: OfferStatus }>();
  const [create, setCreate] = useState<ApplicationView>();
  const dq = useDebounced(q);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const state = useAsync(() => offersApi.listAll({ q: dq, status: (status || 'all') as OfferStatus | 'all', dept: dept || undefined, companyId: companyId || undefined, page, pageSize: PAGE }), [dq, status, dept, companyId, page]);
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };

  const cols: Column<OfferView>[] = [
    { key: 's', header: 'Student', render: (o) => <Box><Typography variant="body2" fontWeight={600}>{o.student!.name}</Typography><Typography variant="caption" color="text.secondary">{o.student!.studentCode}</Typography></Box> },
    { key: 'c', header: 'Company & job', render: (o) => <Box><Typography variant="body2">{o.job.title}</Typography><Typography variant="caption" color="text.secondary">{o.company.name}</Typography></Box> },
    { key: 'p', header: 'Package', render: (o) => fmtLpa(o.offer.ctcLpa) },
    { key: 'd', header: 'Offer date', render: (o) => fmtDate(o.offer.offeredAt), hideBelow: 'md' },
    { key: 'a', header: 'Accept by', render: (o) => fmtDate(o.offer.acceptBy), hideBelow: 'md' },
    { key: 'pol', header: 'Policy', hideBelow: 'sm', render: (o) => {
      const failed = o.offer.policyChecks.filter((c) => !c.passed);
      return (
        <Tooltip title={o.offer.policyChecks.map((c) => `${c.passed ? '✓' : '✗'} ${c.label}: ${c.detail}`).join('\n')} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
          <Stack direction="row" spacing={0.5} alignItems="center" tabIndex={0} aria-label={failed.length ? `${failed.length} policy check(s) failed` : 'All policy checks passed'}>
            {failed.length ? <WarningAmberIcon fontSize="small" color="warning" /> : <CheckCircleIcon fontSize="small" color="success" />}
            <Typography variant="caption">{o.offer.policyChecks.length - failed.length}/{o.offer.policyChecks.length}</Typography>
          </Stack>
        </Tooltip>
      );
    } },
    { key: 'st', header: 'Status', render: (o) => <OfferStatusChip status={o.offer.status} /> },
    ...(manage ? [{ key: 'act', header: <span style={{ position: 'absolute', left: -9999 }}>Actions</span>, width: 56, align: 'right' as const, render: (o: OfferView) => (
      <IconButton size="small" disabled={!NEXT[o.offer.status].length} aria-label={`Update offer status for ${o.student!.name}`} aria-haspopup="menu" onClick={(e) => setMenu({ el: e.currentTarget, row: o })}><MoreVertIcon fontSize="small" /></IconButton>
    ) }] : []),
  ];
  const awaitCols: Column<ApplicationView>[] = [
    { key: 's', header: 'Student', render: (a) => <Box><Typography variant="body2" fontWeight={600}>{a.student!.name}</Typography><Typography variant="caption" color="text.secondary">{a.student!.studentCode}</Typography></Box> },
    { key: 'c', header: 'Company & job', render: (a) => `${a.company.name} — ${a.job.title}` },
    { key: 'p', header: 'Advertised package', render: (a) => fmtLpa(a.job.ctcLpa), hideBelow: 'sm' },
    { key: 'u', header: 'Selected on', render: (a) => fmtDate(a.application.updatedAt), hideBelow: 'md' },
    ...(manage ? [{ key: 'act', header: '', align: 'right' as const, render: (a: ApplicationView) => <Button size="small" variant="contained" color="secondary" onClick={() => setCreate(a)}>Create offer</Button> }] : []),
  ];

  return (
    <>
      <PageHeader title="Offers & placements" subtitle="Applications, selections and official offers are separate records. Offers are issued here, after selection." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" aria-label="Offer views" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="offers" label="Offer records" /><Tab value="awaiting" label={`Selected, awaiting offer${state.data ? ` (${state.data.selectedWithoutOffer.length})` : ''}`} /><Tab value="summary" label="Summaries" />
      </Tabs>
      <Async state={state}>
        {(d) => (
          <>
            {tab === 'offers' && (
              <>
                <FilterBar>
                  <SearchField value={q} onChange={reset(setQ)} placeholder="Search student, ID or company" />
                  <FilterSelect label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: lbl(s) }))} onChange={reset(setStatus)} />
                  <FilterSelect label="Department" value={dept} options={(opts.data?.departments ?? []).map((x) => ({ value: x.value, label: x.label }))} onChange={reset(setDept)} />
                  <FilterSelect label="Company" value={companyId} options={opts.data?.companies ?? []} onChange={reset(setCompanyId)} />
                </FilterBar>
                <DataTable caption="Offers" columns={cols} rows={d.rows} getId={(o) => o.offer.id} loading={state.loading} error={state.error} onRetry={state.reload} page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={setPage} emptyTitle="No offers match" />
              </>
            )}
            {tab === 'awaiting' && (
              <Stack spacing={1.5}>
                <Alert severity="info">These candidates are <b>selected</b> but have no official offer yet. Creating an offer runs the placement-policy checks and records the result.</Alert>
                <DataTable caption="Selected candidates awaiting an offer" columns={awaitCols} rows={d.selectedWithoutOffer} getId={(a) => a.application.id} emptyTitle="Nobody is waiting for an offer" />
              </Stack>
            )}
            {tab === 'summary' && <Summary d={d} />}
          </>
        )}
      </Async>

      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu && NEXT[menu.row.offer.status].map((s) => <MenuItem key={s} sx={s === 'withdrawn' ? { color: 'error.main' } : undefined} onClick={() => { setChange({ row: menu.row, status: s }); setMenu(null); }}>Mark {s}</MenuItem>)}
      </Menu>
      <ConfirmDialog open={!!change} title={change ? `Mark offer as ${change.status}?` : ''} tone={change?.status === 'withdrawn' ? 'error' : 'primary'} requireReason={change?.status === 'withdrawn'} reasonLabel="Reason for withdrawal"
        onClose={() => setChange(undefined)} onConfirm={async (reason) => { await offersApi.setStatus(change!.row.offer.id, change!.status, reason); toast.success(`Offer ${change!.status}`); state.reload(); }}>
        <Typography variant="body2">{change?.row.student?.name} · {change?.row.company.name}. {change?.status === 'accepted' ? 'Accepted-offer policy checks are re-run before this is saved.' : 'The student is notified.'}</Typography>
      </ConfirmDialog>
      <CreateOfferDialog app={create} onClose={() => setCreate(undefined)} onCreated={state.reload} />
    </>
  );
}

function Summary({ d }: { d: Pick<OfferList, 'byDept' | 'byCompany' | 'totals'> }) {
  const { offers: total, accepted, placed } = d.totals; // college-wide, from the server (not just the visible page)
  return (
    <Stack spacing={2.5}>
      <Grid cols={{ xs: 1, sm: 3 }}>
        <MetricCard label="Unique students placed" value={placed} hint="Students with ≥1 accepted offer" tone="success" />
        <MetricCard label="Total offers" value={total} hint="All offer records, any status" />
        <MetricCard label="Accepted offers" value={accepted} hint="A student can hold more than one" tone="purple" />
      </Grid>
      <Grid cols={{ xs: 1, lg: 2 }}>
        <BarChartCard title="Department-wise" subtitle="Offers vs. unique students placed" data={d.byDept} xKey="dept" series={[{ key: 'offers', label: 'Offers' }, { key: 'placed', label: 'Students placed' }]} />
        <BarChartCard title="Company-wise" subtitle="Offers made vs. accepted" data={d.byCompany} xKey="company" series={[{ key: 'offers', label: 'Offers' }, { key: 'accepted', label: 'Accepted' }]} layout="vertical" />
      </Grid>
      <SectionCard title="Department summary" noPad>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { p: 1.5, textAlign: 'left', borderTop: 1, borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12 } }}>
          <thead><tr><th>Department</th><th>Students</th><th>Offers</th><th>Placed (unique)</th><th>Placement %</th></tr></thead>
          <tbody>{d.byDept.map((x) => <tr key={x.dept}><td>{x.dept}</td><td>{x.students}</td><td>{x.offers}</td><td>{x.placed}</td><td>{x.students ? Math.round((x.placed / x.students) * 1000) / 10 : 0}%</td></tr>)}</tbody>
        </Box>
      </SectionCard>
    </Stack>
  );
}

function CreateOfferDialog({ app, onClose, onCreated }: { app?: ApplicationView; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [ctc, setCtc] = useState<string | null>(null); // null = untouched: show the advertised package; '' = the user cleared the box
  const [by, setBy] = useState(toDateInput(new Date(Date.now() + 14 * 86400000).toISOString()));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OfferView>();
  const value = ctc ?? String(app?.job.ctcLpa ?? '');
  const close = () => { setCtc(null); setError(undefined); setResult(undefined); onClose(); };
  const submit = async () => {
    setBusy(true); setError(undefined);
    try { const r = await offersApi.create(app!.application.id, Number(value), new Date(`${by}T23:59:00`).toISOString()); setResult(r); toast.success('Offer created'); onCreated(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create offer'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!app} onClose={busy ? undefined : close} fullWidth maxWidth="sm" aria-labelledby="co-title">
      <DialogTitle id="co-title">{result ? 'Offer created' : 'Create official offer'}<Typography variant="body2" color="text.secondary">{app?.student?.name} · {app?.company.name} — {app?.job.title}</Typography></DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={1.25}>
            <Typography variant="subtitle2">Placement policy checks</Typography>
            {result.offer.policyChecks.length === 0 && <Typography variant="body2" color="text.secondary">No policies apply.</Typography>}
            {result.offer.policyChecks.map((c) => <Alert key={c.label} severity={c.passed ? 'success' : 'warning'} sx={{ py: 0 }}><b>{c.label}:</b> {c.detail}</Alert>)}
            <Typography variant="caption" color="text.secondary">Failed checks are recorded on the offer. The accepted-offer limit is enforced again if the student accepts.</Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Package (LPA)" type="number" value={value} onChange={(e) => setCtc(e.target.value)} slotProps={{ htmlInput: { min: 0, step: 'any' } }} error={value !== '' && !(Number(value) > 0)} helperText="Defaults to the advertised package" />
            <TextField label="Acceptance deadline" type="date" value={by} onChange={(e) => setBy(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {result ? <Button variant="contained" onClick={close}>Done</Button> : <>
          <Button color="inherit" onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="contained" color="secondary" disabled={busy || !(Number(value) > 0) || !by} onClick={submit}>{busy ? 'Creating…' : 'Create offer'}</Button>
        </>}
      </DialogActions>
    </Dialog>
  );
}
