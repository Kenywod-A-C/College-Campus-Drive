import type { ReactNode } from 'react';
import { Stack } from '@mui/material';
import { PageHeader, type Crumb } from '@/components/ui';

/** Full PageHeader normally; when `embedded` (tab body in another page) only the action buttons are shown. */
export function ListHeader({ embedded, title, subtitle, crumbs, actions }: { embedded?: boolean; title: string; subtitle?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode }) {
  if (!embedded) return <PageHeader title={title} subtitle={subtitle} crumbs={crumbs} actions={actions} />;
  return actions ? <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 2 }}>{actions}</Stack> : null;
}
