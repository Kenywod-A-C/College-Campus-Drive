import { useState } from 'react';
import { Box, Button, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { Course, Department } from '@/types';
import { adminApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader, StatusChip } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { CourseDialog, DepartmentDialog, YearDialog, type YearRow } from './parts/AcademicDialogs';

type DeptRow = Department & { students: number; courses: number };
type Dlg = { t: 'dept'; v?: DeptRow } | { t: 'course'; v?: Course } | { t: 'year'; v?: YearRow } | { t: 'del-dept'; v: DeptRow } | { t: 'del-course'; v: Course } | null;

const RowActions = ({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete?: () => void }) => (
  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
    <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${label}`} onClick={onEdit}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
    {onDelete && <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${label}`} onClick={onDelete}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>}
  </Box>
);

export function AdminDepartments() {
  const toast = useToast();
  const state = useAsync(() => adminApi.academic(), []);
  const [tab, setTab] = useState(0);
  const [dlg, setDlg] = useState<Dlg>(null);
  const close = () => setDlg(null);
  const addLabel = ['Add department', 'Add program', 'Add academic year'][tab];

  return (
    <>
      <PageHeader title="Departments & courses" subtitle="Academic structure used by eligibility rules, reports and user scopes."
        actions={<Button startIcon={<AddIcon />} variant="contained" color="secondary" onClick={() => setDlg({ t: (['dept', 'course', 'year'] as const)[tab] })}>{addLabel}</Button>} />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} aria-label="Academic configuration">
        <Tab label="Departments" /><Tab label="Degree programs & courses" /><Tab label="Academic years & batches" />
      </Tabs>
      <Async state={state}>
        {({ departments, courses, academicYears }) => {
          const deptCols: Column<DeptRow>[] = [
            { key: 'code', header: 'Code', render: (d) => <Typography variant="body2" fontWeight={600}>{d.code}</Typography> },
            { key: 'name', header: 'Department', render: (d) => d.name },
            { key: 'head', header: 'Head', hideBelow: 'sm', render: (d) => d.headName || '—' },
            { key: 'students', header: 'Students', align: 'right', render: (d) => d.students },
            { key: 'courses', header: 'Programs', align: 'right', hideBelow: 'sm', render: (d) => d.courses },
            { key: 'a', header: 'Actions', align: 'right', render: (d) => <RowActions label={d.code} onEdit={() => setDlg({ t: 'dept', v: d })} onDelete={() => setDlg({ t: 'del-dept', v: d })} /> },
          ];
          const courseCols: Column<Course>[] = [
            { key: 'code', header: 'Code', render: (c) => <Typography variant="body2" fontWeight={600}>{c.code}</Typography> },
            { key: 'name', header: 'Program', render: (c) => c.name },
            { key: 'degree', header: 'Degree', render: (c) => c.degree },
            { key: 'dept', header: 'Department', hideBelow: 'sm', render: (c) => departments.find((d) => d.id === c.departmentId)?.code ?? '—' },
            { key: 'dur', header: 'Duration', align: 'right', hideBelow: 'sm', render: (c) => `${c.durationYears} yrs` },
            { key: 'a', header: 'Actions', align: 'right', render: (c) => <RowActions label={c.code} onEdit={() => setDlg({ t: 'course', v: c })} onDelete={() => setDlg({ t: 'del-course', v: c })} /> },
          ];
          const yearCols: Column<YearRow>[] = [
            { key: 'label', header: 'Academic year', render: (y) => <Typography variant="body2" fontWeight={600}>{y.label}</Typography> },
            { key: 'grad', header: 'Graduation batch', render: (y) => y.graduationYear },
            { key: 'active', header: 'Status', render: (y) => <StatusChip label={y.active ? 'Current' : 'Not current'} tone={y.active ? 'success' : 'neutral'} /> },
            { key: 'a', header: 'Actions', align: 'right', render: (y) => <RowActions label={y.label} onEdit={() => setDlg({ t: 'year', v: y })} /> },
          ];
          return (
            <>
              {tab === 0 && <DataTable caption="Departments" columns={deptCols} rows={departments} getId={(d) => d.id} emptyTitle="No departments" />}
              {tab === 1 && <DataTable caption="Degree programs" columns={courseCols} rows={courses} getId={(c) => c.id} emptyTitle="No programs" />}
              {tab === 2 && <DataTable caption="Academic years" columns={yearCols} rows={academicYears} getId={(y) => y.id} emptyTitle="No academic years" />}
              <DepartmentDialog open={dlg?.t === 'dept'} dept={dlg?.t === 'dept' ? dlg.v : undefined} onClose={close} onSaved={state.reload} />
              <CourseDialog open={dlg?.t === 'course'} course={dlg?.t === 'course' ? dlg.v : undefined} departments={departments} onClose={close} onSaved={state.reload} />
              <YearDialog open={dlg?.t === 'year'} year={dlg?.t === 'year' ? dlg.v : undefined} onClose={close} onSaved={state.reload} />
            </>
          );
        }}
      </Async>
      <ConfirmDialog open={dlg?.t === 'del-dept'} onClose={close} tone="error" title="Delete department?" confirmLabel="Delete"
        onConfirm={async () => { if (dlg?.t !== 'del-dept') return; await adminApi.deleteDepartment(dlg.v.id); toast.success('Department deleted'); state.reload(); }}>
        {dlg?.t === 'del-dept' && <>Delete <b>{dlg.v.code} — {dlg.v.name}</b>? Departments with students or programs cannot be deleted.</>}
      </ConfirmDialog>
      <ConfirmDialog open={dlg?.t === 'del-course'} onClose={close} tone="error" title="Delete program?" confirmLabel="Delete"
        onConfirm={async () => { if (dlg?.t !== 'del-course') return; await adminApi.deleteCourse(dlg.v.id); toast.success('Program deleted'); state.reload(); }}>
        {dlg?.t === 'del-course' && <>Delete <b>{dlg.v.code} — {dlg.v.name}</b>?</>}
      </ConfirmDialog>
    </>
  );
}
