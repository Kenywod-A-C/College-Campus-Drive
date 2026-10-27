import { useState } from 'react';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import type { AuditLog } from '@/types';
import { adminApi } from '@/api';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { PageHeader } from '@/components/ui';
import { fmtDateTime } from '@/utils/format';
import { ResultChip } from './parts/ResultChip';

type Result = AuditLog['result'] | 'all';

export function AdminAuditLogs() {
  const [actor, setActor] = useState('');
  const [resource, setResource] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState<Result>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dActor = useDebounced(actor);
  const dResource = useDebounced(resource);
  const state = useAsync(() => adminApi.auditLogs({ actor: dActor, resource: dResource, action, result, from: from || undefined, to: to || undefined, page }), [dActor, dResource, action, result, from, to, page]);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const columns: Column<AuditLog>[] = [
    { key: 'at', header: 'Timestamp', render: (r) => <Typography variant="body2" noWrap>{fmtDateTime(r.at)}</Typography> },
    { key: 'actor', header: 'Actor', render: (r) => <><Typography variant="body2" fontWeight={600}>{r.actor}</Typography><Typography variant="caption" color="text.secondary">{r.actorRole}</Typography></> },
    { key: 'action', header: 'Action', render: (r) => <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{r.action}</Box> },
    { key: 'resource', header: 'Affected record', render: (r) => r.resource },
    { key: 'result', header: 'Result', render: (r) => <ResultChip result={r.result} /> },
    { key: 'reason', header: 'Reason / metadata', hideBelow: 'md', render: (r) => <Typography variant="body2" color="text.secondary">{r.reason ?? '—'}</Typography> },
  ];

  return (
    <>
      <PageHeader title="Audit logs" subtitle="An append-only record of administrative and placement changes." />
      <Alert icon={<LockOutlinedIcon fontSize="inherit" />} severity="info" sx={{ mb: 2 }}>Logs cannot be edited or deleted. The API exposes read-only access only.</Alert>
      <FilterBar>
        <SearchField value={actor} onChange={reset(setActor)} placeholder="Filter by user" width={200} />
        <SearchField value={resource} onChange={reset(setResource)} placeholder="Filter by record" width={200} />
        <FilterSelect label="Action type" value={action} options={(state.data?.actions ?? []).map((a) => ({ value: a, label: a }))} onChange={reset(setAction)} />
        <FilterSelect label="Result" value={result === 'all' ? '' : result} options={[{ value: 'success', label: 'Success' }, { value: 'denied', label: 'Denied' }, { value: 'failed', label: 'Failed' }]} onChange={(v) => { setResult((v || 'all') as Result); setPage(1); }} minWidth={130} />
        <Stack direction="row" spacing={1}>
          <TextField type="date" label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
          <TextField type="date" label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
        </Stack>
      </FilterBar>
      <DataTable
        caption="Audit log entries" columns={columns} rows={state.data?.items} getId={(r) => r.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} pageSize={state.data?.pageSize ?? 12} total={state.data?.total} onPageChange={setPage}
        emptyTitle="No matching log entries" emptyMessage="Try widening the filters or date range."
      />
    </>
  );
}
