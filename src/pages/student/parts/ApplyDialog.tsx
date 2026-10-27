import { Alert, Box, Stack, Typography } from '@mui/material';
import type { JobView } from '@/types/views';
import { applicationsApi } from '@/api';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CompanyLogo, EligibilityBadge } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { deadlineText, fmtDate } from '@/utils/format';

/** Confirmation step before submitting an application. The backend re-validates eligibility and deadline. */
export function ApplyDialog({ view, onClose, onApplied }: { view: JobView | null; onClose: () => void; onApplied: () => void }) {
  const toast = useToast();
  const ok = view?.eligibility?.state === 'eligible';
  return (
    <ConfirmDialog
      open={!!view}
      title="Submit application?"
      confirmLabel={ok ? 'Submit application' : 'Not eligible'}
      onClose={onClose}
      onConfirm={async () => {
        if (!view) return;
        if (!ok) throw new Error(view.eligibility?.summary ?? 'You are not eligible for this job.');
        await applicationsApi.apply(view.job.id);
        toast.success(`Application submitted to ${view.company.name}`);
        onApplied();
      }}
    >
      {view && (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CompanyLogo company={view.company} />
            <Box>
              <Typography fontWeight={600}>{view.job.title}</Typography>
              <Typography variant="body2" color="text.secondary">{view.company.name} · {view.job.location}</Typography>
            </Box>
          </Stack>
          <Typography variant="body2">Deadline: <b>{fmtDate(view.job.deadline)}</b> ({deadlineText(view.job.deadline)})</Typography>
          <Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2">Eligibility:</Typography>{view.eligibility && <EligibilityBadge state={view.eligibility.state} />}</Stack>
          {ok
            ? <Alert severity="info">Your profile details at this moment are saved with the application. Eligibility is checked again by the placement system when you submit.</Alert>
            : <Alert severity="warning">{view.eligibility?.summary}</Alert>}
        </Stack>
      )}
    </ConfirmDialog>
  );
}
