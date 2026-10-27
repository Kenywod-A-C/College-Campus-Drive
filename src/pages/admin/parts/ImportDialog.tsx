import { useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import { usersApi, type ImportResult, type ImportRow } from '@/api';
import { downloadText } from '@/utils/format';

const HEADER = 'studentCode,name,email,departmentCode,graduationYear,cgpa';
const TEMPLATE = `${HEADER}\n23CSE201,Sample Student,sample.student@campus.demo,CSE,2027,8.1\n`;

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  return [...out, cur.trim()];
}
export function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines[0]?.toLowerCase().startsWith('studentcode')) lines.shift();
  return lines.map((l) => { const [studentCode, name, email, departmentCode, graduationYear, cgpa] = splitCsvLine(l); return { studentCode, name, email, departmentCode, graduationYear, cgpa }; });
}
const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();

  const close = () => { if (busy) return; if (result?.imported) onImported(); setText(''); setFileName(undefined); setResult(undefined); setError(undefined); onClose(); };
  const pick = async (f?: File) => {
    if (!f) return;
    if (!/\.csv$|text\//.test(f.name + f.type)) { setError('Please choose a .csv file.'); return; }
    if (f.size > 1024 * 1024) { setError('File is larger than 1 MB.'); return; }
    setError(undefined); setFileName(f.name); setText(await f.text());
  };
  const run = async () => {
    const rows = parseCsv(text);
    if (!rows.length) { setError('No rows found. Paste CSV rows or choose a file.'); return; }
    if (rows.length > 500) { setError('Import at most 500 rows at a time.'); return; }
    setBusy(true); setError(undefined);
    try { setResult(await usersApi.importStudents(rows)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  };
  const errorReport = () => result && downloadText('student-import-errors.csv', ['row,field,message,value', ...result.errors.map((e) => [e.row, e.field, e.message, e.value].map(q).join(','))].join('\n'));

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" aria-labelledby="import-title">
      <DialogTitle id="import-title">Bulk import students</DialogTitle>
      <DialogContent>
        {!result ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">Columns: <code>{HEADER}</code>. Every row is validated; valid rows are imported and invalid rows are reported so you can fix and re-upload them. Imported students start as <b>invited</b>.</Typography>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} data-testid="import-file" />
              <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
              {fileName && <Chip label={fileName} onDelete={() => { setFileName(undefined); setText(''); if (fileRef.current) fileRef.current.value = ''; }} />}
              <Button startIcon={<DownloadIcon />} onClick={() => downloadText('student-import-template.csv', TEMPLATE)}>Download template</Button>
            </Stack>
            <TextField multiline minRows={6} maxRows={12} label="Or paste CSV rows" value={text} onChange={(e) => setText(e.target.value)} placeholder={TEMPLATE} slotProps={{ htmlInput: { style: { fontFamily: 'ui-monospace, monospace', fontSize: 13 } } }} />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity={result.errors.length ? (result.imported ? 'warning' : 'error') : 'success'}>
              Imported <b>{result.imported}</b> of <b>{result.total}</b> row(s). {result.errors.length ? `${result.errors.length} validation error(s) found.` : 'No errors.'}
            </Alert>
            {result.errors.length > 0 && (
              <>
                <Box><Button startIcon={<DownloadIcon />} variant="outlined" onClick={errorReport}>Download error report</Button></Box>
                <TableContainer sx={{ maxHeight: 320, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                  <Table size="small" stickyHeader aria-label="Import validation errors">
                    <TableHead><TableRow><TableCell>Row</TableCell><TableCell>Field</TableCell><TableCell>Problem</TableCell><TableCell>Value</TableCell></TableRow></TableHead>
                    <TableBody>{result.errors.map((e, i) => <TableRow key={i}><TableCell>{e.row}</TableCell><TableCell>{e.field}</TableCell><TableCell>{e.message}</TableCell><TableCell>{e.value || '—'}</TableCell></TableRow>)}</TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} color="inherit" disabled={busy}>{result ? 'Done' : 'Cancel'}</Button>
        {!result && <Button variant="contained" color="secondary" onClick={run} disabled={busy || !text.trim()}>{busy ? 'Validating…' : 'Validate & import'}</Button>}
        {result && result.errors.length > 0 && <Button variant="contained" color="secondary" onClick={() => { setResult(undefined); setText(''); setFileName(undefined); }}>Import another file</Button>}
      </DialogActions>
    </Dialog>
  );
}
