import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Tab, Tabs, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import type { Interview } from '@/types';
import type { ApplicationView } from '@/types/views';
import { applicationsApi, interviewsApi, type InterviewView } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { DataTable, type Column } from '@/components/DataTable';
import { useToast } from '@/components/Toast';
import { ApplicationStatusChip, Grid, InterviewStatusChip, KeyValue, PageHeader, SectionCard, StatusChip } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/utils/format';
import { InterviewCalendar } from './parts/InterviewCalendar';
import { InterviewDialog } from './parts/InterviewDialog';

const isLink = (s: string) => /^https?:\/\//.test(s);

export function FacultyInterviews() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('applications.review');
  const [tab, setTab] = useState<'calendar' | 'list' | 'results'>('calendar');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [detail, setDetail] = useState<InterviewView>();
  const [form, setForm] = useState<{ edit?: InterviewView } | null>(null);
  const [busy, setBusy] = useState(false);
  const state = useAsync(() => interviewsApi.list(), []);
  const results = useAsync(async () => {
    const [sel, off] = await Promise.all([applicationsApi.listAll({ status: 'selected', pageSize: 100 }), applicationsApi.listAll({ status: 'offer_received', pageSize: 100 })]);
    return [...sel.items, ...off.items];
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); state.reload(); setDetail(undefined); } catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  };
  const status = (i: InterviewView, s: Interview['status']) => act(() => interviewsApi.setStatus(i.interview.id, s), `Marked ${s.replace('_', ' ')}`);
  const notify = (i: InterviewView) => act(() => interviewsApi.notify(i.interview.id), 'Students notified in-app (email is not sent in this demo)');
  const live = detail && state.data?.find((x) => x.interview.id === detail.interview.id) ? state.data.find((x) => x.interview.id === detail.interview.id)! : detail;

  const listCols: Column<InterviewView>[] = [
    { key: 'round', header: 'Round', render: (i) => <Box><Typography variant="body2" fontWeight={600}>{i.interview.round}</Typography><Typography variant="caption" color="text.secondary">{i.company.name} — {i.job.title}</Typography></Box> },
    { key: 'when', header: 'Date & time', render: (i) => `${fmtDateTime(i.interview.at)} · ${i.interview.durationMins} min` },
    { key: 'where', header: 'Location / link', hideBelow: 'md', render: (i) => isLink(i.interview.location) ? <Link href={i.interview.location} target="_blank" rel="noopener noreferrer">Meeting link</Link> : i.interview.location },
    { key: 'cands', header: 'Candidates', align: 'right', render: (i) => i.candidates.length, hideBelow: 'sm' },
    { key: 'status', header: 'Status', render: (i) => <InterviewStatusChip status={i.interview.status} /> },
    { key: 'notified', header: 'Students', hideBelow: 'sm', render: (i) => <StatusChip label={i.interview.notified ? 'Notified' : 'Not notified'} tone={i.interview.notified ? 'success' : 'warning'} /> },
  ];
  const resCols: Column<ApplicationView>[] = [
    { key: 's', header: 'Student', render: (a) => <Box><Typography variant="body2" fontWeight={600}>{a.student!.name}</Typography><Typography variant="caption" color="text.secondary">{a.student!.studentCode}</Typography></Box> },
    { key: 'j', header: 'Company & job', render: (a) => `${a.company.name} — ${a.job.title}` },
    { key: 'st', header: 'Outcome', render: (a) => <ApplicationStatusChip status={a.application.status} /> },
    { key: 'u', header: 'Updated', render: (a) => fmtDate(a.application.updatedAt), hideBelow: 'sm' },
  ];

  return (
    <>
      <PageHeader title="Interviews & selection" subtitle="Schedule rounds, notify candidates and track selection results."
        actions={manage ? <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setForm({})}>Schedule interview</Button> : undefined} />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Interview views" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="calendar" label="Calendar" /><Tab value="list" label="Schedule list" /><Tab value="results" label="Selection results" />
      </Tabs>

      {tab !== 'results' ? (
        <Async state={state}>
          {(items) => tab === 'calendar'
            ? <SectionCard><InterviewCalendar month={month} onMonth={setMonth} items={items} onOpen={setDetail} /></SectionCard>
            : <DataTable caption="Interview schedule" columns={listCols} rows={items} getId={(i) => i.interview.id} onRowClick={setDetail} emptyTitle="No interviews scheduled" emptyMessage="Shortlist applicants, then schedule a round for them." />}
        </Async>
      ) : (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">Candidates selected after interviews, and those who already received an official offer. Offers are issued from Offers &amp; Placements.</Typography>
          <DataTable caption="Selection results" columns={resCols} rows={results.data} getId={(a) => a.application.id} loading={results.loading} error={results.error} onRetry={results.reload} emptyTitle="No selections yet" />
        </Stack>
      )}

      <Dialog open={!!live} onClose={() => setDetail(undefined)} fullWidth maxWidth="sm" aria-labelledby="int-title">
        {live && (
          <>
            <DialogTitle id="int-title">{live.interview.round}<Typography variant="body2" color="text.secondary">{live.company.name} — {live.job.title}</Typography></DialogTitle>
            <DialogContent>
              <Grid cols={{ xs: 2 }}>
                <KeyValue label="When">{fmtDateTime(live.interview.at)} · {live.interview.durationMins} min</KeyValue>
                <KeyValue label="Status"><InterviewStatusChip status={live.interview.status} /></KeyValue>
                <KeyValue label="Location / link">{isLink(live.interview.location) ? <Link href={live.interview.location} target="_blank" rel="noopener noreferrer">{live.interview.location}</Link> : live.interview.location}</KeyValue>
                <KeyValue label="Student notification"><StatusChip label={live.interview.notified ? 'Notified' : 'Not notified'} tone={live.interview.notified ? 'success' : 'warning'} /></KeyValue>
              </Grid>
              <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 1 }}>Candidates ({live.candidates.length})</Typography>
              <Stack spacing={1}>{live.candidates.map((c) => (
                <Stack key={c.applicationId} direction="row" justifyContent="space-between" alignItems="center"><Typography variant="body2">{c.name} <Typography component="span" variant="caption" color="text.secondary">{c.studentCode}</Typography></Typography><ApplicationStatusChip status={c.status} /></Stack>
              ))}</Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Button color="inherit" onClick={() => setDetail(undefined)}>Close</Button>
              {manage && live.interview.status === 'scheduled' && <>
                <Button disabled={busy} onClick={() => status(live, 'cancelled')} color="error">Cancel round</Button>
                <Button disabled={busy} onClick={() => status(live, 'no_show')}>No-show</Button>
                <Button disabled={busy} onClick={() => status(live, 'completed')}>Mark completed</Button>
                <Button disabled={busy} onClick={() => { setForm({ edit: live }); setDetail(undefined); }}>Edit</Button>
                <Button variant="contained" color="secondary" disabled={busy} startIcon={<NotificationsActiveOutlinedIcon />} onClick={() => notify(live)}>{live.interview.notified ? 'Re-notify' : 'Notify students'}</Button>
              </>}
            </DialogActions>
          </>
        )}
      </Dialog>
      <InterviewDialog open={!!form} edit={form?.edit} onClose={() => setForm(null)} onSaved={state.reload} />
    </>
  );
}
