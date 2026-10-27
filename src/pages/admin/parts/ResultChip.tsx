import type { AuditLog } from '@/types';
import { StatusChip } from '@/components/ui';
import { titleCase } from '@/utils/format';

export const ResultChip = ({ result }: { result: AuditLog['result'] }) => (
  <StatusChip label={titleCase(result)} tone={result === 'success' ? 'success' : result === 'denied' ? 'warning' : 'error'} />
);
