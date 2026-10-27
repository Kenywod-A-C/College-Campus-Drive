import { FacultyCompanies } from '@/pages/faculty/Companies';
import { FacultyJobs } from '@/pages/faculty/Jobs';
import { TabbedPage } from './parts/TabbedPage';

export function AdminCompaniesJobs({ initialTab = 'companies' }: { initialTab?: 'companies' | 'jobs' }) {
  return (
    <TabbedPage
      title="Companies & jobs" subtitle="System-wide view of company master records, job postings and hiring drives." active={initialTab}
      tabs={[
        { key: 'companies', label: 'Companies', path: '/admin/companies', content: <FacultyCompanies embedded /> },
        { key: 'jobs', label: 'Jobs & drives', path: '/admin/jobs', content: <FacultyJobs embedded /> },
      ]}
    />
  );
}
