import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import type { ReportFilters } from '@/types/views';
import { reportsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { BarChartCard, FunnelCard, LineChartCard } from '@/components/Charts';
import { ReportFilterBar } from '@/components/ReportFilters';
import { useToast } from '@/components/Toast';
import { Grid, MetricCard, PageHeader, SectionCard } from '@/components/ui';
import { downloadText } from '@/utils/format';

/** Placement analytics. Rendered by both the faculty and admin layouts. */
export function PlacementReports() {
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<ReportFilters>({});
  const state = useAsync(() => reportsApi.placement(f), [JSON.stringify(f)]);
  const exportCsv = async () => {
    try { downloadText('placement-offers.csv', await reportsApi.exportPlacementCsv(f)); toast.success('Export downloaded'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
  };

  return (
    <>
      <PageHeader title="Placement reports" subtitle="Filter by batch, department, company, role and status."
        actions={can('reports.view') ? <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>Export offers CSV</Button> : undefined} />
      <ReportFilterBar value={f} onChange={setF} />
      <Async state={state}>
        {(d) => (
          <Stack spacing={2.5} sx={{ opacity: state.loading ? 0.65 : 1, transition: 'opacity .15s' }}>
            <Grid cols={{ xs: 1, sm: 2, lg: 5 }}>
              <MetricCard label="Placement percentage" value={`${d.kpis.placementPct}%`} hint={`${d.kpis.uniqueStudentsPlaced} of ${d.kpis.totalStudents} students`} tone="success" />
              <MetricCard label="Unique students placed" value={d.kpis.uniqueStudentsPlaced} hint="≥1 accepted offer" tone="success" />
              <MetricCard label="Total offers" value={d.kpis.totalOffers} hint="Every offer record" />
              <MetricCard label="Accepted offers" value={d.kpis.acceptedOffers} hint="Can exceed students placed" tone="purple" />
              <MetricCard label="Eligible vs applied" value={`${d.kpis.eligibleStudents} / ${d.kpis.appliedStudents}`} hint="Students eligible / who applied" tone="warning" />
            </Grid>
            <Alert severity="info" icon={false}>
              <Typography variant="body2"><b>Unique students placed</b> counts each student once if they hold at least one accepted offer. <b>Total offers</b> counts every offer issued, whatever its status. <b>Accepted offers</b> counts offers a student accepted, so one student with two accepted offers adds 1 to students placed and 2 to accepted offers.</Typography>
            </Alert>
            <Grid cols={{ xs: 1, lg: 2 }}>
              <BarChartCard title="Offers by department" subtitle="Total offers, accepted offers and unique students placed" data={d.offersByDept} xKey="dept"
                series={[{ key: 'offers', label: 'Total offers' }, { key: 'accepted', label: 'Accepted offers' }, { key: 'placedStudents', label: 'Unique students placed' }]} />
              <BarChartCard title="Company-wise offers" data={d.companyOffers} xKey="company" layout="vertical" series={[{ key: 'offers', label: 'Offers' }, { key: 'accepted', label: 'Accepted' }]} />
              <BarChartCard title="Eligible vs applied students" subtitle="By department" data={d.eligibleVsApplied} xKey="dept" series={[{ key: 'eligible', label: 'Eligible' }, { key: 'applied', label: 'Applied' }]} />
              <FunnelCard title="Application conversion funnel" subtitle="Students and applications reaching each stage" stages={d.funnel} />
            </Grid>
            <LineChartCard title="Monthly hiring trend" subtitle="Applications submitted and offers issued per month" data={d.monthly} xKey="month" series={[{ key: 'applications', label: 'Applications' }, { key: 'offers', label: 'Offers' }]} />
            <SectionCard title="Application status distribution" noPad>
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={3} sx={{ p: 2.5, pt: 0 }}>
                {d.statusDist.map((s) => <Stack key={s.status}><Typography variant="h3" component="p">{s.count}</Typography><Typography variant="caption" color="text.secondary">{s.status}</Typography></Stack>)}
              </Stack>
            </SectionCard>
          </Stack>
        )}
      </Async>
    </>
  );
}
