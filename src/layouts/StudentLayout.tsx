import { AppShell } from './AppShell';
import { STUDENT_NAV } from './navConfig';

export const StudentLayout = () => <AppShell base="/student" nav={STUDENT_NAV} searchTo={{ placeholder: 'Search jobs, companies, skills', path: '/student/jobs' }} />;
