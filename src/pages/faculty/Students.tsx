import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import type { StudentRow } from '@/types/views';
import { reportsApi, studentsApi } from '@/api';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, FilterSelect, SearchField } from '@/components/FilterBar';
import { PlacementChip } from '@/components/ui';
import { useDeptName } from '@/hooks/useDeptName';
import { ListHeader } from './parts/Header';

const PLACEMENT = [{ value: 'unplaced', label: 'Unplaced' }, { value: 'in_process', label: 'In process' }, { value: 'placed', label: 'Placed' }, { value: 'opted_out', label: 'Opted out' }];
const CGPA = [6, 7, 8, 9].map((v) => ({ value: v, label: `${v}.0 and above` }));

export function FacultyStudents({ embedded }: { embedded?: boolean }) {
  const deptName = useDeptName();
  const base = useBase();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? ''; // shared with the topbar global search
  const setQ = (v: string) => { const n = new URLSearchParams(params); if (v) n.set('q', v); else n.delete('q'); setParams(n, { replace: true }); setPage(1); };
  const [dept, setDept] = useState('');
  const [year, setYear] = useState('');
  const [minCgpa, setMinCgpa] = useState('');
  const [skill, setSkill] = useState('');
  const [placement, setPlacement] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const dskill = useDebounced(skill);
  const opts = useAsync(() => reportsApi.filterOptions(), []);
  const state = useAsync(() => studentsApi.list({ q: dq, dept: dept || undefined, year: Number(year) || undefined, minCgpa: minCgpa ? Number(minCgpa) : undefined, skill: dskill || undefined, placement: placement || undefined, page }), [dq, dept, year, minCgpa, dskill, placement, page]);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const columns: Column<StudentRow>[] = [
    { key: 'code', header: 'Student ID', render: (s) => s.studentCode || '—', hideBelow: 'sm' },
    { key: 'name', header: 'Name', render: (s) => <Box><Typography variant="body2" fontWeight={600}>{s.name}</Typography><Typography variant="caption" color="text.secondary">{deptName(s.departmentId)}</Typography></Box> },
    { key: 'year', header: 'Year', render: (s) => `Year ${s.currentYear} · ${s.graduationYear}`, hideBelow: 'md' },
    { key: 'cgpa', header: 'CGPA', render: (s) => s.academic.cgpa == null ? <Typography variant="body2" color="text.secondary">Missing</Typography> : (
      <Stack direction="row" spacing={0.5} alignItems="center"><span>{s.academic.cgpa.toFixed(2)}</span>{s.academic.cgpaVerified && <VerifiedIcon fontSize="inherit" color="success" titleAccess="Verified" />}</Stack>
    ) },
    { key: 'skills', header: 'Skills', hideBelow: 'lg', render: (s) => (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{s.skills.slice(0, 3).map((k) => <Chip key={k} size="small" variant="outlined" label={k} />)}{s.skills.length > 3 && <Chip size="small" variant="outlined" label={`+${s.skills.length - 3}`} />}</Stack>
    ) },
    { key: 'completion', header: 'Profile', width: 120, hideBelow: 'md', render: (s) => (
      <Stack direction="row" spacing={1} alignItems="center"><LinearProgress variant="determinate" value={s.profileCompletion} sx={{ flex: 1, height: 6, borderRadius: 3 }} aria-label={`Profile ${s.profileCompletion}% complete`} /><Typography variant="caption">{s.profileCompletion}%</Typography></Stack>
    ) },
    { key: 'apps', header: 'Apps', align: 'right', render: (s) => s.applicationCount, hideBelow: 'sm' },
    { key: 'status', header: 'Placement', render: (s) => <PlacementChip status={s.placementStatus} /> },
  ];

  return (
    <>
      <ListHeader embedded={embedded} title="Students" subtitle="Placement profiles. Sensitive personal details are masked unless your role allows them." />
      <FilterBar>
        <SearchField value={q} onChange={setQ} placeholder="Search by name, ID or email" />
        <FilterSelect label="Department" value={dept} options={(opts.data?.departments ?? []).map((d) => ({ value: d.value, label: d.label }))} onChange={reset(setDept)} />
        <FilterSelect label="Graduation year" value={year} options={[2026, 2027, 2028].map((y) => ({ value: y, label: String(y) }))} onChange={reset(setYear)} />
        <FilterSelect label="CGPA" value={minCgpa} options={CGPA} onChange={reset(setMinCgpa)} minWidth={140} />
        <FilterSelect label="Placement" value={placement} options={PLACEMENT} onChange={reset(setPlacement)} />
        <SearchField value={skill} onChange={reset(setSkill)} placeholder="Filter by skill" width={170} />
      </FilterBar>
      <DataTable caption="Student directory" columns={columns} rows={state.data?.items} getId={(s) => s.id} loading={state.loading} error={state.error} onRetry={state.reload}
        page={page} pageSize={state.data?.pageSize} total={state.data?.total} onPageChange={setPage} onRowClick={(s) => navigate(`${base}/students/${s.id}`)}
        emptyTitle="No students match" emptyMessage="Adjust the search or filters." />
    </>
  );
}
