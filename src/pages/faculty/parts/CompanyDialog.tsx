import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { ApiError, type Company } from '@/types';
import { companiesApi } from '@/api';
import { useToast } from '@/components/Toast';

interface FV { name: string; website: string; industry: string; tier: Company['tier']; description: string; contactName: string; contactEmail: string; contactPhone: string }
const EMPTY: FV = { name: '', website: 'https://', industry: '', tier: 'regular', description: '', contactName: '', contactEmail: '', contactPhone: '' };

export function CompanyDialog({ open, company, onClose, onSaved }: { open: boolean; company?: Company; onClose: () => void; onSaved: (c: Company) => void }) {
  const toast = useToast();
  const [error, setError] = useState<string>();
  const { control, handleSubmit, reset, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<FV>({ defaultValues: EMPTY });
  useEffect(() => {
    if (open) { reset(company ? { ...EMPTY, ...company, contactPhone: company.contactPhone ?? '' } : EMPTY); setError(undefined); }
  }, [open, company, reset]);

  const submit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      const saved = await companiesApi.save({ id: company?.id, ...v, contactPhone: v.contactPhone || undefined });
      toast.success(company ? 'Company updated' : 'Company added');
      onSaved(saved);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save company';
      if (e instanceof ApiError && e.status === 409) setFieldError('name', { message: 'Already exists' });
      setError(msg);
    }
  });

  const text = (name: keyof FV, label: string, rules: object = {}, extra: object = {}) => (
    <Controller name={name} control={control} rules={rules} render={({ field }) => <TextField {...field} label={label} error={!!errors[name]} helperText={errors[name]?.message} {...extra} />} />
  );

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>{company ? `Edit ${company.name}` : 'Add company'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {text('name', 'Company name', { required: 'Company name is required' })}
          {text('website', 'Website', { required: 'Website is required', pattern: { value: /^https?:\/\/\S+\.\S+/, message: 'Enter a full URL, e.g. https://example.com' } })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {text('industry', 'Industry', { required: 'Industry is required' })}
            <Controller name="tier" control={control} render={({ field }) => (
              <TextField {...field} select label="Company tier">
                <MenuItem value="regular">Regular</MenuItem><MenuItem value="dream">Dream</MenuItem><MenuItem value="super_dream">Super Dream</MenuItem>
              </TextField>
            )} />
          </Stack>
          {text('description', 'Description', { required: 'Add a short description' }, { multiline: true, minRows: 3 })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {text('contactName', 'Contact name', { required: 'Contact name is required' })}
            {text('contactEmail', 'Contact email', { required: 'Contact email is required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } })}
          </Stack>
          {text('contactPhone', 'Contact phone (optional)')}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" variant="contained" color="secondary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save company'}</Button>
      </DialogActions>
    </Dialog>
  );
}
