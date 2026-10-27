import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Breadcrumbs, Card, CardContent, Chip, Link, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import type { ApplicationStatus, Company, DocumentRecord, EligibilityState, InterviewStatus, JobStatus, OfferStatus } from '@/types';
import { titleCase } from '@/utils/format';
import { USE_MOCK } from '@/services/config';

// ---------- Status chips ----------
type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: '#dcfce7', fg: '#166534' },
  warning: { bg: '#fef3c7', fg: '#92400e' },
  error: { bg: '#fee2e2', fg: '#991b1b' },
  info: { bg: '#dbeafe', fg: '#1e40af' },
  neutral: { bg: '#eef2f7', fg: '#475569' },
  purple: { bg: '#ede9fe', fg: '#5b21b6' },
};
export function StatusChip({ label, tone = 'neutral', icon, size = 'small' }: { label: string; tone?: Tone; icon?: ReactNode; size?: 'small' | 'medium' }) {
  const t = TONES[tone];
  return <Chip size={size} label={label} icon={icon as never} sx={{ bgcolor: t.bg, color: t.fg, '& .MuiChip-icon': { color: t.fg } }} />;
}

const APP_TONE: Record<ApplicationStatus, Tone> = { applied: 'info', shortlisted: 'purple', interview: 'warning', selected: 'success', offer_received: 'success', rejected: 'error', withdrawn: 'neutral' };
export const APP_LABEL: Record<ApplicationStatus, string> = { applied: 'Applied', shortlisted: 'Shortlisted', interview: 'Interview', selected: 'Selected', offer_received: 'Offer received', rejected: 'Rejected', withdrawn: 'Withdrawn' };
export const ApplicationStatusChip = ({ status }: { status: ApplicationStatus }) => <StatusChip label={APP_LABEL[status]} tone={APP_TONE[status]} />;

const OFFER_TONE: Record<OfferStatus, Tone> = { pending: 'neutral', received: 'info', accepted: 'success', declined: 'neutral', withdrawn: 'error' };
export const OfferStatusChip = ({ status }: { status: OfferStatus }) => <StatusChip label={titleCase(status)} tone={OFFER_TONE[status]} />;

const JOB_TONE: Record<JobStatus, Tone> = { draft: 'neutral', published: 'success', closed: 'warning', cancelled: 'error' };
export const JobStatusChip = ({ status }: { status: JobStatus }) => <StatusChip label={titleCase(status)} tone={JOB_TONE[status]} />;

const INT_TONE: Record<InterviewStatus, Tone> = { scheduled: 'info', completed: 'success', cancelled: 'error', no_show: 'warning' };
export const InterviewStatusChip = ({ status }: { status: InterviewStatus }) => <StatusChip label={titleCase(status)} tone={INT_TONE[status]} />;

const PROC_TONE: Record<DocumentRecord['processing'], Tone> = { queued: 'neutral', processing: 'info', indexed: 'success', failed: 'error' };
export const ProcessingChip = ({ status }: { status: DocumentRecord['processing'] }) => <StatusChip label={status === 'indexed' ? 'Ready' : titleCase(status)} tone={PROC_TONE[status]} />;

const ELIG: Record<EligibilityState, { label: string; tone: Tone }> = {
  eligible: { label: 'Eligible', tone: 'success' },
  not_eligible: { label: 'Not eligible', tone: 'error' },
  profile_incomplete: { label: 'Profile incomplete', tone: 'warning' },
  needs_verification: { label: 'Needs verification', tone: 'warning' },
};
export const EligibilityBadge = ({ state, size }: { state: EligibilityState; size?: 'small' | 'medium' }) => <StatusChip label={ELIG[state].label} tone={ELIG[state].tone} size={size} />;

export const TierChip = ({ tier }: { tier: Company['tier'] }) => <StatusChip label={tier === 'super_dream' ? 'Super Dream' : tier === 'dream' ? 'Dream' : 'Regular'} tone={tier === 'regular' ? 'neutral' : tier === 'dream' ? 'info' : 'purple'} />;
export const PlacementChip = ({ status }: { status: string }) => <StatusChip label={status === 'in_process' ? 'In process' : status === 'opted_out' ? 'Opted out' : titleCase(status)} tone={status === 'placed' ? 'success' : status === 'in_process' ? 'info' : status === 'opted_out' ? 'warning' : 'neutral'} />;

// ---------- Company logo (placeholder tile; real deployment would serve uploaded logo) ----------
export function CompanyLogo({ company, size = 44 }: { company: Pick<Company, 'name' | 'color'>; size?: number }) {
  const initials = company.name.replace(/[^A-Za-z&]/g, '').slice(0, 2).toUpperCase();
  return (
    <Box aria-hidden sx={{ width: size, height: size, borderRadius: 2.5, bgcolor: company.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size * 0.34, flexShrink: 0 }}>
      {initials}
    </Box>
  );
}

// ---------- Layout primitives ----------
export interface Crumb { label: string; to?: string }
export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="Breadcrumb" sx={{ mb: 1, fontSize: 13 }}>
          {crumbs.map((c, i) => c.to && i < crumbs.length - 1
            ? <Link key={c.label} component={RouterLink} to={c.to} underline="hover" color="text.secondary">{c.label}</Link>
            : <Typography key={c.label} variant="body2" color="text.primary" fontWeight={600}>{c.label}</Typography>)}
        </Breadcrumbs>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
          {subtitle && <Typography component="div" color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
        </Box>
        {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>{actions}</Stack>}
      </Stack>
    </Box>
  );
}

export function MetricCard({ label, value, icon, hint, tone = 'info', onClick, to }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode; tone?: Tone; onClick?: () => void; to?: string }) {
  const t = TONES[tone];
  const content = (
    <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', '&:last-child': { pb: 2 } }}>
      {icon && <Box aria-hidden sx={{ width: 44, height: 44, borderRadius: 2.5, bgcolor: t.bg, color: t.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</Box>}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" noWrap>{label}</Typography>
        <Typography variant="h2" component="p" sx={{ lineHeight: 1.2 }}>{value}</Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </Box>
    </CardContent>
  );
  const clickable = !!(onClick || to);
  return (
    <Card sx={clickable ? { '&:hover': { borderColor: 'secondary.main' } } : undefined}>
      {clickable ? (
        <Box component={to ? RouterLink : 'button'} {...(to ? { to } : { onClick, type: 'button' })} sx={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', borderRadius: 'inherit', '&:focus-visible': { outline: '2px solid #2563eb' } }}>
          {content}
        </Box>
      ) : content}
    </Card>
  );
}

export function SectionCard({ title, subtitle, action, children, sx, noPad }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; sx?: SxProps<Theme>; noPad?: boolean }) {
  return (
    <Card sx={sx}>
      {(title || action) && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ px: 2.5, pt: 2, pb: noPad ? 1.5 : 0 }}>
          <Box sx={{ minWidth: 0 }}>
            {title && <Typography variant="h4" component="h2">{title}</Typography>}
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {action}
        </Stack>
      )}
      {noPad ? children : <CardContent sx={{ pt: title ? 1.5 : 2.5 }}>{children}</CardContent>}
    </Card>
  );
}

export const Grid = ({ cols, children, gap = 2, sx }: { cols: Record<string, number | string> | number; children: ReactNode; gap?: number; sx?: SxProps<Theme> }) => {
  const tpl = typeof cols === 'number' ? { xs: `repeat(${cols}, minmax(0, 1fr))` } : Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, typeof v === 'number' ? `repeat(${v}, minmax(0, 1fr))` : v]));
  return <Box sx={{ display: 'grid', gap, gridTemplateColumns: tpl, ...(sx as object) }}>{children}</Box>;
};

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography variant="body2" component="div" fontWeight={500}>{children ?? '—'}</Typography>
    </Box>
  );
}

export const DemoBanner = () => !USE_MOCK ? null : (
  <Box role="note" sx={{ bgcolor: '#fff7ed', color: '#9a3412', borderBottom: '1px solid #fed7aa', px: 2, py: 0.5, fontSize: 12.5, textAlign: 'center' }}>
    Demo data — all records are fictional. Authentication, AI, email and document parsing are simulated by a mock API.
  </Box>
);
