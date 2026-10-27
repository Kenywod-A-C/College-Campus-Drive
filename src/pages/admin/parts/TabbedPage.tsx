import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tab, Tabs } from '@mui/material';
import { PageHeader } from '@/components/ui';

export interface TabDef { key: string; label: string; path: string; content: ReactNode }

/** Header + tabs whose selection is mirrored in the URL (so each tab is linkable from the sidebar/breadcrumbs). */
export function TabbedPage({ title, subtitle, tabs, active }: { title: string; subtitle: string; tabs: TabDef[]; active: string }) {
  const navigate = useNavigate();
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Tabs value={current.key} onChange={(_, k) => navigate(tabs.find((t) => t.key === k)!.path)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} aria-label={title}>
        {tabs.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
      </Tabs>
      {current.content}
    </>
  );
}
