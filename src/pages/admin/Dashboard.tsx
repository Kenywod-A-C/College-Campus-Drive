import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import { adminApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Async } from '@/components/feedback';
import { Grid, KeyValue, MetricCard, PageHeader, SectionCard } from '@/components/ui';
import { timeAgo } from '@/utils/format';
import { ResultChip } from './parts/ResultChip';

export function AdminDashboard() {
  const state = useAsync(() => adminApi.dashboard(), []);
  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="System-wide overview of users, placements and activity." />
      <Async state={state}>
        {({ metrics: m, placement: p, activity, alerts }) => (
          <Stack spacing={3}>
            <Grid cols={{ xs: 1, sm: 2, lg: 4 }}>
              <MetricCard label="Total users" value={m.totalUsers} icon={<GroupsOutlinedIcon />} to="/admin/users" />
              <MetricCard label="Active students" value={m.activeStudents} icon={<SchoolOutlinedIcon />} tone="success" to="/admin/students" />
              <MetricCard label="Faculty accounts" value={m.facultyAccounts} icon={<BadgeOutlinedIcon />} tone="purple" to="/admin/faculty" />
              <MetricCard label="Companies" value={m.companies} icon={<BusinessOutlinedIcon />} to="/admin/companies" />
              <MetricCard label="Active jobs" value={m.activeJobs} icon={<WorkOutlineIcon />} tone="warning" to="/admin/jobs" />
              <MetricCard label="Applications" value={m.applications} icon={<AssignmentOutlinedIcon />} />
              <MetricCard label="Total offers" value={m.offers} icon={<CardGiftcardOutlinedIcon />} tone="success" />
            </Grid>
            <Grid cols={{ xs: 1, lg: 2 }}>
              <SectionCard title="Placement summary" subtitle="Unique students, offers and accepted offers are counted separately." action={<Button component={RouterLink} to="/admin/reports" size="small">Full reports</Button>}>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
                  <KeyValue label="Placement rate"><Typography variant="h3" component="span">{p.pct}%</Typography></KeyValue>
                  <KeyValue label="Unique students placed">{p.placed} of {p.totalStudents}</KeyValue>
                  <KeyValue label="Total offers">{p.offers}</KeyValue>
                  <KeyValue label="Accepted offers">{p.accepted}</KeyValue>
                </Box>
              </SectionCard>
              <SectionCard title="System alerts" subtitle={alerts.length ? `${alerts.length} item(s) need attention` : undefined}>
                {alerts.length === 0 ? <Typography color="text.secondary">No alerts. Everything looks healthy.</Typography> : (
                  <Stack spacing={1}>
                    {alerts.map((a, i) => (
                      <Alert key={i} severity={a.level} action={<Button component={RouterLink} to={a.link} size="small" color="inherit">View</Button>}>{a.text}</Alert>
                    ))}
                  </Stack>
                )}
              </SectionCard>
            </Grid>
            <SectionCard title="Recent administrative activity" action={<Button component={RouterLink} to="/admin/audit-logs" size="small">All audit logs</Button>}>
              <List disablePadding>
                {activity.map((a) => (
                  <ListItem key={a.id} disableGutters divider sx={{ gap: 1.5, flexWrap: 'wrap' }}>
                    <ListItemText
                      primary={<><b>{a.actor}</b> · <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{a.action}</Box></>}
                      secondary={<>{a.resource}{a.reason ? ` — ${a.reason}` : ''}</>}
                    />
                    <ResultChip result={a.result} />
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 64, textAlign: 'right' }}>{timeAgo(a.at)}</Typography>
                  </ListItem>
                ))}
              </List>
            </SectionCard>
          </Stack>
        )}
      </Async>
    </>
  );
}
