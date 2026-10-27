import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Snackbar } from '@mui/material';

type Severity = 'success' | 'error' | 'info' | 'warning';
interface Ctx { toast: (message: string, severity?: Severity) => void; success: (m: string) => void; error: (m: string) => void }
const ToastContext = createContext<Ctx>({ toast: () => {}, success: () => {}, error: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<{ message: string; severity: Severity; key: number } | null>(null);
  const toast = useCallback((message: string, severity: Severity = 'success') => setItem({ message, severity, key: Date.now() }), []);
  const value = useMemo(() => ({ toast, success: (m: string) => toast(m, 'success'), error: (m: string) => toast(m, 'error') }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar key={item?.key} open={!!item} autoHideDuration={4500} onClose={(_, r) => r !== 'clickaway' && setItem(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {item ? <Alert severity={item.severity} variant="filled" onClose={() => setItem(null)} sx={{ width: '100%' }}>{item.message}</Alert> : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}
