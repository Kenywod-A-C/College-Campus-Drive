import { Box, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import type { ApplicationStatus, ApplicationStatusEntry } from '@/types';
import { fmtDateTime } from '@/utils/format';
import { APP_LABEL } from './ui';

const STEPS: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected', 'offer_received'];

/** Lifecycle: Applied → Shortlisted → Interview → Selected → Offer received (+ Rejected / Withdrawn as terminal states). */
export function ApplicationTimeline({ history, status }: { history: ApplicationStatusEntry[]; status: ApplicationStatus }) {
  const reached = new Map(history.map((h) => [h.status, h]));
  const terminal = status === 'rejected' || status === 'withdrawn' ? reached.get(status) : undefined;
  const lastIdx = Math.max(...history.map((h) => STEPS.indexOf(h.status)));
  const steps = terminal ? [...STEPS.slice(0, lastIdx + 1), status] : STEPS;

  return (
    <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label="Application progress">
      {steps.map((st, i) => {
        const h = reached.get(st);
        const isTerminal = st === 'rejected' || st === 'withdrawn';
        const current = st === status;
        return (
          <Stack component="li" key={st} direction="row" spacing={1.5} aria-current={current ? 'step' : undefined}>
            <Stack alignItems="center">
              {isTerminal ? (st === 'rejected' ? <CancelIcon color="error" /> : <RemoveCircleIcon color="disabled" />)
                : h ? <CheckCircleIcon color={current ? 'secondary' : 'success'} /> : <RadioButtonUncheckedIcon color="disabled" />}
              {i < steps.length - 1 && <Box sx={{ width: 2, flex: 1, minHeight: 22, bgcolor: h && !isTerminal ? 'success.main' : 'divider' }} />}
            </Stack>
            <Box sx={{ pb: 2 }}>
              <Typography variant="subtitle2" color={h || isTerminal ? 'text.primary' : 'text.disabled'}>{APP_LABEL[st]}{current ? ' · current' : ''}</Typography>
              {h && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{fmtDateTime(h.at)} · {h.by}</Typography>}
              {h?.note && <Typography variant="body2" color="text.secondary">{h.note}</Typography>}
              {!h && !isTerminal && <Typography variant="caption" color="text.disabled">Pending</Typography>}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
