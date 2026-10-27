import { Box, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpIcon from '@mui/icons-material/Help';
import type { EligibilityResult } from '@/types';
import { EligibilityBadge } from './ui';

export { EligibilityBadge };

/** Lists every eligibility check with its reason — each result is explained, never just "yes/no". */
export function EligibilityReasons({ result, showHeader = true, dense }: { result: EligibilityResult; showHeader?: boolean; dense?: boolean }) {
  return (
    <Box>
      {showHeader && (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
          <EligibilityBadge state={result.state} />
          <Typography variant="body2" color="text.secondary">{result.summary}</Typography>
        </Stack>
      )}
      <Stack component="ul" spacing={dense ? 0.75 : 1.25} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {result.checks.map((c) => (
          <Stack key={c.key} component="li" direction="row" spacing={1.25} alignItems="flex-start">
            {c.passed === true ? <CheckCircleIcon fontSize="small" color="success" titleAccess="Passed" /> : c.passed === false ? <CancelIcon fontSize="small" color="error" titleAccess="Failed" /> : <HelpIcon fontSize="small" color="warning" titleAccess="Cannot be determined" />}
            <Box>
              <Typography variant="body2" fontWeight={600}>{c.label}</Typography>
              <Typography variant="body2" color="text.secondary">{c.detail}</Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
      {result.exceptionGranted && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1.5, p: 1, bgcolor: '#fef3c7', borderRadius: 1 }}>
          Exception granted — {result.exceptionGranted.reason} (approved by {result.exceptionGranted.approvedBy})
        </Typography>
      )}
    </Box>
  );
}
