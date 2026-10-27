import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, List, ListItemButton, Stack, Tab, Tabs, Typography } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { notificationsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { PageHeader, StatusChip } from '@/components/ui';
import { Async, EmptyState } from '@/components/feedback';
import { fmtDateTime, titleCase } from '@/utils/format';

export function NotificationsPage() {
  const state = useAsync(() => notificationsApi.list(), []);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const navigate = useNavigate();
  const markAll = async () => { await notificationsApi.markAllRead(); state.reload(); };

  return (
    <>
      <PageHeader title="Notifications" subtitle="Updates about drives, deadlines, applications and system events." actions={<Button onClick={markAll} disabled={!state.data?.some((n) => !n.read)}>Mark all as read</Button>} />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="all" label="All" />
        <Tab value="unread" label={`Unread${state.data ? ` (${state.data.filter((n) => !n.read).length})` : ''}`} />
      </Tabs>
      <Async state={state}>
        {(all) => {
          const items = tab === 'unread' ? all.filter((n) => !n.read) : all;
          return (
            <Card>
              {items.length === 0 ? <EmptyState title={tab === 'unread' ? 'No unread notifications' : 'No notifications'} message="You’re all caught up." /> : (
                <List disablePadding>
                  {items.map((n) => (
                    <ListItemButton key={n.id} divider sx={{ borderRadius: 0, alignItems: 'flex-start', gap: 1.5, py: 1.75, bgcolor: n.read ? undefined : 'rgba(37,99,235,.05)' }}
                      onClick={async () => { if (!n.read) await notificationsApi.markRead(n.id); if (n.link) navigate(n.link); else state.reload(); }}>
                      <FiberManualRecordIcon sx={{ fontSize: 10, mt: 0.8, color: n.read ? 'transparent' : 'secondary.main' }} aria-label={n.read ? undefined : 'Unread'} />
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="body2" fontWeight={n.read ? 500 : 700}>{n.title}</Typography>
                          <StatusChip label={titleCase(n.kind)} tone={n.kind === 'deadline' ? 'warning' : n.kind === 'offer' ? 'success' : 'neutral'} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{n.body}</Typography>
                        <Typography variant="caption" color="text.secondary">{fmtDateTime(n.at)}</Typography>
                      </Box>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Card>
          );
        }}
      </Async>
    </>
  );
}
