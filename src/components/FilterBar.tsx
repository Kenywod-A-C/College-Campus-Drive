import type { ReactNode } from 'react';
import { Box, FormControl, InputAdornment, InputLabel, MenuItem, Select, Stack, TextField } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

export function SearchField({ value, onChange, placeholder = 'Search', width = 280 }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number | string }) {
  return (
    <TextField
      value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': placeholder } }}
      sx={{ width: { xs: '100%', sm: width } }}
    />
  );
}

export interface Opt { value: string | number; label: string }
export function FilterSelect({ label, value, options, onChange, minWidth = 150, allLabel = 'All' }: { label: string; value: string | number | undefined; options: Opt[]; onChange: (v: string) => void; minWidth?: number; allLabel?: string }) {
  const id = `f-${label.replace(/\W/g, '')}`;
  return (
    <FormControl size="small" sx={{ minWidth, flex: { xs: '1 1 140px', sm: '0 0 auto' } }}>
      <InputLabel id={`${id}-l`} shrink>{label}</InputLabel>
      <Select labelId={`${id}-l`} label={label} value={value ?? ''} onChange={(e) => onChange(String(e.target.value))} displayEmpty notched>
        <MenuItem value="">{allLabel}</MenuItem>
        {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
    </FormControl>
  );
}

export function FilterBar({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} alignItems="center" sx={{ mb: 2 }} role="search">
      {children}
      {trailing && <Box sx={{ ml: 'auto' }}>{trailing}</Box>}
    </Stack>
  );
}
