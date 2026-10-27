import { AppShell } from './AppShell';
import { ADMIN_NAV } from './navConfig';

export const AdminLayout = () => <AppShell base="/admin" nav={ADMIN_NAV} searchTo={{ placeholder: 'Search users by name or email', path: '/admin/users' }} />;
