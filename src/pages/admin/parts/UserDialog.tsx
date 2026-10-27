import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import type { Role, User } from '@/types';
import { usersApi, type UserInput } from '@/api';
import { ROLE_LABEL } from '@/auth/permissions';
import { useToast } from '@/components/Toast';

interface Props { open: boolean; user?: User; departments: { value: string; label: string; name: string }[]; onClose: () => void; onSaved: () => void }
type Form = { name: string; email: string; userCode: string; role: Role; departmentId: string };
const empty: Form = { name: '', email: '', userCode: '', role: 'student', departmentId: '' };

export function UserDialog({ open, user, departments, onClose, onSaved }: Props) {
  const toast = useToast();
  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<Form>({ defaultValues: empty });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const role = watch('role');
  useEffect(() => { if (open) { reset(user ? { name: user.name, email: user.email, userCode: user.userCode, role: user.role, departmentId: user.departmentId ?? '' } : empty); setError(undefined); } }, [open, user, reset]);

  const submit = handleSubmit(async (v) => {
    setBusy(true); setError(undefined);
    try {
      const input: UserInput = { id: user?.id, name: v.name.trim(), email: v.email.trim(), userCode: v.userCode.trim(), role: v.role, departmentId: v.departmentId || undefined };
      await usersApi.save(input);
      toast.success(user ? 'User updated' : 'User created as invited. E-mail delivery is not configured, so no invitation was sent.');
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save user'); }
    finally { setBusy(false); }
  });

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit} aria-labelledby="user-dialog-title">
      <DialogTitle id="user-dialog-title">{user ? `Edit ${user.name}` : 'Add user'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          <Controller name="name" control={control} rules={{ required: 'Name is required' }} render={({ field }) => <TextField {...field} label="Full name" error={!!errors.name} helperText={errors.name?.message} />} />
          <Controller name="email" control={control} rules={{ required: 'Email is required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' } }} render={({ field }) => <TextField {...field} label="College email" slotProps={{ htmlInput: { inputMode: 'email', autoComplete: 'off' } }} error={!!errors.email} helperText={errors.email?.message} />} />
          <Controller name="userCode" control={control} rules={{ required: 'User ID is required' }} render={({ field }) => <TextField {...field} label="User ID / roll number" error={!!errors.userCode} helperText={errors.userCode?.message} />} />
          <Controller name="role" control={control} render={({ field }) => (
            <TextField {...field} select label="Role" helperText="Roles are assigned only by administrators here. Users cannot choose or change their own role.">
              {(['student', 'faculty', 'admin'] as Role[]).map((r) => <MenuItem key={r} value={r}>{ROLE_LABEL[r]}</MenuItem>)}
            </TextField>
          )} />
          <Controller name="departmentId" control={control} rules={{ validate: (v) => role !== 'faculty' || !!v || 'Faculty must be scoped to a department' }} render={({ field }) => (
            <TextField {...field} select label={role === 'faculty' ? 'Department scope' : 'Department'} error={!!errors.departmentId} helperText={errors.departmentId?.message ?? (role === 'admin' ? 'Optional for administrators.' : undefined)}>
              <MenuItem value="">None</MenuItem>
              {departments.map((d) => <MenuItem key={d.value} value={d.value}>{d.label} — {d.name}</MenuItem>)}
            </TextField>
          )} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button type="submit" variant="contained" color="secondary" disabled={busy}>{busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}</Button>
      </DialogActions>
    </Dialog>
  );
}
