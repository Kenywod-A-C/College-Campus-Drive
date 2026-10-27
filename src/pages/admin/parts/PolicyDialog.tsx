import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import type { PlacementPolicy } from '@/types';
import { adminApi } from '@/api';
import { useToast } from '@/components/Toast';

export const KIND_LABEL: Record<PlacementPolicy['kind'], string> = {
  max_offers: 'Maximum offer rule', tier_restriction: 'Dream / Super Dream restriction', application_limit: 'Application restriction', accepted_offer: 'Accepted-offer rule', exception_approval: 'Exception approval',
};
export const SCOPE_LABEL: Record<PlacementPolicy['scope'], string> = { college: 'Whole college', department: 'Department', academic_year: 'Academic year (batch)' };

interface Form {
  name: string; description: string; kind: PlacementPolicy['kind']; scope: PlacementPolicy['scope']; scopeValue: string; enabled: boolean;
  maxAcceptedOffers: string; allowOnlyHigherTier: boolean; maxActiveApplications: string; acceptanceWindowDays: string; requireReason: boolean; requireApprover: boolean;
}
const blank: Form = { name: '', description: '', kind: 'max_offers', scope: 'college', scopeValue: '', enabled: true, maxAcceptedOffers: '2', allowOnlyHigherTier: true, maxActiveApplications: '8', acceptanceWindowDays: '14', requireReason: true, requireApprover: true };
const num = (v: string, min = 1) => (v !== '' && Number.isInteger(Number(v)) && Number(v) >= min) || `Enter a whole number of at least ${min}`;

interface Props { open: boolean; policy?: PlacementPolicy; departments: { value: string; label: string }[]; years: { value: string; label: string }[]; onClose: () => void; onSaved: () => void }

export function PolicyDialog({ open, policy, departments, years, onClose, onSaved }: Props) {
  const toast = useToast();
  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<Form>({ defaultValues: blank });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const kind = watch('kind');
  const scope = watch('scope');

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    const p = policy?.params ?? {};
    reset(policy ? { ...blank, name: policy.name, description: policy.description, kind: policy.kind, scope: policy.scope, scopeValue: policy.scopeValue ?? '', enabled: policy.enabled,
      maxAcceptedOffers: String(p.maxAcceptedOffers ?? blank.maxAcceptedOffers), allowOnlyHigherTier: Boolean(p.allowOnlyHigherTier ?? true), maxActiveApplications: String(p.maxActiveApplications ?? blank.maxActiveApplications),
      acceptanceWindowDays: String(p.acceptanceWindowDays ?? blank.acceptanceWindowDays), requireReason: Boolean(p.requireReason ?? true), requireApprover: Boolean(p.requireApprover ?? true) } : blank);
  }, [open, policy, reset]);

  const submit = handleSubmit(async (v) => {
    const params: PlacementPolicy['params'] =
      v.kind === 'max_offers' ? { maxAcceptedOffers: Number(v.maxAcceptedOffers) }
      : v.kind === 'tier_restriction' ? { allowOnlyHigherTier: v.allowOnlyHigherTier }
      : v.kind === 'application_limit' ? { maxActiveApplications: Number(v.maxActiveApplications) }
      : v.kind === 'accepted_offer' ? { acceptanceWindowDays: Number(v.acceptanceWindowDays) }
      : { requireReason: v.requireReason, requireApprover: v.requireApprover };
    setBusy(true); setError(undefined);
    try {
      await adminApi.savePolicy({ id: policy?.id, name: v.name.trim(), description: v.description.trim(), kind: v.kind, scope: v.scope, scopeValue: v.scope === 'college' ? undefined : v.scopeValue, params, enabled: v.enabled });
      toast.success(policy ? 'Policy updated' : 'Policy created'); onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save policy'); }
    finally { setBusy(false); }
  });

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit} aria-labelledby="policy-title">
      <DialogTitle id="policy-title">{policy ? 'Edit policy' : 'Add policy'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          <Controller name="name" control={control} rules={{ required: 'Name is required' }} render={({ field }) => <TextField {...field} label="Policy name" error={!!errors.name} helperText={errors.name?.message} />} />
          <Controller name="description" control={control} render={({ field }) => <TextField {...field} label="Description" multiline minRows={2} />} />
          <Controller name="kind" control={control} render={({ field }) => (
            <TextField {...field} select label="Policy type" disabled={!!policy}>{Object.entries(KIND_LABEL).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}</TextField>
          )} />
          {kind === 'max_offers' && <Controller name="maxAcceptedOffers" control={control} rules={{ validate: (v) => num(v) }} render={({ field }) => <TextField {...field} type="number" label="Maximum accepted offers" error={!!errors.maxAcceptedOffers} helperText={errors.maxAcceptedOffers?.message} />} />}
          {kind === 'application_limit' && <Controller name="maxActiveApplications" control={control} rules={{ validate: (v) => num(v) }} render={({ field }) => <TextField {...field} type="number" label="Maximum active applications per student" error={!!errors.maxActiveApplications} helperText={errors.maxActiveApplications?.message} />} />}
          {kind === 'accepted_offer' && <Controller name="acceptanceWindowDays" control={control} rules={{ validate: (v) => num(v) }} render={({ field }) => <TextField {...field} type="number" label="Acceptance window (days)" error={!!errors.acceptanceWindowDays} helperText={errors.acceptanceWindowDays?.message} />} />}
          {kind === 'tier_restriction' && <Controller name="allowOnlyHigherTier" control={control} render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="After accepting an offer, allow applications to a higher company tier only" />} />}
          {kind === 'exception_approval' && (
            <Stack>
              <Controller name="requireReason" control={control} render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Require a written reason" />} />
              <Controller name="requireApprover" control={control} render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Require an approving faculty member" />} />
            </Stack>
          )}
          <Controller name="scope" control={control} render={({ field }) => <TextField {...field} select label="Applies to">{Object.entries(SCOPE_LABEL).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}</TextField>} />
          {scope !== 'college' && (
            <Controller name="scopeValue" control={control} rules={{ required: scope === 'department' ? 'Choose a department' : 'Choose a batch' }} render={({ field }) => (
              <TextField {...field} select label={scope === 'department' ? 'Department' : 'Graduation year'} error={!!errors.scopeValue} helperText={errors.scopeValue?.message}>
                {(scope === 'department' ? departments : years).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            )} />
          )}
          <Controller name="enabled" control={control} render={({ field }) => <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Policy is enabled" />} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button type="submit" variant="contained" color="secondary" disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</Button>
      </DialogActions>
    </Dialog>
  );
}
