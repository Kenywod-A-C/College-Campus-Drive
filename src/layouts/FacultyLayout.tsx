import { AppShell } from './AppShell';
import { FACULTY_NAV } from './navConfig';

export const FacultyLayout = () => <AppShell base="/faculty" nav={FACULTY_NAV} searchTo={{ placeholder: 'Search students by name or ID', path: '/faculty/students' }} />;
