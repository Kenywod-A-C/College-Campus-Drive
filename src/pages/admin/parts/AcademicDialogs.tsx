import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import type { Course, Department } from '@/types';
import { adminApi } from '@/api';
import { useToast } from '@/components/Toast';

export type YearRow = { id: string; label: string; graduationYear: number; active: boolean };

function FormDialog<T extends FieldValues>({ open, title, defaults, onClose, onSubmit, children }: { open: boolean; title: string; defaults: T; onClose: () => void; onSubmit: (v: T) => Promise<void>; children: (c: Control<T>) => ReactNode }) {
  const { control, handleSubmit, reset } = useForm<T>({ defaultValues: defaults as never });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { reset(defaults as never); setError(undefined); } }, [open, defaults, reset]);
  const submit = handleSubmit(async (v) => {
    setBusy(true); setError(undefined);
    try { await onSubmit(v as T); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  });
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit} aria-label={title}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><Stack spacing={2.25} sx={{ pt: 1 }}>{children(control as Control<T>)}{error && <Alert severity="error">{error}</Alert>}</Stack></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button><Button type="submit" variant="contained" color="secondary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></DialogActions>
    </Dialog>
  );
}

function Text<T extends FieldValues>({ control, name, label, required, type, pattern, helper }: { control: Control<T>; name: Path<T>; label: string; required?: string; type?: string; pattern?: { value: RegExp; message: string }; helper?: string }) {
  return <Controller name={name} control={control} rules={{ required, pattern } as never} render={({ field, fieldState }) => <TextField {...field} type={type} label={label} error={!!fieldState.error} helperText={fieldState.error?.message ?? helper} />} />;
}

type DeptForm = { code: string; name: string; headName: string };
export function DepartmentDialog({ open, dept, onClose, onSaved }: { open: boolean; dept?: Department; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const defaults: DeptForm = { code: dept?.code ?? '', name: dept?.name ?? '', headName: dept?.headName ?? '' };
  return (
    <FormDialog open={open} title={dept ? 'Edit department' : 'Add department'} defaults={defaults} onClose={onClose} onSubmit={async (v) => { await adminApi.saveDepartment({ id: dept?.id, code: v.code.trim(), name: v.name.trim(), headName: v.headName.trim() }); toast.success('Department saved'); onSaved(); }}>
      {(c) => <><Text control={c} name="code" label="Code" required="Code is required" helper="Short code, e.g. CSE" /><Text control={c} name="name" label="Department name" required="Name is required" /><Text control={c} name="headName" label="Head of department" /></>}
    </FormDialog>
  );
}

type CourseForm = { code: string; name: string; degree: Course['degree']; departmentId: string; durationYears: string };
const DEGREES: Course['degree'][] = ['B.E.', 'B.Tech', 'M.E.', 'M.Tech', 'MBA', 'MCA'];
export function CourseDialog({ open, course, departments, onClose, onSaved }: { open: boolean; course?: Course; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const defaults: CourseForm = { code: course?.code ?? '', name: course?.name ?? '', degree: course?.degree ?? 'B.E.', departmentId: course?.departmentId ?? '', durationYears: String(course?.durationYears ?? 4) };
  return (
    <FormDialog open={open} title={course ? 'Edit program' : 'Add degree program'} defaults={defaults} onClose={onClose}
      onSubmit={async (v) => {
        const years = Number(v.durationYears);
        if (!v.departmentId) throw new Error('Choose a department.');
        if (!Number.isInteger(years) || years < 1 || years > 6) throw new Error('Duration must be 1–6 years.');
        await adminApi.saveCourse({ id: course?.id, code: v.code.trim(), name: v.name.trim(), degree: v.degree, departmentId: v.departmentId, durationYears: years }); toast.success('Program saved'); onSaved();
      }}>
      {(c) => (
        <>
          <Text control={c} name="code" label="Course code" required="Code is required" />
          <Text control={c} name="name" label="Program name" required="Name is required" />
          <Controller name="degree" control={c} render={({ field }) => <TextField {...field} select label="Degree">{DEGREES.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}</TextField>} />
          <Controller name="departmentId" control={c} render={({ field }) => <TextField {...field} select label="Department">{departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.code} — {d.name}</MenuItem>)}</TextField>} />
          <Text control={c} name="durationYears" label="Duration (years)" type="number" />
        </>
      )}
    </FormDialog>
  );
}

type YearForm = { label: string; graduationYear: string; active: boolean };
export function YearDialog({ open, year, onClose, onSaved }: { open: boolean; year?: YearRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const defaults: YearForm = { label: year?.label ?? '', graduationYear: String(year?.graduationYear ?? new Date().getFullYear() + 1), active: year?.active ?? false };
  return (
    <FormDialog open={open} title={year ? 'Edit academic year' : 'Add academic year'} defaults={defaults} onClose={onClose}
      onSubmit={async (v) => { await adminApi.saveAcademicYear({ id: year?.id, label: v.label.trim(), graduationYear: Number(v.graduationYear), active: v.active }); toast.success('Academic year saved'); onSaved(); }}>
      {(c) => (
        <>
          <Text control={c} name="label" label="Academic year" required="Label is required" pattern={{ value: /^\d{4}-\d{2}$/, message: 'Use the format 2026-27' }} helper="e.g. 2026-27" />
          <Text control={c} name="graduationYear" label="Graduation year (batch)" type="number" required="Graduation year is required" />
          <Controller name="active" control={c} render={({ field }) => <FormControlLabel control={<Checkbox checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Current academic year (deactivates the others)" />} />
        </>
      )}
    </FormDialog>
  );
}
