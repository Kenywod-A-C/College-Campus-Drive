import { useMemo, useState } from 'react';
import { Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';
import PersonOutlineIcon from '@mui/icons-material/HowToRegOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { Role, User } from '@/types';
import { reportsApi, usersApi } from '@/api';
import { ROLE_LABEL } from '@/auth/permissions';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { PageHeader, StatusChip } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { fmtDate, titleCase } from '@/utils/format';
import { UserDialog } from './parts/UserDialog';
import { ImportDialog } from './parts/ImportDialog';

const statusTone = { active: 'success', inactive: 'neutral', invited: 'info' } as const;
type Dialogs = { kind: 'edit'; user?: User } | { kind: 'status'; user: User } | { kind: 'reset'; user: User } | { kind: 'import' } | null;

export function AdminUsers() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [status, setStatus] = useState('all');
  const [dept, setDept] = useState('');
  const [page, setPage] = useState(1);
  const [dlg, setDlg] = useState<Dialogs>(null);
  const dq = useDebounced(q);
  const state = useAsync(() => usersApi.list({ q: dq, role, status, dept: dept || undefined, page }), [dq, role, status, dept, page]);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const depts = opts.data?.departments ?? [];
  const deptLabel = useMemo(() => new Map(depts.map((d) => [d.value, d.label])), [depts]);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const close = () => setDlg(null);

  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', render: (u) => <Typography variant="body2" fontWeight={600}>{u.name}</Typography> },
    { key: 'email', header: 'Email', hideBelow: 'md', render: (u) => u.email },
    { key: 'code', header: 'User ID', hideBelow: 'sm', render: (u) => u.userCode },
    { key: 'role', header: 'Role', render: (u) => <StatusChip label={titleCase(u.role)} tone={u.role === 'admin' ? 'purple' : u.role === 'faculty' ? 'info' : 'neutral'} /> },
    { key: 'dept', header: 'Department', hideBelow: 'lg', render: (u) => (u.departmentId ? deptLabel.get(u.departmentId) ?? u.departmentId : '—') },
    { key: 'status', header: 'Status', render: (u) => <StatusChip label={titleCase(u.status)} tone={statusTone[u.status]} /> },
    { key: 'created', header: 'Created', hideBelow: 'lg', render: (u) => fmtDate(u.createdAt) },
    {
      key: 'actions', header: 'Actions', align: 'right',
      render: (u) => (
        <Stack direction="row" justifyContent="flex-end">
          <Tooltip title="Edit user"><IconButton size="small" aria-label={`Edit ${u.name}`} onClick={() => setDlg({ kind: 'edit', user: u })}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Send password reset"><IconButton size="small" aria-label={`Reset password for ${u.name}`} onClick={() => setDlg({ kind: 'reset', user: u })}><LockResetIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={u.status === 'active' ? 'Deactivate account' : 'Activate account'}>
            <IconButton size="small" aria-label={`${u.status === 'active' ? 'Deactivate' : 'Activate'} ${u.name}`} onClick={() => setDlg({ kind: 'status', user: u })}>
              {u.status === 'active' ? <PersonOffOutlinedIcon fontSize="small" /> : <PersonOutlineIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="User management" subtitle="Create accounts, assign roles and manage access. Passwords are never displayed."
        actions={<><Button startIcon={<UploadFileIcon />} variant="outlined" onClick={() => setDlg({ kind: 'import' })}>Import students</Button><Button startIcon={<AddIcon />} variant="contained" color="secondary" onClick={() => setDlg({ kind: 'edit' })}>Add user</Button></>}
      />
      <FilterBar>
        <SearchField value={q} onChange={reset(setQ)} placeholder="Search name, email or ID" />
        <FilterSelect label="Role" value={role === 'all' ? '' : role} options={(['student', 'faculty', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r].split(' /')[0] }))} onChange={(v) => reset(setRole)((v || 'all') as Role | 'all')} minWidth={130} />
        <FilterSelect label="Status" value={status === 'all' ? '' : status} options={['active', 'inactive', 'invited'].map((s) => ({ value: s, label: titleCase(s) }))} onChange={(v) => reset(setStatus)(v || 'all')} minWidth={130} />
        <FilterSelect label="Department" value={dept} options={depts.map((d) => ({ value: d.value, label: d.label }))} onChange={reset(setDept)} minWidth={140} />
      </FilterBar>
      <DataTable
        caption="Users" columns={columns} rows={state.data?.items} getId={(u) => u.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} pageSize={state.data?.pageSize ?? 10} total={state.data?.total} onPageChange={setPage}
        emptyTitle="No users match" emptyMessage="Adjust the search or filters, or add a new user."
      />

      <UserDialog open={dlg?.kind === 'edit'} user={dlg?.kind === 'edit' ? dlg.user : undefined} departments={depts} onClose={close} onSaved={state.reload} />
      <ImportDialog open={dlg?.kind === 'import'} onClose={close} onImported={state.reload} />
      <ConfirmDialog
        open={dlg?.kind === 'status'} onClose={close} tone={dlg?.kind === 'status' && dlg.user.status === 'active' ? 'warning' : 'primary'}
        title={dlg?.kind === 'status' && dlg.user.status === 'active' ? 'Deactivate account?' : 'Activate account?'}
        confirmLabel={dlg?.kind === 'status' && dlg.user.status === 'active' ? 'Deactivate' : 'Activate'}
        onConfirm={async () => {
          if (dlg?.kind !== 'status') return;
          const next = dlg.user.status === 'active' ? 'inactive' : 'active';
          await usersApi.setStatus(dlg.user.id, next);
          toast.success(`${dlg.user.name} is now ${next}`); state.reload();
        }}
      >
        {dlg?.kind === 'status' && (dlg.user.status === 'active' ? <><b>{dlg.user.name}</b> will no longer be able to sign in. Their records are kept.</> : <><b>{dlg.user.name}</b> will be able to sign in again.</>)}
      </ConfirmDialog>
      <ConfirmDialog
        open={dlg?.kind === 'reset'} onClose={close} title="Send password reset?" confirmLabel="Send reset link"
        onConfirm={async () => { if (dlg?.kind !== 'reset') return; const r = await usersApi.resetPassword(dlg.user.id); toast.success(r.message); }}
      >
        {dlg?.kind === 'reset' && <>A one-time reset link will be sent to <b>{dlg.user.email}</b>. You will not see or set the password yourself.</>}
      </ConfirmDialog>
    </>
  );
}
