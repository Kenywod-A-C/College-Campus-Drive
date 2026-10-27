import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import type { NavItem } from './AppShell';

const logout: NavItem = { label: 'Logout', icon: <LogoutIcon />, logout: true };

export const STUDENT_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/student/dashboard', icon: <DashboardOutlinedIcon /> },
  { label: 'My Profile', to: '/student/profile', icon: <PersonOutlineIcon /> },
  { label: 'Jobs & Opportunities', to: '/student/jobs', icon: <WorkOutlineIcon /> },
  { label: 'My Applications', to: '/student/applications', icon: <AssignmentOutlinedIcon /> },
  { label: 'My Offers', to: '/student/offers', icon: <CardGiftcardOutlinedIcon /> },
  { label: 'AI Assistant', to: '/student/assistant', icon: <SmartToyOutlinedIcon /> },
  { label: 'Reminders & Notifications', to: '/student/reminders', icon: <NotificationsNoneIcon /> },
  { label: 'Documents', to: '/student/documents', icon: <FolderOutlinedIcon /> },
  { label: 'Settings', to: '/student/settings', icon: <SettingsOutlinedIcon /> },
  logout,
];

export const FACULTY_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/faculty/dashboard', icon: <DashboardOutlinedIcon /> },
  { label: 'Companies', to: '/faculty/companies', icon: <BusinessOutlinedIcon />, perm: 'companies.manage' },
  { label: 'Jobs & Hiring Drives', to: '/faculty/jobs', icon: <WorkOutlineIcon />, perm: 'jobs.create' },
  { label: 'Students', to: '/faculty/students', icon: <GroupsOutlinedIcon />, perm: 'students.view' },
  { label: 'Applications & Applicants', to: '/faculty/applications', icon: <AssignmentOutlinedIcon />, perm: 'applications.review' },
  { label: 'Interviews & Selection', to: '/faculty/interviews', icon: <EventNoteOutlinedIcon />, perm: 'applications.review' },
  { label: 'Offers & Placements', to: '/faculty/offers', icon: <HandshakeOutlinedIcon />, perm: 'offers.manage' },
  { label: 'Documents & Circulars', to: '/faculty/documents', icon: <FolderOutlinedIcon /> },
  { label: 'AI Assistant', to: '/faculty/assistant', icon: <SmartToyOutlinedIcon /> },
  { label: 'Placement Reports', to: '/faculty/reports', icon: <InsightsOutlinedIcon />, perm: 'reports.view' },
  { label: 'Notifications', to: '/faculty/notifications', icon: <NotificationsNoneIcon /> },
  { label: 'Settings', to: '/faculty/settings', icon: <SettingsOutlinedIcon /> },
  logout,
];

export const ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: <DashboardOutlinedIcon /> },
  { label: 'User Management', to: '/admin/users', icon: <ManageAccountsOutlinedIcon />, perm: 'users.manage' },
  { label: 'Roles & Permissions', to: '/admin/roles', icon: <AdminPanelSettingsOutlinedIcon />, perm: 'roles.manage' },
  { label: 'Students & Faculty', to: '/admin/students', icon: <GroupsOutlinedIcon />, perm: 'students.view' },
  { label: 'Companies & Jobs', to: '/admin/companies', icon: <BusinessOutlinedIcon /> },
  { label: 'Placement Policies', to: '/admin/policies', icon: <GavelOutlinedIcon />, perm: 'policies.manage' },
  { label: 'Departments & Courses', to: '/admin/departments', icon: <AccountBalanceOutlinedIcon /> },
  { label: 'Documents', to: '/admin/documents', icon: <FolderOutlinedIcon /> },
  { label: 'AI Assistant', to: '/admin/assistant', icon: <SmartToyOutlinedIcon /> },
  { label: 'Reports & Analytics', to: '/admin/reports', icon: <InsightsOutlinedIcon />, perm: 'reports.view' },
  { label: 'Audit Logs', to: '/admin/audit-logs', icon: <HistoryOutlinedIcon />, perm: 'audit.view' },
  { label: 'System Settings', to: '/admin/settings', icon: <TuneOutlinedIcon /> },
  logout,
];
