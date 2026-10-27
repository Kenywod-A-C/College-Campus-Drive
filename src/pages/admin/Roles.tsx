import { Fragment, useState } from 'react';
import { Alert, Box, Card, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { Permission, Role } from '@/types';
import { adminApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Grid, MetricCard, PageHeader } from '@/components/ui';
import { useToast } from '@/components/Toast';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';

interface Change { role: Exclude<Role, 'student'>; perm: Permission; label: string; enabled: boolean }

export function AdminRoles() {
  const toast = useToast();
  const state = useAsync(() => adminApi.roles(), []);
  const [change, setChange] = useState<Change | null>(null);

  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Control what each role can do. Changes apply immediately and are written to the audit log." />
      <Alert severity="info" sx={{ mb: 2 }}>
        Every permission is enforced by the Flask API on each request. Hiding menu items in this interface is a convenience only and never the security boundary.
        Students always have access to their own records only and cannot be granted staff permissions.
      </Alert>
      <Async state={state}>
        {({ permissions, matrix, userCounts }) => {
          const modules = [...new Set(permissions.map((p) => p.module))];
          return (
            <Stack spacing={3}>
              <Grid cols={{ xs: 1, sm: 3 }}>
                <MetricCard label="Administrators" value={userCounts.admin} icon={<AdminPanelSettingsOutlinedIcon />} tone="purple" />
                <MetricCard label="Faculty / placement officers" value={userCounts.faculty} icon={<BadgeOutlinedIcon />} />
                <MetricCard label="Students" value={userCounts.student} icon={<GroupsOutlinedIcon />} tone="success" />
              </Grid>
              <Card>
                <TableContainer>
                  <Table aria-label="Role permission matrix">
                    <TableHead>
                      <TableRow>
                        <TableCell>Permission</TableCell>
                        <TableCell align="center">Admin</TableCell>
                        <TableCell align="center">Faculty</TableCell>
                        <TableCell align="center">Student</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {modules.map((m) => (
                        <Fragment key={m}>
                          <TableRow><TableCell colSpan={4} sx={{ bgcolor: '#f1f5f9', fontWeight: 700, py: 1 }}>{m}</TableCell></TableRow>
                          {permissions.filter((p) => p.module === m).map((p) => (
                            <TableRow key={p.key}>
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>{p.label}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 520 }}>{p.description}</Typography>
                                <Box component="code" sx={{ fontSize: 11, color: 'text.secondary' }}>{p.key}</Box>
                              </TableCell>
                              {(['admin', 'faculty'] as const).map((r) => (
                                <TableCell key={r} align="center">
                                  <Switch
                                    checked={matrix[r].includes(p.key)}
                                    onChange={(e) => setChange({ role: r, perm: p.key, label: p.label, enabled: e.target.checked })}
                                    slotProps={{ input: { 'aria-label': `${matrix[r].includes(p.key) ? 'Revoke' : 'Grant'} ${p.label} for ${r}` } }}
                                  />
                                </TableCell>
                              ))}
                              <TableCell align="center"><Typography variant="caption" color="text.secondary">Own records only</Typography></TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
              <ConfirmDialog
                open={!!change} onClose={() => setChange(null)} tone={change?.enabled ? 'primary' : 'warning'}
                title={change?.enabled ? 'Grant permission?' : 'Revoke permission?'} confirmLabel={change?.enabled ? 'Grant' : 'Revoke'}
                onConfirm={async () => {
                  if (!change) return;
                  await adminApi.setPermission(change.role, change.perm, change.enabled);
                  toast.success(`${change.enabled ? 'Granted' : 'Revoked'} “${change.label}” ${change.enabled ? 'to' : 'from'} ${change.role}`);
                  state.reload();
                }}
              >
                {change && <>{change.enabled ? 'Grant' : 'Revoke'} <b>{change.label}</b> {change.enabled ? 'to' : 'from'} every <b>{change.role}</b> account. Affected users see the change on their next request.</>}
              </ConfirmDialog>
            </Stack>
          );
        }}
      </Async>
    </>
  );
}
