import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Autocomplete, Chip, TextField } from '@mui/material';

/** Multi-value chip input (free text + suggestions) bound to a string[] form field. */
export function ChipInput<T extends FieldValues>({ name, control, label, options, disabled, helperText }: { name: Path<T>; control: Control<T>; label: string; options: string[]; disabled?: boolean; helperText?: string }) {
  return (
    <Controller name={name} control={control} render={({ field }) => (
      <Autocomplete
        multiple freeSolo disableClearable={disabled} readOnly={disabled} options={options.filter((o) => !(field.value as string[]).includes(o))}
        value={field.value as string[]} onChange={(_, v) => field.onChange([...new Set(v.map((x) => x.trim()).filter(Boolean))])}
        renderValue={(v, getItemProps) => v.map((o, i) => { const { key, ...p } = getItemProps({ index: i }); return <Chip key={key} size="small" label={o} {...p} />; })}
        renderInput={(params) => <TextField {...params} label={label} helperText={disabled ? undefined : helperText ?? 'Type and press Enter to add'} />}
      />
    )} />
  );
}
