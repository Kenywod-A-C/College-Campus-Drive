import { useState } from 'react';
import { Box, Button, Chip, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import type { DocumentRecord, DocumentType } from '@/types';
import { documentsApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar, SearchField } from '@/components/FilterBar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DOC_TYPE_LABEL, DocumentPreviewDialog, UploadDialog } from '@/components/DocumentUpload';
import { PageHeader, ProcessingChip } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { fmtDate } from '@/utils/format';

type Row = Awaited<ReturnType<typeof documentsApi.list>>[number];
const TABS: ('all' | DocumentType)[] = ['all', 'resume', 'certificate', 'brochure', 'circular', 'eligibility'];

export function DocumentsPage() {
  const base = useBase();
  const { can } = useAuth();
  const toast = useToast();
  const student = base === '/student';
  const [type, setType] = useState<'all' | DocumentType>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [upload, setUpload] = useState(false);
  const [replace, setReplace] = useState<DocumentRecord>();
  const [preview, setPreview] = useState<string>();
  const [remove, setRemove] = useState<Row>();
  const state = useAsync(() => documentsApi.list({ q: dq, type }), [dq, type]);
  const canUpload = student || can('documents.upload');
  const tabs = student ? TABS.filter((t) => ['all', 'resume', 'certificate', 'circular', 'brochure', 'eligibility'].includes(t)) : TABS.filter((t) => t !== 'resume' && t !== 'certificate');

  const cols: Column<Row>[] = [
    { key: 'title', header: 'Document', render: (r) => (
      <Stack direction="row" spacing={1.25} alignItems="center">
        <PictureAsPdfOutlinedIcon color="action" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>{r.doc.title}</Typography>
          <Typography variant="caption" color="text.secondary">{[r.companyName, r.jobTitle].filter(Boolean).join(' · ') || (r.doc.ownerStudentId ? 'Personal document' : 'General')} · v{r.doc.version}</Typography>
        </Box>
      </Stack>
    ) },
    { key: 'type', header: 'Type', hideBelow: 'sm', render: (r) => DOC_TYPE_LABEL[r.doc.type] },
    { key: 'date', header: 'Uploaded', hideBelow: 'md', render: (r) => <>{fmtDate(r.doc.uploadedAt)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.doc.uploadedBy}</Typography></> },
    { key: 'access', header: 'Access', hideBelow: 'lg', render: (r) => (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {r.doc.ownerStudentId && student ? <Chip size="small" label="Only you & placement cell" /> : r.doc.access.map((a) => <Chip key={a} size="small" variant="outlined" label={a === 'student' ? 'Students' : a === 'faculty' ? 'Faculty' : 'Admin'} />)}
      </Stack>
    ) },
    ...(!student || true ? [{ key: 'status', header: 'Status', render: (r: Row) => r.doc.type === 'resume' || r.doc.type === 'certificate' ? <Chip size="small" variant="outlined" label="Stored" /> : <ProcessingChip status={r.doc.processing} /> }] : []),
    { key: 'actions', header: <span style={{ position: 'absolute', left: -9999 }}>Actions</span>, align: 'right', render: (r) => (
      <Stack direction="row" justifyContent="flex-end">
        <Tooltip title="Preview & extracted text"><IconButton size="small" aria-label={`Preview ${r.doc.title}`} onClick={() => setPreview(r.doc.id)}><VisibilityOutlinedIcon fontSize="small" /></IconButton></Tooltip>
        {r.canManage && <Tooltip title="Replace with a new version"><IconButton size="small" aria-label={`Replace ${r.doc.title}`} onClick={() => setReplace(r.doc)}><SwapHorizIcon fontSize="small" /></IconButton></Tooltip>}
        {r.canManage && r.doc.processing === 'failed' && !student && (
          <Tooltip title="Retry processing"><IconButton size="small" aria-label={`Retry processing ${r.doc.title}`} onClick={async () => { try { await documentsApi.reprocess(r.doc.id); toast.success('Processing restarted'); state.reload(); } catch (e) { toast.error((e as Error).message); } }}><ReplayIcon fontSize="small" /></IconButton></Tooltip>
        )}
        {r.canManage && <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${r.doc.title}`} onClick={() => setRemove(r)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>}
      </Stack>
    ) },
  ];

  return (
    <>
      <PageHeader
        title={base === '/faculty' ? 'Documents & Circulars' : 'Documents'}
        subtitle={student ? 'Your resume and certificates, plus placement documents you are authorised to view.' : 'Upload circulars, brochures and eligibility documents. Text is extracted so the assistant can cite page references.'}
        actions={canUpload ? <Button variant="contained" color="secondary" startIcon={<UploadFileIcon />} onClick={() => setUpload(true)}>Upload document</Button> : undefined}
      />
      <Tabs value={type} onChange={(_, v) => setType(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        {tabs.map((t) => <Tab key={t} value={t} label={t === 'all' ? 'All' : DOC_TYPE_LABEL[t]} />)}
      </Tabs>
      <FilterBar><SearchField value={q} onChange={setQ} placeholder="Search documents" /></FilterBar>
      <DataTable caption="Documents" columns={cols} rows={state.data?.map((r) => r)} getId={(r) => r.doc.id} loading={state.loading} error={state.error} onRetry={state.reload}
        emptyTitle="No documents found" emptyMessage={canUpload ? 'Upload a document to get started.' : 'Nothing has been shared with you yet.'} />

      <UploadDialog open={upload} onClose={() => setUpload(false)} onDone={state.reload} mode={student ? 'student' : 'staff'} />
      {replace && <UploadDialog open onClose={() => setReplace(undefined)} onDone={state.reload} mode={student ? 'student' : 'staff'} replace={replace} />}
      <DocumentPreviewDialog id={preview} onClose={() => { setPreview(undefined); state.reload(); }} />
      <ConfirmDialog open={!!remove} title="Delete document?" tone="error" confirmLabel="Delete" onClose={() => setRemove(undefined)}
        onConfirm={async () => { await documentsApi.remove(remove!.doc.id); toast.success('Document deleted'); state.reload(); }}>
        “{remove?.doc.title}” will be removed for everyone who can see it. This action is recorded in the audit log.
      </ConfirmDialog>
    </>
  );
}
