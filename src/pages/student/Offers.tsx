import { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { OfferView } from '@/types/views';
import { offersApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { CompanyLogo, Grid, KeyValue, OfferStatusChip, PageHeader, SectionCard } from '@/components/ui';
import { Async, EmptyState } from '@/components/feedback';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { daysUntil, fmtDate, fmtLpa } from '@/utils/format';

export function StudentOffers() {
  const toast = useToast();
  const offers = useAsync(() => offersApi.listMine(), []);
  const policies = useAsync(() => offersApi.policySummary(), []);
  const [pending, setPending] = useState<{ view: OfferView; decision: 'accepted' | 'declined' } | null>(null);

  return (
    <>
      <PageHeader title="My Offers" subtitle="Official offers recorded by the placement cell." />
      <Alert severity="info" sx={{ mb: 2.5 }}>Offer details are maintained by the placement cell and are read-only here. You can only respond to an offer (accept or decline) before its deadline; the placement policy is checked when you respond.</Alert>
      <Grid cols={{ xs: 1, lg: 'minmax(0,2fr) minmax(0,1fr)' }} gap={2.5}>
        <Async state={offers}>
          {(list) => list.length === 0 ? (
            <SectionCard><EmptyState title="No offers yet" message="Offers appear here after you are selected and the placement cell issues an official offer." /></SectionCard>
          ) : (
            <Stack spacing={2}>
              {list.map((v) => {
                const { offer: o, company, job } = v;
                const days = daysUntil(o.acceptBy);
                return (
                  <SectionCard key={o.id}>
                    <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                        <CompanyLogo company={company} />
                        <Box sx={{ minWidth: 0 }}><Typography variant="h5" component="h3">{job.title}</Typography><Typography variant="body2" color="text.secondary">{company.name}</Typography></Box>
                      </Stack>
                      <OfferStatusChip status={o.status} />
                    </Stack>
                    <Grid cols={{ xs: 2, sm: 3 }} sx={{ mt: 2.5 }}>
                      <KeyValue label="Compensation">{fmtLpa(o.ctcLpa)}</KeyValue>
                      <KeyValue label="Offer date">{fmtDate(o.offeredAt)}</KeyValue>
                      <KeyValue label="Accept by">{fmtDate(o.acceptBy)}{o.status === 'received' && <Typography component="span" variant="caption" color={days <= 3 ? 'error' : 'text.secondary'}> · {days < 0 ? 'expired' : `${days}d left`}</Typography>}</KeyValue>
                    </Grid>
                    <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 1 }}>Policy checks at issue</Typography>
                    <Stack spacing={0.75}>
                      {o.policyChecks.map((c) => (
                        <Stack key={c.label} direction="row" spacing={1} alignItems="flex-start">
                          {c.passed ? <CheckCircleOutlineIcon fontSize="small" color="success" titleAccess="Passed" /> : <ErrorOutlineIcon fontSize="small" color="error" titleAccess="Failed" />}
                          <Typography variant="body2"><b>{c.label}.</b> <Typography component="span" variant="body2" color="text.secondary">{c.detail}</Typography></Typography>
                        </Stack>
                      ))}
                    </Stack>
                    {o.status === 'received' && (
                      <Stack direction="row" spacing={1} sx={{ mt: 2.5 }}>
                        <Button variant="contained" color="secondary" disabled={days < 0} onClick={() => setPending({ view: v, decision: 'accepted' })}>Accept offer</Button>
                        <Button variant="outlined" color="inherit" disabled={days < 0} onClick={() => setPending({ view: v, decision: 'declined' })}>Decline</Button>
                      </Stack>
                    )}
                  </SectionCard>
                );
              })}
            </Stack>
          )}
        </Async>
        <SectionCard title="Placement policies" subtitle="Configured by your college">
          <Async state={policies} skeleton={<Typography variant="body2" color="text.secondary">Loading policies…</Typography>}>
            {(list) => list.length === 0 ? <Typography variant="body2" color="text.secondary">No offer-related policies are currently active.</Typography> : (
              <Stack spacing={2}>{list.map((p) => <Box key={p.id}><Typography variant="subtitle2">{p.name}</Typography><Typography variant="body2" color="text.secondary">{p.description}</Typography></Box>)}</Stack>
            )}
          </Async>
        </SectionCard>
      </Grid>
      <ConfirmDialog
        open={!!pending} tone={pending?.decision === 'declined' ? 'error' : 'primary'} confirmLabel={pending?.decision === 'accepted' ? 'Accept offer' : 'Decline offer'}
        title={pending?.decision === 'accepted' ? 'Accept this offer?' : 'Decline this offer?'} onClose={() => setPending(null)}
        onConfirm={async () => { await offersApi.respond(pending!.view.offer.id, pending!.decision); toast.success(`Offer ${pending!.decision}`); offers.reload(); }}
      >
        {pending && <Typography variant="body2">{pending.view.company.name} — {pending.view.job.title} ({fmtLpa(pending.view.offer.ctcLpa)}). Your response is recorded immediately and the placement policy is checked. {pending.decision === 'accepted' ? 'Accepting may restrict which other companies you can apply to.' : 'You cannot undo a decline.'}</Typography>}
      </ConfirmDialog>
    </>
  );
}
