import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Divider, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { applicationsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { ApplicationStatusChip, CompanyLogo, Grid, InterviewStatusChip, KeyValue, OfferStatusChip, PageHeader, SectionCard } from '@/components/ui';
import { Async, EmptyState } from '@/components/feedback';
import { ApplicationTimeline } from '@/components/ApplicationTimeline';
import { EligibilityReasons } from '@/components/Eligibility';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useDeptName } from '@/hooks/useDeptName';
import { fmtDate, fmtDateTime, fmtLpa, timeAgo } from '@/utils/format';

export function StudentApplicationDetail() {
  const deptName = useDeptName();
  const { applicationId = '' } = useParams();
  const toast = useToast();
  const state = useAsync(() => applicationsApi.get(applicationId), [applicationId]);
  const [withdraw, setWithdraw] = useState(false);

  return (
    <Async state={state}>
      {({ application: a, job, company, interviews, notifications, offer }) => {
        const canWithdraw = ['applied', 'shortlisted', 'interview'].includes(a.status);
        const r = job.eligibility;
        return (
          <>
            <PageHeader
              title={`${company.name} — ${job.title}`}
              crumbs={[{ label: 'My Applications', to: '/student/applications' }, { label: job.title }]}
              subtitle={<Stack direction="row" spacing={1} alignItems="center"><ApplicationStatusChip status={a.status} /><span>Applied {fmtDate(a.appliedAt)} · updated {timeAgo(a.updatedAt)}</span></Stack>}
              actions={<>
                <Button component={RouterLink} to={`/student/jobs/${job.id}`} color="inherit" variant="outlined">View job</Button>
                {canWithdraw && <Button color="error" variant="outlined" onClick={() => setWithdraw(true)}>Withdraw</Button>}
              </>}
            />
            <Grid cols={{ xs: 1, lg: 'minmax(0,1fr) minmax(0,1.4fr)' }} gap={2.5}>
              <Stack spacing={2.5}>
                <SectionCard title="Progress"><ApplicationTimeline history={a.history} status={a.status} /></SectionCard>
                {offer && (
                  <SectionCard title="Offer" action={<Button size="small" component={RouterLink} to="/student/offers">Open offers</Button>}>
                    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                      <OfferStatusChip status={offer.status} /><Typography variant="body2">{fmtLpa(offer.ctcLpa)} · respond by {fmtDate(offer.acceptBy)}</Typography>
                    </Stack>
                  </SectionCard>
                )}
              </Stack>
              <Stack spacing={2.5}>
                <SectionCard title="Interview schedule">
                  {interviews.length === 0 ? <EmptyState title="No interviews scheduled" message={a.status === 'applied' ? 'You will be notified once you are shortlisted.' : 'Nothing has been scheduled for this application.'} /> : (
                    <Stack spacing={1.5} divider={<Divider />}>
                      {interviews.map((i) => (
                        <Stack key={i.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                          <Box><Typography fontWeight={600}>{i.round}</Typography><Typography variant="body2" color="text.secondary">{fmtDateTime(i.at)} · {i.durationMins} min</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{i.location}</Typography></Box>
                          <InterviewStatusChip status={i.status} />
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </SectionCard>
                <SectionCard title="Eligibility snapshot" subtitle={`Evaluated when you applied · ${fmtDateTime(a.eligibilitySnapshot.evaluatedAt)}`}>
                  <EligibilityReasons result={a.eligibilitySnapshot} />
                </SectionCard>
                <SectionCard title="Job details">
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}><CompanyLogo company={company} size={36} /><Box><Typography fontWeight={600}>{job.title}</Typography><Typography variant="body2" color="text.secondary">{company.name}</Typography></Box></Stack>
                  <Grid cols={{ xs: 1, sm: 2 }}>
                    <KeyValue label="Location & type">{job.location} · {job.type}</KeyValue>
                    <KeyValue label="Package">{job.ctcLpa != null ? fmtLpa(job.ctcLpa) : '—'}</KeyValue>
                    <KeyValue label="Deadline">{fmtDate(job.deadline)}</KeyValue>
                    <KeyValue label="Hiring drive">{fmtDate(job.driveDate)}</KeyValue>
                    <KeyValue label="Criteria">CGPA {r.minCgpa.toFixed(1)}+ · {r.maxActiveArrears === 0 ? 'no active arrears' : `≤ ${r.maxActiveArrears} arrear(s)`}</KeyValue>
                    <KeyValue label="Departments">{r.departmentIds.map(deptName).join(', ')}</KeyValue>
                  </Grid>
                </SectionCard>
                <SectionCard title="Status history">
                  <List dense disablePadding>
                    {[...a.history].reverse().map((h, i) => (
                      <ListItem key={i} disableGutters><ListItemText primary={<Stack direction="row" spacing={1} alignItems="center"><ApplicationStatusChip status={h.status} /><Typography variant="caption" color="text.secondary">{fmtDateTime(h.at)} · {h.by}</Typography></Stack>} secondary={h.note} /></ListItem>
                    ))}
                  </List>
                </SectionCard>
                <SectionCard title="Related notifications">
                  {notifications.length === 0 ? <Typography variant="body2" color="text.secondary">No notifications for this application.</Typography> : (
                    <Stack spacing={1.25}>{notifications.map((n) => <Box key={n.id}><Typography variant="body2" fontWeight={600}>{n.title}</Typography><Typography variant="body2" color="text.secondary">{n.body} · {timeAgo(n.at)}</Typography></Box>)}</Stack>
                  )}
                </SectionCard>
              </Stack>
            </Grid>
            <ConfirmDialog open={withdraw} title="Withdraw application?" confirmLabel="Withdraw" tone="error" onClose={() => setWithdraw(false)} onConfirm={async () => { await applicationsApi.withdraw(a.id); toast.success('Application withdrawn'); state.reload(); }}>
              <Alert severity="warning">You are withdrawing from <b>{company.name} — {job.title}</b>. This cannot be undone and may stop you re-applying if the deadline has passed.</Alert>
            </ConfirmDialog>
          </>
        );
      }}
    </Async>
  );
}
