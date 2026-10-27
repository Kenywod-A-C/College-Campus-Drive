import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Checkbox, FormControlLabel, IconButton, Stack, Switch, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import type { AppNotification, NotificationPrefs, Reminder } from '@/types';
import { notificationsApi, remindersApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { PageHeader, SectionCard, StatusChip } from '@/components/ui';
import { Async, EmptyState } from '@/components/feedback';
import { FilterBar, FilterSelect } from '@/components/FilterBar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { fmtDateTime, timeAgo, titleCase } from '@/utils/format';
import { ReminderDialog } from './parts/ReminderDialog';

const KIND_LABEL: Record<Reminder['kind'], string> = { drive: 'Placement drive', deadline: 'Application deadline', interview: 'Interview', custom: 'Personal' };
const KIND_TONE = { drive: 'info', deadline: 'warning', interview: 'purple', custom: 'neutral' } as const;
const NOTIF_KINDS: AppNotification['kind'][] = ['drive', 'deadline', 'interview', 'offer', 'application', 'system'];

function RemindersTab() {
  const toast = useToast();
  const state = useAsync(() => remindersApi.list(), []);
  const [kind, setKind] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; reminder?: Reminder }>({ open: false });
  const [del, setDel] = useState<Reminder | null>(null);

  const toggle = async (r: Reminder) => {
    try { await remindersApi.toggle(r.id); state.reload(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update'); }
  };
  return (
    <>
      <FilterBar trailing={<Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setDialog({ open: true })}>New reminder</Button>}>
        <FilterSelect label="Type" value={kind} options={(Object.keys(KIND_LABEL) as Reminder['kind'][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={setKind} />
      </FilterBar>
      <Async state={state}>
        {(all) => {
          const rows = all.filter((r) => !kind || r.reminder.kind === kind);
          const upcoming = rows.filter((r) => !r.reminder.done);
          const done = rows.filter((r) => r.reminder.done);
          const renderRow = (r: typeof rows[number]) => (
            <Stack key={r.reminder.id} direction="row" spacing={1} alignItems="center" sx={{ py: 1.25 }}>
              <Checkbox checked={r.reminder.done} onChange={() => toggle(r.reminder)} slotProps={{ input: { 'aria-label': `Mark "${r.reminder.title}" as ${r.reminder.done ? 'not done' : 'done'}` } }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} sx={{ textDecoration: r.reminder.done ? 'line-through' : undefined, color: r.reminder.done ? 'text.secondary' : undefined }}>{r.reminder.title}</Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="caption" color="text.secondary">{fmtDateTime(r.reminder.at)}</Typography>
                  <StatusChip label={KIND_LABEL[r.reminder.kind]} tone={KIND_TONE[r.reminder.kind]} />
                  {r.companyName && <Typography variant="caption" color="text.secondary">{r.companyName} — {r.jobTitle}</Typography>}
                </Stack>
              </Box>
              <Tooltip title="Edit"><IconButton onClick={() => setDialog({ open: true, reminder: r.reminder })} aria-label={`Edit ${r.reminder.title}`}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
              <Tooltip title="Delete"><IconButton onClick={() => setDel(r.reminder)} aria-label={`Delete ${r.reminder.title}`}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
            </Stack>
          );
          return (
            <Stack spacing={2.5}>
              <SectionCard title={`Upcoming (${upcoming.length})`}>
                {upcoming.length === 0 ? <EmptyState title="No upcoming reminders" message="Add a reminder for a drive, deadline or anything you don't want to forget." /> : <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>{upcoming.map(renderRow)}</Stack>}
              </SectionCard>
              {done.length > 0 && <SectionCard title={`Completed (${done.length})`}><Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>{done.map(renderRow)}</Stack></SectionCard>}
            </Stack>
          );
        }}
      </Async>
      <ReminderDialog open={dialog.open} reminder={dialog.reminder} onClose={() => setDialog({ open: false })} onSaved={state.reload} />
      <ConfirmDialog open={!!del} title="Delete reminder?" confirmLabel="Delete" tone="error" onClose={() => setDel(null)} onConfirm={async () => { await remindersApi.remove(del!.id); toast.success('Reminder deleted'); state.reload(); }}>
        “{del?.title}” will be removed.
      </ConfirmDialog>
    </>
  );
}

function NotificationsTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const state = useAsync(() => notificationsApi.list(), []);
  const [kind, setKind] = useState('');

  const markRead = async (n: AppNotification) => { if (!n.read) { await notificationsApi.markRead(n.id).catch(() => undefined); state.reload(); } };
  const markAll = async () => { await notificationsApi.markAllRead(); toast.success('All notifications marked as read'); state.reload(); };

  return (
    <>
      <FilterBar trailing={<Button onClick={markAll} disabled={!state.data?.some((n) => !n.read)}>Mark all as read</Button>}>
        <FilterSelect label="Type" value={kind} options={NOTIF_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} onChange={setKind} />
      </FilterBar>
      <Async state={state}>
        {(all) => {
          const rows = all.filter((n) => !kind || n.kind === kind);
          return rows.length === 0 ? <Card><EmptyState title="No notifications" message="Interview invitations, deadlines and offer updates will show up here." /></Card> : (
            <Card>
              <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                {rows.map((n) => (
                  <Stack component="li" key={n.id} direction="row" spacing={1.5} alignItems="flex-start" sx={{ p: 2, bgcolor: n.read ? undefined : 'rgba(37,99,235,.05)' }}>
                    <FiberManualRecordIcon sx={{ fontSize: 10, mt: 0.8, color: n.read ? 'transparent' : 'secondary.main' }} titleAccess={n.read ? undefined : 'Unread'} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={n.read ? 500 : 700}>{n.title}</Typography>
                      <Typography variant="body2" color="text.secondary">{n.body}</Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}><StatusChip label={titleCase(n.kind)} /><Typography variant="caption" color="text.secondary">{timeAgo(n.at)}</Typography></Stack>
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      {n.link && <Button size="small" onClick={() => { markRead(n); navigate(n.link!); }}>Open</Button>}
                      {!n.read && <Button size="small" color="inherit" onClick={() => markRead(n)}>Mark read</Button>}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Card>
          );
        }}
      </Async>
    </>
  );
}

const PREF_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'driveReminders', label: 'Placement drive reminders', hint: 'Before drives you have applied to' },
  { key: 'deadlineReminders', label: 'Application deadline reminders', hint: 'When open jobs are about to close' },
  { key: 'interviewAlerts', label: 'Interview notifications', hint: 'Schedules, changes and cancellations' },
  { key: 'offerUpdates', label: 'Offer updates', hint: 'New offers and status changes' },
  { key: 'email', label: 'Email delivery', hint: 'Email is not sent in this demo; preference is stored only' },
  { key: 'push', label: 'Browser push', hint: 'Not implemented in this demo; preference is stored only' },
];

function PreferencesTab() {
  const toast = useToast();
  const state = useAsync(() => notificationsApi.getPrefs(), []);
  const [draft, setDraft] = useState<NotificationPrefs>();
  const [saving, setSaving] = useState(false);
  const p = draft ?? state.data;
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try { state.setData(await notificationsApi.setPrefs(draft)); setDraft(undefined); toast.success('Preferences saved'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSaving(false); }
  };
  return (
    <Async state={state}>
      {() => (
        <SectionCard title="Notification preferences" action={<Button variant="contained" color="secondary" disabled={!draft || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>}>
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {PREF_ROWS.map((r) => (
              <FormControlLabel key={r.key} labelPlacement="start" sx={{ justifyContent: 'space-between', ml: 0, py: 1 }}
                control={<Switch checked={!!p?.[r.key]} onChange={(e) => setDraft({ ...p!, [r.key]: e.target.checked })} />}
                label={<Box><Typography variant="body2" fontWeight={600}>{r.label}</Typography><Typography variant="caption" color="text.secondary">{r.hint}</Typography></Box>} />
            ))}
          </Stack>
        </SectionCard>
      )}
    </Async>
  );
}

export function StudentReminders() {
  const [tab, setTab] = useState(0);
  return (
    <>
      <PageHeader title="Reminders & Notifications" subtitle="Stay on top of drives, deadlines and interviews." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }} aria-label="Reminders sections">
        <Tab label="Reminders" /><Tab label="Notifications" /><Tab label="Preferences" />
      </Tabs>
      {tab === 0 && <RemindersTab />}
      {tab === 1 && <NotificationsTab />}
      {tab === 2 && <PreferencesTab />}
    </>
  );
}
