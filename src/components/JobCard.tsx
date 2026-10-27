import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardActions, CardContent, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import type { JobView } from '@/types/views';
import { deadlineText, deadlineTone, fmtDate, fmtLpa, fmtStipend } from '@/utils/format';
import { ApplicationStatusChip, CompanyLogo, EligibilityBadge, JobStatusChip } from './ui';

interface Props {
  view: JobView;
  base: '/student' | '/faculty' | '/admin';
  onApply?: (v: JobView) => void;
  onSave?: (v: JobView) => void;
  compact?: boolean;
}

export function JobCard({ view, base, onApply, onSave, compact }: Props) {
  const { job, company, eligibility } = view;
  const open = job.status === 'published' && new Date(job.deadline) > new Date();
  const canApply = !!eligibility && eligibility.state === 'eligible' && open && !view.applicationId;
  const tone = deadlineTone(job.deadline);
  const detail = `${base}/jobs/${job.id}`;

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <CompanyLogo company={company} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{company.name}</Typography>
            <Typography variant="h5" component="h3" sx={{ lineHeight: 1.3 }}>{job.title}</Typography>
          </Box>
          {onSave && (
            <Tooltip title={view.saved ? 'Remove from saved' : 'Save job'}>
              <IconButton size="small" onClick={() => onSave(view)} aria-label={view.saved ? `Unsave ${job.title}` : `Save ${job.title}`} aria-pressed={!!view.saved}>
                {view.saved ? <BookmarkIcon color="secondary" /> : <BookmarkBorderIcon />}
              </IconButton>
            </Tooltip>
          )}
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          {eligibility ? <EligibilityBadge state={eligibility.state} /> : <JobStatusChip status={job.status} />}
          {view.applicationStatus && <ApplicationStatusChip status={view.applicationStatus} />}
          {tone !== 'default' && <Chip size="small" color={tone} variant="outlined" label={deadlineText(job.deadline)} />}
        </Stack>

        <Stack spacing={0.75} sx={{ mt: 1.75, color: 'text.secondary' }}>
          <Stack direction="row" spacing={1} alignItems="center"><PlaceOutlinedIcon sx={{ fontSize: 16 }} /><Typography variant="body2">{job.location} · {job.type}</Typography></Stack>
          <Stack direction="row" spacing={1} alignItems="center"><WorkOutlineIcon sx={{ fontSize: 16 }} /><Typography variant="body2">{job.ctcLpa != null ? fmtLpa(job.ctcLpa) : fmtStipend(job.stipendPerMonth)}</Typography></Stack>
          <Stack direction="row" spacing={1} alignItems="center"><EventOutlinedIcon sx={{ fontSize: 16 }} /><Typography variant="body2">Apply by {fmtDate(job.deadline)}{job.driveDate ? ` · Drive ${fmtDate(job.driveDate)}` : ''}</Typography></Stack>
        </Stack>

        {!compact && (
          <>
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              <b>Min CGPA</b> {job.eligibility.minCgpa.toFixed(1)} · <b>Arrears</b> {job.eligibility.maxActiveArrears === 0 ? 'none allowed' : `up to ${job.eligibility.maxActiveArrears}`}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {view.eligibleDepartments.length >= 7 ? 'All departments' : view.eligibleDepartments.join(', ')}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
              {job.skills.slice(0, 4).map((s) => <Chip key={s} size="small" variant="outlined" label={s} />)}
              {job.skills.length > 4 && <Chip size="small" variant="outlined" label={`+${job.skills.length - 4}`} />}
            </Stack>
          </>
        )}
        {eligibility && eligibility.state !== 'eligible' && !compact && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{eligibility.summary}</Typography>
        )}
        {view.applicantCount != null && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{view.applicantCount} applicant(s)</Typography>}
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2, pt: 0, gap: 1 }}>
        <Button component={RouterLink} to={detail} variant="outlined" color="primary" size="small">View details</Button>
        {onApply && (
          <Button variant="contained" color="secondary" size="small" disabled={!canApply} onClick={() => onApply(view)}>
            {view.applicationId ? 'Applied' : !open ? 'Closed' : 'Apply'}
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
