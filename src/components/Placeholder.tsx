import { PageHeader } from './ui';
import { EmptyState } from './feedback';

/** Temporary body for pages that are still being built. */
export const Placeholder = ({ title }: { title: string }) => (
  <>
    <PageHeader title={title} />
    <EmptyState title="Coming together" message="This screen is being built." />
  </>
);
