import { Link as RouterLink } from 'react-router-dom';
import { Button, Typography } from '@mui/material';
import type { User } from '@/types';
import { reportsApi, usersApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { DataTable, type Column } from '@/components/DataTable';
import { StatusChip } from '@/components/ui';
import { fmtDate, titleCase } from '@/utils/format';
import { FacultyStudents } from '@/pages/faculty/Students';
import { TabbedPage } from './parts/TabbedPage';

const tone = { active: 'success', inactive: 'neutral', invited: 'info' } as const;

function FacultyAccounts() {
  const state = useAsync(() => usersApi.list({ role: 'faculty', pageSize: 50 }), []);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', render: (u) => <Typography variant="body2" fontWeight={600}>{u.name}</Typography> },
    { key: 'email', header: 'Email', hideBelow: 'sm', render: (u) => u.email },
    { key: 'dept', header: 'Department', render: (u) => opts.data?.departments.find((d) => d.value === u.departmentId)?.label ?? '—' },
    { key: 'status', header: 'Status', render: (u) => <StatusChip label={titleCase(u.status)} tone={tone[u.status]} /> },
    { key: 'login', header: 'Last login', hideBelow: 'md', render: (u) => (u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Never') },
  ];
  return (
    <DataTable
      caption="Faculty accounts" columns={columns} rows={state.data?.items} getId={(u) => u.id} loading={state.loading} error={state.error} onRetry={state.reload}
      emptyTitle="No faculty accounts" emptyMessage="Add faculty from User management."
      toolbar={<Typography variant="body2" color="text.secondary" sx={{ p: 2, pb: 0 }}>Read-only list. Edit roles, scopes and status in <Button component={RouterLink} to="/admin/users?q=" size="small">User management</Button>.</Typography>}
    />
  );
}

export function AdminStudentsFaculty({ initialTab = 'students' }: { initialTab?: 'students' | 'faculty' }) {
  return (
    <TabbedPage
      title="Students & faculty" subtitle="Browse placement profiles and staff accounts." active={initialTab}
      tabs={[
        { key: 'students', label: 'Students', path: '/admin/students', content: <FacultyStudents embedded /> },
        { key: 'faculty', label: 'Faculty', path: '/admin/faculty', content: <FacultyAccounts /> },
      ]}
    />
  );
}
