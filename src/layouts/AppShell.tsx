import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Avatar, Box, Divider, Drawer, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Toolbar, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SchoolIcon from '@mui/icons-material/School';
import LogoutIcon from '@mui/icons-material/Logout';
import SearchIcon from '@mui/icons-material/Search';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { Permission } from '@/types';
import { useAuth } from '@/auth/AuthContext';
import { ROLE_LABEL } from '@/auth/permissions';
import { NotificationCenter } from '@/components/NotificationCenter';
import { DemoBanner } from '@/components/ui';
import { BaseContext, type Base } from './useBase';

export interface NavItem { label: string; to?: string; icon: ReactNode; perm?: Permission; logout?: boolean }
const WIDTH = 268;

interface Props { base: Base; nav: NavItem[]; searchTo?: { placeholder: string; path: string } }

export function AppShell({ base, nav, searchTo }: Props) {
  const { user, can, logout } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const visible = useMemo(() => nav.filter((n) => !n.perm || can(n.perm)), [nav, can]);
  const current = [...visible].filter((n) => n.to && (pathname === n.to || pathname.startsWith(n.to + '/'))).sort((a, b) => b.to!.length - a.to!.length)[0];
  const doLogout = async () => { await logout(); navigate('/login', { replace: true }); };

  const sidebar = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'primary.main', color: '#fff' }}>
      <Box sx={{ px: 2.5, py: 2.25, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box aria-hidden sx={{ width: 36, height: 36, borderRadius: 2.5, bgcolor: 'secondary.main', display: 'grid', placeItems: 'center' }}><SchoolIcon fontSize="small" /></Box>
        <Box>
          <Typography sx={{ fontWeight: 700, lineHeight: 1.15 }}>Campus Assistant</Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,.65)' }}>{ROLE_LABEL[user!.role].split(' /')[0]} workspace</Typography>
        </Box>
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,.12)' }} />
      <List component="nav" aria-label={`${base.slice(1)} navigation`} sx={{ px: 1.5, py: 1.5, flex: 1, overflowY: 'auto' }}>
        {visible.map((n) => n.logout ? (
          <Box key="logout">
            <Divider sx={{ borderColor: 'rgba(255,255,255,.12)', my: 1 }} />
            <ListItemButton onClick={doLogout} sx={itemSx(false)}>
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} slotProps={{ primary: { fontSize: 14, fontWeight: 500 } }} />
            </ListItemButton>
          </Box>
        ) : (
          <ListItemButton key={n.to} component={NavLink} to={n.to!} onClick={() => setOpen(false)} selected={current?.to === n.to} sx={itemSx(current?.to === n.to)} aria-current={current?.to === n.to ? 'page' : undefined}>
            <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{n.icon}</ListItemIcon>
            <ListItemText primary={n.label} slotProps={{ primary: { fontSize: 14, fontWeight: current?.to === n.to ? 600 : 500 } }} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <BaseContext.Provider value={base}>
      <Box component="a" href="#main" sx={{ position: 'absolute', left: -9999, '&:focus': { left: 8, top: 8, zIndex: 2000, bgcolor: '#fff', p: 1, borderRadius: 1 } }}>Skip to main content</Box>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        {desktop ? (
          <Drawer variant="permanent" open sx={{ width: WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: WIDTH, border: 0 } }}>{sidebar}</Drawer>
        ) : (
          <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} ModalProps={{ keepMounted: true }} sx={{ '& .MuiDrawer-paper': { width: WIDTH, maxWidth: '85vw' } }}>{sidebar}</Drawer>
        )}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <DemoBanner />
          <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'rgba(255,255,255,.94)', backdropFilter: 'blur(6px)' }}>
            <Toolbar sx={{ gap: 1.5 }}>
              {!desktop && <IconButton edge="start" onClick={() => setOpen(true)} aria-label="Open navigation menu"><MenuIcon /></IconButton>}
              <Typography variant="h4" component="p" noWrap sx={{ flexShrink: 0, maxWidth: { xs: 150, sm: 280 } }}>{current?.label ?? 'Campus Assistant'}</Typography>
              <Box sx={{ flex: 1 }} />
              {searchTo && desktop && (
                <Box component="form" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`${searchTo.path}?q=${encodeURIComponent(q.trim())}`); setQ(''); }} sx={{ width: 300 }}>
                  <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchTo.placeholder} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': searchTo.placeholder } }} />
                </Box>
              )}
              <NotificationCenter />
              <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu" sx={{ p: 0.5 }}>
                <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>{user!.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</Avatar>
              </IconButton>
              <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} slotProps={{ paper: { sx: { minWidth: 240, mt: 1 } } }}>
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography fontWeight={600}>{user!.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{user!.email}</Typography>
                  <Typography variant="caption" color="text.secondary">{ROLE_LABEL[user!.role]}</Typography>
                </Box>
                <Divider />
                <MenuItem onClick={() => { setMenu(null); navigate(`${base}/settings`); }}><ListItemIcon><SettingsOutlinedIcon fontSize="small" /></ListItemIcon>Settings</MenuItem>
                <MenuItem onClick={doLogout}><ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>Log out</MenuItem>
              </Menu>
            </Toolbar>
          </AppBar>
          <Box component="main" id="main" tabIndex={-1} sx={{ flex: 1, p: { xs: 2, md: 3.5 }, maxWidth: 1360, width: '100%', mx: 'auto', outline: 'none' }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </BaseContext.Provider>
  );
}

const itemSx = (active: boolean) => ({
  mb: 0.5, color: active ? '#fff' : 'rgba(255,255,255,.78)', bgcolor: active ? 'rgba(37,99,235,.9)' : 'transparent',
  '&:hover': { bgcolor: active ? 'rgba(37,99,235,.9)' : 'rgba(255,255,255,.08)' },
  '&.Mui-selected': { bgcolor: 'rgba(37,99,235,.9)', '&:hover': { bgcolor: 'rgba(37,99,235,.95)' } },
});
