import { Typography } from '@mui/material';
import type { Job, JobStatus, Permission } from '@/types';
import { jobsApi } from '@/api';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { fmtDate } from '@/utils/format';

export type JobAction = 'publish' | 'unpublish' | 'close' | 'cancel' | 'reopen' | 'archive' | 'unarchive';
export interface JobActionTarget { job: Job; action: JobAction }

export const ACTION_LABEL: Record<JobAction, string> = { publish: 'Publish', unpublish: 'Unpublish', close: 'Close applications', cancel: 'Cancel job', reopen: 'Reopen', archive: 'Archive', unarchive: 'Restore' };
const TARGET: Partial<Record<JobAction, JobStatus>> = { publish: 'published', unpublish: 'draft', close: 'closed', cancel: 'cancelled', reopen: 'published' };
const DONE: Record<JobAction, string> = { publish: 'published', unpublish: 'moved back to draft', close: 'closed', cancel: 'cancelled', reopen: 'reopened', archive: 'archived', unarchive: 'restored' };

/** Lifecycle actions permitted for a job's current status (mirrors the server's transition table). */
export function actionsFor(job: Job, can: (p: Permission) => boolean): JobAction[] {
  if (!can('drives.publish')) return [];
  if (job.archivedAt) return ['unarchive'];
  switch (job.status) {
    case 'draft': return ['publish', 'cancel', 'archive'];
    case 'published': return ['close', 'unpublish', 'cancel'];
    case 'closed': return ['reopen', 'archive'];
    default: return ['archive']; // cancelled
  }
}
export const canEditJob = (job: Job, can: (p: Permission) => boolean) => can('jobs.create') && !job.archivedAt && (job.status === 'draft' || job.status === 'published');

export function JobActionDialog({ target, onClose, onDone }: { target?: JobActionTarget; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const job = target?.job;
  const action = target?.action;
  return (
    <ConfirmDialog
      open={!!target}
      title={action ? `${ACTION_LABEL[action]}: ${job!.title}` : ''}
      confirmLabel={action ? ACTION_LABEL[action] : 'Confirm'}
      tone={action === 'cancel' ? 'error' : action === 'close' || action === 'unpublish' ? 'warning' : 'primary'}
      requireReason={action === 'cancel'}
      reasonLabel="Reason for cancelling"
      onClose={onClose}
      onConfirm={async (reason) => {
        if (action === 'archive' || action === 'unarchive') await jobsApi.archive(job!.id, action === 'archive');
        else await jobsApi.setStatus(job!.id, TARGET[action!]!, reason);
        toast.success(`${job!.title} ${DONE[action!]}`);
        onDone();
      }}
    >
      {action === 'publish' || action === 'reopen' ? <Typography variant="body2">Students in eligible departments will see this job and can apply until <b>{fmtDate(job!.deadline)}</b>. Eligibility is re-checked on every application.</Typography> : null}
      {action === 'close' ? <Typography variant="body2">No new applications will be accepted. Existing applications are kept and can still progress through the stages.</Typography> : null}
      {action === 'unpublish' ? <Typography variant="body2">The job goes back to draft and students can no longer see it. This is only possible while nobody has applied; otherwise close it instead.</Typography> : null}
      {action === 'archive' ? <Typography variant="body2">The job is hidden from the default lists. Applications, interviews and offers are kept, and you can restore it at any time.</Typography> : null}
      {action === 'unarchive' ? <Typography variant="body2">The job returns to the default lists with its previous status.</Typography> : null}
      {action === 'cancel' ? <Typography variant="body2">The drive is cancelled and active applicants are notified with your reason. This cannot be undone.</Typography> : null}
    </ConfirmDialog>
  );
}
