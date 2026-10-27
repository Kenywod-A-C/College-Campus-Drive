import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import type { ApplicationStatus } from '@/types';
import type { ApplicationView } from '@/types/views';
import { applicationsApi, reportsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { EligibilityReasons } from '@/components/Eligibility';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { useToast } from '@/components/Toast';
import { APP_LABEL, ApplicationStatusChip, EligibilityBadge, PageHeader } from '@/components/ui';
import { useDeptName } from '@/hooks/useDeptName';
import { downloadText, fmtDate } from '@/utils/format';

const STATUSES: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected', 'offer_received', 'rejected', 'withdrawn'];
const ELIG = [{ value: 'eligible', label: 'Eligible' }, { value: 'not_eligible', label: 'Not eligible' }, { value: 'profile_incomplete', label: 'Profile incomplete' }, { value: 'needs_verification', label: 'Needs verification' }];
const BULK: { status: ApplicationStatus; label: string; tone?: 'error' }[] = [
  { status: 'shortlisted', label: 'Shortlist' }, { status: 'interview', label: 'Move to interview' }, { status: 'selected', label: 'Mark selected' }, { status: 'rejected', label: 'Reject', tone: 'error' },
];

interface Pending { status: ApplicationStatus; ids: string[] }
interface Outcome { status: ApplicationStatus; updated: number; failed: { id: string; reason: string }[] }

export function FacultyApplications() {
  const deptName = useDeptName();
  const [params] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const review = can('applications.review');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [jobId, setJobId] = useState(params.get('jobId') ?? '');
  const [dept, setDept] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [sort, setSort] = useState<'recent' | 'cgpa' | 'name'>('recent');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [exception, setException] = useState<{ status: ApplicationStatus; ids: string[] }>();
  const [reasons, setReasons] = useState<ApplicationView>();
  const dq = useDebounced(q);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const filter = { q: dq, status: (status || 'all') as ApplicationStatus | 'all', companyId: companyId || undefined, jobId: jobId || undefined, dept: dept || undefined, eligibility: eligibility || undefined, sort };
  const state = useAsync(() => applicationsApi.listAll({ ...filter, page }), [JSON.stringify(filter), page]);
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
  const jobOptions = (opts.data?.jobs ?? []).filter((j) => !companyId || j.companyId === companyId);

  const run = async (p: Pending, exc?: { reason: string; approvedBy: string }) => {
    const r = await applicationsApi.updateStage(p.ids, p.status, undefined, exc);
    setSelected((s) => s.filter((id) => !r.updated.includes(id)));
    state.reload();
    if (r.failed.length) setOutcome({ status: p.status, updated: r.updated.length, failed: r.failed });
    else toast.success(`${r.updated.length} application(s) moved to ${APP_LABEL[p.status]}`);
  };
  const exportCsv = async () => {
    try { downloadText('applications.csv', await applicationsApi.exportCsv({ status: filter.status, companyId: filter.companyId, dept: filter.dept })); toast.success('Export downloaded'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
  };

  const columns: Column<ApplicationView>[] = [
    { key: 'student', header: 'Student', render: (a) => <Box><Typography variant="body2" fontWeight={600}>{a.student!.name}</Typography><Typography variant="caption" color="text.secondary">{a.student!.studentCode}</Typography></Box> },
    { key: 'job', header: 'Company & job', render: (a) => <Box><Typography variant="body2">{a.job.title}</Typography><Typography variant="caption" color="text.secondary">{a.company.name}</Typography></Box> },
    { key: 'dept', header: 'Dept', render: (a) => deptName(a.student!.departmentId), hideBelow: 'md' },
    { key: 'cgpa', header: 'CGPA', align: 'right', render: (a) => a.student!.academic.cgpa?.toFixed(2) ?? '—', hideBelow: 'sm' },
    { key: 'elig', header: 'Eligibility', render: (a) => (
      <ButtonBase onClick={() => setReasons(a)} aria-label={`Review eligibility reasons for ${a.student!.name}`} sx={{ borderRadius: 2 }}><EligibilityBadge state={a.application.eligibilitySnapshot.state} /></ButtonBase>
    ) },
    { key: 'applied', header: 'Applied', render: (a) => fmtDate(a.application.appliedAt), hideBelow: 'lg' },
    { key: 'stage', header: 'Stage', render: (a) => <ApplicationStatusChip status={a.application.status} /> },
  ];

  const toolbar = review && selected.length > 0 && (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ p: 1.5, bgcolor: 'rgba(37,99,235,.06)', borderBottom: 1, borderColor: 'divider' }} role="toolbar" aria-label="Bulk actions">
      <Typography variant="body2" fontWeight={600} sx={{ mr: 1 }}>{selected.length} selected</Typography>
      {BULK.map((b) => <Button key={b.status} size="small" variant="outlined" color={b.tone ?? 'primary'} onClick={() => setPending({ status: b.status, ids: selected })}>{b.label}</Button>)}
      <Button size="small" color="inherit" onClick={() => setSelected([])}>Clear</Button>
    </Stack>
  );

  return (
    <>
      <PageHeader title="Applications & applicants" subtitle="Review eligibility, shortlist candidates and move them through the recruitment stages."
        actions={can('reports.view') ? <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>Export CSV</Button> : undefined} />
      <FilterBar>
        <SearchField value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search student, ID, company or job" />
        <FilterSelect label="Company" value={companyId} options={opts.data?.companies ?? []} onChange={(v) => { setCompanyId(v); setJobId(''); setPage(1); }} />
        <FilterSelect label="Job" value={jobId} options={jobOptions} onChange={reset(setJobId)} minWidth={200} />
        <FilterSelect label="Department" value={dept} options={(opts.data?.departments ?? []).map((d) => ({ value: d.value, label: d.label }))} onChange={reset(setDept)} />
        <FilterSelect label="Stage" value={status} options={STATUSES.map((s) => ({ value: s, label: APP_LABEL[s] }))} onChange={reset(setStatus)} />
        <FilterSelect label="Eligibility" value={eligibility} options={ELIG} onChange={reset(setEligibility)} minWidth={170} />
        <FilterSelect label="Sort by" value={sort} options={[{ value: 'recent', label: 'Most recent' }, { value: 'cgpa', label: 'CGPA (high–low)' }, { value: 'name', label: 'Name (A–Z)' }]} onChange={(v) => setSort((v || 'recent') as typeof sort)} allLabel="Most recent" />
      </FilterBar>
      <DataTable caption="Applicants" columns={columns} rows={state.data?.items} getId={(a) => a.application.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} pageSize={state.data?.pageSize} total={state.data?.total} onPageChange={setPage}
        selectable={review} selected={selected} onSelectedChange={setSelected} toolbar={toolbar || undefined}
        emptyTitle="No applications match" emptyMessage="Adjust the filters to see more applicants." />

      <ConfirmDialog open={!!pending} title={pending ? `${BULK.find((b) => b.status === pending.status)!.label} ${pending.ids.length} applicant(s)?` : ''} tone={pending?.status === 'rejected' ? 'error' : 'primary'}
        confirmLabel="Confirm" onClose={() => setPending(undefined)} onConfirm={() => run(pending!)}>
        <Typography variant="body2">Students are notified of the new stage. Applicants who are not eligible are <b>not</b> moved unless you record an approved exception.</Typography>
      </ConfirmDialog>

      <Dialog open={!!outcome} onClose={() => setOutcome(undefined)} fullWidth maxWidth="sm" aria-labelledby="outcome-title">
        <DialogTitle id="outcome-title">{outcome?.updated ? `${outcome.updated} moved, ${outcome.failed.length} not moved` : `${outcome?.failed.length} not moved`}</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>{outcome?.failed.map((f) => <Alert key={f.id} severity="warning" sx={{ py: 0 }}>{f.reason}</Alert>)}</Stack>
          {outcome?.failed.some((f) => /exception/i.test(f.reason)) && review && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Eligibility rules are never bypassed silently. If policy allows an exception, record the reason and approving user; both are written to the audit log.</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setOutcome(undefined)}>Close</Button>
          {review && outcome?.failed.some((f) => /exception/i.test(f.reason)) && (
            <Button variant="contained" color="warning" onClick={() => { setException({ status: outcome.status, ids: outcome.failed.filter((f) => /exception/i.test(f.reason)).map((f) => f.id) }); setOutcome(undefined); }}>Request exception…</Button>
          )}
        </DialogActions>
      </Dialog>

      <ExceptionDialog target={exception} onClose={() => setException(undefined)} onSubmit={async (exc) => { await run({ status: exception!.status, ids: exception!.ids }, exc); }} />

      <Dialog open={!!reasons} onClose={() => setReasons(undefined)} fullWidth maxWidth="sm" aria-labelledby="reasons-title">
        <DialogTitle id="reasons-title">Eligibility — {reasons?.student?.name}<Typography variant="body2" color="text.secondary">{reasons?.job.title} · {reasons?.company.name} (evaluated at application time)</Typography></DialogTitle>
        <DialogContent>{reasons && <EligibilityReasons result={reasons.application.eligibilitySnapshot} />}</DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setReasons(undefined)}>Close</Button></DialogActions>
      </Dialog>
    </>
  );
}

function ExceptionDialog({ target, onClose, onSubmit }: { target?: { status: ApplicationStatus; ids: string[] }; onClose: () => void; onSubmit: (e: { reason: string; approvedBy: string }) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 10 && approvedBy.trim().length >= 3;
  const submit = async () => {
    setBusy(true); setError(undefined);
    try { await onSubmit({ reason: reason.trim(), approvedBy: approvedBy.trim() }); setReason(''); setApprovedBy(''); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not record exception'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!target} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="exc-title">
      <DialogTitle id="exc-title">Record eligibility exception</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>This applies to {target?.ids.length} applicant(s) and moves them to <b>{target && APP_LABEL[target.status]}</b> despite failing eligibility. The reason and approver are stored with the application and in the audit log.</Alert>
        <Stack spacing={2}>
          <TextField label="Reason for exception" multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} helperText="At least 10 characters" required />
          <TextField label="Approved by (name / designation)" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} required />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={!valid || busy} onClick={submit}>{busy ? 'Recording…' : 'Record exception & move'}</Button>
      </DialogActions>
    </Dialog>
  );
}
