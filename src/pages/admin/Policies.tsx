import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { PlacementPolicy } from '@/types';
import { adminApi, reportsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Async, EmptyState } from '@/components/feedback';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Grid, PageHeader, StatusChip } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { fmtDate } from '@/utils/format';
import { KIND_LABEL, PolicyDialog, SCOPE_LABEL } from './parts/PolicyDialog';

type Dlg = { kind: 'edit'; policy?: PlacementPolicy } | { kind: 'toggle'; policy: PlacementPolicy } | { kind: 'delete'; policy: PlacementPolicy } | null;

const paramText = (p: PlacementPolicy) => Object.entries(p.params).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`).join(' · ');

export function AdminPolicies() {
  const toast = useToast();
  const state = useAsync(() => adminApi.policies(), []);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const [dlg, setDlg] = useState<Dlg>(null);
  const scopeName = (p: PlacementPolicy) => p.scope === 'college' ? SCOPE_LABEL.college : p.scope === 'department' ? `Department: ${opts.data?.departments.find((d) => d.value === p.scopeValue)?.label ?? p.scopeValue}` : `Batch ${p.scopeValue}`;

  return (
    <>
      <PageHeader
        title="Placement policies" subtitle="Configurable, auditable rules. The eligibility service reads these at evaluation time; no offer limit is hardcoded."
        actions={<Button startIcon={<AddIcon />} variant="contained" color="secondary" onClick={() => setDlg({ kind: 'edit' })}>Add policy</Button>}
      />
      <Alert severity="info" sx={{ mb: 2 }}>Every change is recorded in the audit log with the acting administrator. Colleges differ, so enable only the rules that apply to yours.</Alert>
      <Async state={state}>
        {(policies) => {
          const kinds = (Object.keys(KIND_LABEL) as PlacementPolicy['kind'][]).filter((k) => policies.some((p) => p.kind === k));
          if (!policies.length) return <Card><EmptyState title="No policies configured" message="Add a policy to start enforcing placement rules." /></Card>;
          return (
            <Stack spacing={3}>
              {kinds.map((k) => (
                <Box key={k} component="section" aria-labelledby={`k-${k}`}>
                  <Typography id={`k-${k}`} variant="h4" component="h2" sx={{ mb: 1.5 }}>{KIND_LABEL[k]}</Typography>
                  <Grid cols={{ xs: 1, lg: 2 }}>
                    {policies.filter((p) => p.kind === k).map((p) => (
                      <Card key={p.id} sx={{ opacity: p.enabled ? 1 : 0.75 }}>
                        <CardContent>
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="h5" component="h3">{p.name}</Typography>
                              <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}><StatusChip label={scopeName(p)} tone="info" /><StatusChip label={p.enabled ? 'Enabled' : 'Disabled'} tone={p.enabled ? 'success' : 'neutral'} /></Stack>
                            </Box>
                            <Switch checked={p.enabled} onChange={() => setDlg({ kind: 'toggle', policy: p })} slotProps={{ input: { 'aria-label': `${p.enabled ? 'Disable' : 'Enable'} ${p.name}` } }} />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>{p.description}</Typography>
                          <Typography variant="body2" sx={{ mt: 1, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{paramText(p)}</Typography>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">Updated {fmtDate(p.updatedAt)} by {p.updatedBy}</Typography>
                            <Stack direction="row">
                              <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${p.name}`} onClick={() => setDlg({ kind: 'edit', policy: p })}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                              <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${p.name}`} onClick={() => setDlg({ kind: 'delete', policy: p })}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                            </Stack>
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Grid>
                </Box>
              ))}
            </Stack>
          );
        }}
      </Async>

      <PolicyDialog open={dlg?.kind === 'edit'} policy={dlg?.kind === 'edit' ? dlg.policy : undefined} departments={(opts.data?.departments ?? []).map((d) => ({ value: d.value, label: `${d.label} — ${d.name}` }))} years={(opts.data?.graduationYears ?? []).map((y) => ({ value: y.value, label: y.value }))} onClose={() => setDlg(null)} onSaved={state.reload} />
      <ConfirmDialog
        open={dlg?.kind === 'toggle'} onClose={() => setDlg(null)} tone={dlg?.kind === 'toggle' && dlg.policy.enabled ? 'warning' : 'primary'}
        title={dlg?.kind === 'toggle' && dlg.policy.enabled ? 'Disable policy?' : 'Enable policy?'} confirmLabel={dlg?.kind === 'toggle' && dlg.policy.enabled ? 'Disable' : 'Enable'}
        onConfirm={async () => { if (dlg?.kind !== 'toggle') return; const { id, updatedAt, updatedBy, ...rest } = dlg.policy; void updatedAt; void updatedBy; await adminApi.savePolicy({ ...rest, id, enabled: !dlg.policy.enabled }); toast.success(`${dlg.policy.name} ${dlg.policy.enabled ? 'disabled' : 'enabled'}`); state.reload(); }}
      >
        {dlg?.kind === 'toggle' && <><b>{dlg.policy.name}</b> will {dlg.policy.enabled ? 'stop' : 'start'} affecting eligibility checks and offer validation immediately.</>}
      </ConfirmDialog>
      <ConfirmDialog
        open={dlg?.kind === 'delete'} onClose={() => setDlg(null)} tone="error" title="Delete policy?" confirmLabel="Delete policy" requireReason reasonLabel="Reason for deleting"
        onConfirm={async (reason) => { if (dlg?.kind !== 'delete') return; await adminApi.deletePolicy(dlg.policy.id, reason ?? ''); toast.success('Policy deleted'); state.reload(); }}
      >
        {dlg?.kind === 'delete' && <>Delete <b>{dlg.policy.name}</b>? Consider disabling it instead if you may need it again. The reason is recorded in the audit log.</>}
      </ConfirmDialog>
    </>
  );
}
