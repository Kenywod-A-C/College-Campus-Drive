import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Box, Button, Divider, IconButton, List, ListItemButton, Popover, Stack, Tooltip, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import type { AppNotification } from '@/types';
import { notificationsApi } from '@/api';
import { timeAgo } from '@/utils/format';
import { EmptyState } from './feedback';

export function NotificationCenter() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => { notificationsApi.list().then(setItems).catch(() => undefined); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const unread = items.filter((n) => !n.read).length;
  const open = async (n: AppNotification) => {
    setAnchor(null);
    if (!n.read) { setItems((x) => x.map((i) => (i.id === n.id ? { ...i, read: true } : i))); notificationsApi.markRead(n.id).catch(() => undefined); }
    if (n.link) navigate(n.link);
  };
  const markAll = async () => { setItems((x) => x.map((i) => ({ ...i, read: true }))); await notificationsApi.markAllRead(); };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => { setAnchor(e.currentTarget); load(); }} aria-label={`Notifications, ${unread} unread`} aria-haspopup="dialog">
          <Badge badgeContent={unread} color="error"><NotificationsNoneIcon /></Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: { xs: 'calc(100vw - 24px)', sm: 380 }, maxHeight: 480, mt: 1 } } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.5 }}>
          <Typography variant="h5">Notifications</Typography>
          <Button size="small" onClick={markAll} disabled={!unread}>Mark all read</Button>
        </Stack>
        <Divider />
        {items.length === 0 ? <EmptyState title="You're all caught up" message="New updates will appear here." /> : (
          <List disablePadding>
            {items.slice(0, 8).map((n) => (
              <ListItemButton key={n.id} onClick={() => open(n)} sx={{ borderRadius: 0, alignItems: 'flex-start', gap: 1.25, bgcolor: n.read ? undefined : 'rgba(37,99,235,.05)' }}>
                <FiberManualRecordIcon sx={{ fontSize: 10, mt: 0.9, color: n.read ? 'transparent' : 'secondary.main' }} aria-label={n.read ? undefined : 'Unread'} />
                <Box>
                  <Typography variant="body2" fontWeight={n.read ? 500 : 700}>{n.title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</Typography>
                  <Typography variant="caption" color="text.secondary">{timeAgo(n.at)}</Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
