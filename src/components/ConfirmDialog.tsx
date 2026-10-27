import { useState, type ReactNode } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'error' | 'warning';
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason?: string) => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'primary', requireReason, reasonLabel = 'Reason', onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();

  const submit = async () => {
    if (requireReason && !reason.trim()) { setErr(`${reasonLabel} is required.`); return; }
    setBusy(true); setErr(undefined);
    try { await onConfirm(requireReason ? reason.trim() : undefined); setReason(''); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy) { setErr(undefined); setReason(''); onClose(); } };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby="confirm-title">
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent>
        {children && <DialogContentText component="div" sx={{ color: 'text.primary' }}>{children}</DialogContentText>}
        {requireReason && (
          <TextField autoFocus multiline minRows={2} label={reasonLabel} value={reason} onChange={(e) => { setReason(e.target.value); setErr(undefined); }} sx={{ mt: 2 }} error={!!err && !reason.trim()} />
        )}
        {err && <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} disabled={busy} color="inherit">Cancel</Button>
        <Button onClick={submit} disabled={busy} variant="contained" color={tone === 'primary' ? 'secondary' : tone}>{busy ? 'Working…' : confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
