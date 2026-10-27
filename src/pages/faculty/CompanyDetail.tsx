import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import type { Job } from '@/types';
import { companiesApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { Async } from '@/components/feedback';
import { DataTable, type Column } from '@/components/DataTable';
import { CompanyLogo, Grid, JobStatusChip, KeyValue, MetricCard, PageHeader, SectionCard, TierChip } from '@/components/ui';
import { fmtDate, fmtLpa, fmtStipend } from '@/utils/format';
import { CompanyDialog } from './parts/CompanyDialog';

type JobRow = { job: Job; applicants: number; selected: number; offers: number };

export function FacultyCompanyDetail() {
  const { companyId = '' } = useParams();
  const base = useBase();
  const navigate = useNavigate();
  const { can } = useAuth();
  const state = useAsync(() => companiesApi.get(companyId), [companyId]);
  const [editing, setEditing] = useState(false);

  const columns: Column<JobRow>[] = [
    { key: 'title', header: 'Job', render: (r) => <Link component={RouterLink} to={`${base}/jobs/${r.job.id}`} underline="hover" fontWeight={600} onClick={(e) => e.stopPropagation()}>{r.job.title}</Link> },
    { key: 'status', header: 'Status', render: (r) => <JobStatusChip status={r.job.status} /> },
    { key: 'pay', header: 'Package', render: (r) => r.job.ctcLpa != null ? fmtLpa(r.job.ctcLpa) : fmtStipend(r.job.stipendPerMonth), hideBelow: 'sm' },
    { key: 'drive', header: 'Drive date', render: (r) => fmtDate(r.job.driveDate), hideBelow: 'md' },
    { key: 'applicants', header: 'Applicants', align: 'right', render: (r) => r.applicants },
    { key: 'selected', header: 'Selected', align: 'right', render: (r) => r.selected, hideBelow: 'sm' },
    { key: 'offers', header: 'Offers', align: 'right', render: (r) => r.offers, hideBelow: 'sm' },
  ];

  return (
    <Async state={state}>
      {({ company, jobs, interviews }) => {
        const past = jobs.filter((j) => j.job.status === 'closed' || j.job.status === 'cancelled' || (j.job.driveDate && new Date(j.job.driveDate) < new Date()));
        return (
          <>
            <PageHeader title={company.name} subtitle={<>{company.industry}{company.archivedAt && <> · <b>Archived</b> (hidden from lists; restore it from the Companies page to add jobs)</>}</>} crumbs={[{ label: 'Companies', to: `${base}/companies` }, { label: company.name }]}
              actions={<>
                {can('companies.manage') && !company.archivedAt && <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(true)}>Edit company</Button>}
                {can('jobs.create') && !company.archivedAt && <Button variant="contained" color="secondary" startIcon={<AddIcon />} component={RouterLink} to={`${base}/jobs/new?companyId=${company.id}`}>Add job</Button>}
              </>} />
            <Stack spacing={2.5}>
              <Grid cols={{ xs: 2, md: 4 }}>
                <MetricCard label="Jobs posted" value={jobs.length} />
                <MetricCard label="Hiring drives held" value={past.length} hint={`${interviews} interview round(s)`} tone="purple" />
                <MetricCard label="Total applicants" value={jobs.reduce((n, j) => n + j.applicants, 0)} />
                <MetricCard label="Offers made" value={jobs.reduce((n, j) => n + j.offers, 0)} tone="success" />
              </Grid>
              <Grid cols={{ xs: 1, md: '2fr 1fr' }}>
                <SectionCard title="About">
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <CompanyLogo company={company} size={56} />
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}><TierChip tier={company.tier} /></Stack>
                      <Typography variant="body2">{company.description}</Typography>
                    </Box>
                  </Stack>
                </SectionCard>
                <SectionCard title="Contact">
                  <Stack spacing={1.5}>
                    <KeyValue label="Contact person">{company.contactName}</KeyValue>
                    <KeyValue label="Email"><Link href={`mailto:${company.contactEmail}`}>{company.contactEmail}</Link></KeyValue>
                    <KeyValue label="Phone">{company.contactPhone}</KeyValue>
                    <KeyValue label="Website"><Link href={company.website} target="_blank" rel="noopener noreferrer">{company.website}</Link></KeyValue>
                    <KeyValue label="On record since">{fmtDate(company.createdAt)}</KeyValue>
                  </Stack>
                </SectionCard>
              </Grid>
              <Box>
                <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Jobs &amp; hiring drives</Typography>
                <DataTable caption={`${company.name} jobs`} columns={columns} rows={jobs} getId={(r) => r.job.id} onRowClick={(r) => navigate(`${base}/jobs/${r.job.id}`)}
                  emptyTitle="No jobs yet" emptyMessage="Create a job under this company without duplicating its record." />
              </Box>
            </Stack>
            <CompanyDialog open={editing} company={company} onClose={() => setEditing(false)} onSaved={() => state.reload()} />
          </>
        );
      }}
    </Async>
  );
}
