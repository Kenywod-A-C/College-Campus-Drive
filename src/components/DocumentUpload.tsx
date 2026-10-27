import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { DocumentRecord, DocumentType } from '@/types';
import { companiesApi, documentsApi, reportsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { fmtDate } from '@/utils/format';
import { KeyValue, ProcessingChip } from './ui';
import { Async } from './feedback';
import { useToast } from './Toast';

export const DOC_TYPE_LABEL: Record<DocumentType, string> = { resume: 'Resume', certificate: 'Certificate', brochure: 'Company brochure', circular: 'Placement circular', eligibility: 'Eligibility document' };
const STAFF_TYPES: DocumentType[] = ['circular', 'brochure', 'eligibility'];
const STUDENT_TYPES: DocumentType[] = ['resume', 'certificate'];
const MAX_KB = 5 * 1024;

interface FormValues { title: string; type: DocumentType; companyId: string; jobId: string; studentVisible: boolean }

/** Upload (or replace) dialog. Client checks mirror the server's validation, which remains authoritative. */
export function UploadDialog({ open, onClose, onDone, mode, replace }: { open: boolean; onClose: () => void; onDone: () => void; mode: 'student' | 'staff'; replace?: DocumentRecord }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const types = mode === 'student' ? STUDENT_TYPES : STAFF_TYPES;
  const { control, handleSubmit, watch, reset, formState: { errors } } = useForm<FormValues>({ defaultValues: { title: '', type: types[0], companyId: '', jobId: '', studentVisible: true } });
  const companyId = watch('companyId');
  const filters = useAsync(() => (mode === 'staff' && !replace ? reportsApi.filterOptions() : Promise.resolve(undefined)), [mode, replace, open]);
  void companiesApi;

  const pickFile = (f?: File) => {
    setFile(f); setFileError(undefined);
    if (!f) return;
    const personal = (replace ? replace.type : '') === 'resume' || types.includes('resume');
    const okType = f.type === 'application/pdf' || (personal && /word/.test(f.type));
    if (!okType) setFileError(personal ? 'Only PDF or Word files are accepted.' : 'Only PDF files are accepted.');
    else if (f.size / 1024 > MAX_KB) setFileError('File is larger than the 5 MB limit.');
  };
  const close = () => { reset(); setFile(undefined); setFileError(undefined); setServerError(undefined); onClose(); };

  const submit = handleSubmit(async (v) => {
    if (!file) { setFileError('Choose a file to upload.'); return; }
    if (fileError) return;
    setBusy(true); setServerError(undefined);
    try {
      const meta = { fileName: file.name, fileSizeKb: Math.ceil(file.size / 1024), mime: file.type };
      if (replace) await documentsApi.replace(replace.id, meta);
      else await documentsApi.upload({ title: v.title, type: v.type, companyId: v.companyId || undefined, jobId: v.jobId || undefined, studentVisible: v.studentVisible, ...meta });
      toast.success(replace ? `Replaced with version ${replace.version + 1}` : 'Document uploaded. Processing has started.');
      close(); onDone();
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); }
  });

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>{replace ? `Replace “${replace.title}”` : 'Upload document'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          {replace ? <Alert severity="info">The record keeps its links to companies and jobs. The previous version is superseded (now v{replace.version}).</Alert> : (
            <>
              <Controller name="title" control={control} rules={{ required: 'Title is required', maxLength: { value: 120, message: 'Keep the title under 120 characters' } }} render={({ field }) => <TextField {...field} label="Title" error={!!errors.title} helperText={errors.title?.message} />} />
              <Controller name="type" control={control} render={({ field }) => (
                <TextField {...field} select label="Document type">{types.map((t) => <MenuItem key={t} value={t}>{DOC_TYPE_LABEL[t]}</MenuItem>)}</TextField>
              )} />
              {mode === 'staff' && (
                <>
                  <Controller name="companyId" control={control} render={({ field }) => (
                    <TextField {...field} select label="Company (optional)"><MenuItem value="">None</MenuItem>{filters.data?.companies.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}</TextField>
                  )} />
                  <Controller name="jobId" control={control} render={({ field }) => (
                    <TextField {...field} select label="Job (optional)" disabled={!companyId}><MenuItem value="">None</MenuItem>{filters.data?.jobs.filter((j) => j.companyId === companyId).map((j) => <MenuItem key={j.value} value={j.value}>{j.label}</MenuItem>)}</TextField>
                  )} />
                  <Controller name="studentVisible" control={control} render={({ field }) => (
                    <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Visible to students" />
                  )} />
                </>
              )}
            </>
          )}
          <Box>
            <input ref={fileRef} type="file" hidden accept={mode === 'student' ? '.pdf,.doc,.docx' : '.pdf'} onChange={(e) => pickFile(e.target.files?.[0])} data-testid="file-input" />
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>Choose file</Button>
            {file && <Chip sx={{ ml: 1.5 }} label={`${file.name} · ${Math.ceil(file.size / 1024)} KB`} onDelete={() => { setFile(undefined); setFileError(undefined); if (fileRef.current) fileRef.current.value = ''; }} />}
            <Typography variant="caption" color={fileError ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.75 }} role={fileError ? 'alert' : undefined}>
              {fileError ?? (mode === 'student' ? 'PDF or Word, up to 5 MB.' : 'PDF only, up to 5 MB. Text is extracted so the assistant can cite it.')}
            </Typography>
          </Box>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} color="inherit" disabled={busy}>Cancel</Button>
        <Button type="submit" variant="contained" color="secondary" disabled={busy}>{busy ? 'Uploading…' : replace ? 'Replace' : 'Upload'}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Metadata + extracted text with source page references. */
export function DocumentPreviewDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const state = useAsync(() => (id ? documentsApi.get(id) : Promise.resolve(undefined)), [id]);
  return (
    <Dialog open={!!id} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="doc-preview-title">
      <DialogTitle id="doc-preview-title">{state.data?.title ?? 'Document'}</DialogTitle>
      <DialogContent>
        {id && (
          <Async state={state}>
            {(d) => (
              <Stack spacing={2.5}>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
                  <KeyValue label="Type">{DOC_TYPE_LABEL[d.type]}</KeyValue>
                  <KeyValue label="Version">v{d.version}</KeyValue>
                  <KeyValue label="Uploaded">{fmtDate(d.uploadedAt)} · {d.uploadedBy}</KeyValue>
                  <KeyValue label="Size">{d.sizeKb >= 1024 ? `${(d.sizeKb / 1024).toFixed(1)} MB` : `${d.sizeKb} KB`}{d.pages ? ` · ${d.pages} pages` : ''}</KeyValue>
                  <KeyValue label="Processing"><ProcessingChip status={d.processing} /></KeyValue>
                  <KeyValue label="Access">{d.access.join(', ')}</KeyValue>
                </Box>
                <Box>
                  <Typography variant="h5" sx={{ mb: 1 }}>Extracted text</Typography>
                  {d.processing === 'failed' && <Alert severity="error">Text extraction failed — no extractable text was found. Re-upload a text-based PDF (scanned images are not OCR’d in this demo).</Alert>}
                  {(d.processing === 'queued' || d.processing === 'processing') && <Alert severity="info">Processing in progress. Text will appear here when indexing completes.</Alert>}
                  {d.processing === 'indexed' && !d.extractedExcerpts?.length && <Typography color="text.secondary" variant="body2">Personal documents are stored but not text-indexed.</Typography>}
                  <Stack spacing={1.5}>
                    {d.extractedExcerpts?.map((e, i) => (
                      <Box key={i} sx={{ p: 1.5, bgcolor: '#f8fafc', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                        <Chip size="small" label={`Page ${e.page}`} sx={{ mb: 0.75 }} />
                        <Typography variant="body2">{e.text}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            )}
          </Async>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
