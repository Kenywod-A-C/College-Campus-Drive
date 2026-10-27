import type { ReactNode } from 'react';
import { Box, Card, Checkbox, Pagination, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { EmptyState, ErrorAlert, TableSkeleton } from './feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg'; // hide on narrow screens
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  getId: (row: T) => string;
  loading?: boolean;
  error?: Error;
  onRetry?: () => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  caption?: string; // accessible table name
  toolbar?: ReactNode;
}

export function DataTable<T>({ columns, rows, getId, loading, error, onRetry, page = 1, pageSize = 10, total, onPageChange, onRowClick, selectable, selected = [], onSelectedChange, emptyTitle = 'Nothing to show', emptyMessage, emptyAction, caption, toolbar }: Props<T>) {
  if (error && !rows) return <ErrorAlert error={error} onRetry={onRetry} />;
  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const ids = (rows ?? []).map(getId);
  const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
  const someSelected = ids.some((id) => selected.includes(id));
  const hide = (c: Column<T>) => (c.hideBelow ? { display: { xs: 'none', [c.hideBelow]: 'table-cell' } } : {});

  return (
    <Card>
      {toolbar}
      {loading && !rows ? <TableSkeleton /> : (
        <TableContainer sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          <Table size="medium" aria-label={caption} aria-busy={loading}>
            <TableHead>
              <TableRow>
                {selectable && (
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={allSelected} indeterminate={!allSelected && someSelected} onChange={(e) => onSelectedChange?.(e.target.checked ? [...new Set([...selected, ...ids])] : selected.filter((s) => !ids.includes(s)))} slotProps={{ input: { 'aria-label': 'Select all rows on this page' } }} />
                  </TableCell>
                )}
                {columns.map((c) => <TableCell key={c.key} align={c.align} sx={{ width: c.width, ...hide(c) }}>{c.header}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {(rows ?? []).map((r) => {
                const id = getId(r);
                return (
                  <TableRow key={id} hover={!!onRowClick} selected={selected.includes(id)} onClick={onRowClick ? () => onRowClick(r) : undefined} sx={{ cursor: onRowClick ? 'pointer' : undefined }}>
                    {selectable && (
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                        <Checkbox size="small" checked={selected.includes(id)} onChange={(e) => onSelectedChange?.(e.target.checked ? [...selected, id] : selected.filter((s) => s !== id))} slotProps={{ input: { 'aria-label': 'Select row' } }} />
                      </TableCell>
                    )}
                    {columns.map((c) => <TableCell key={c.key} align={c.align} sx={hide(c)}>{c.render(r)}</TableCell>)}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows && rows.length === 0 && <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />}
        </TableContainer>
      )}
      {total != null && total > 0 && onPageChange && (
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" spacing={1} sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </Typography>
          {pages > 1 && <Pagination count={pages} page={page} onChange={(_, p) => onPageChange(p)} size="small" shape="rounded" color="primary" />}
        </Stack>
      )}
      <Box />
    </Card>
  );
}
