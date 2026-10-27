import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import CheckIcon from '@mui/icons-material/Check';
import { DemoBanner } from '@/components/ui';
import { USE_MOCK } from '@/services/config';

const POINTS = ['Discover jobs and see exactly why you are (or are not) eligible', 'Track applications, interviews and offers in one place', 'Ask the AI assistant — answers come from your real records'];

/** Split-screen frame shared by login / forgot / reset pages. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <DemoBanner />
      <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '5fr 6fr' } }}>
        <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', bgcolor: 'primary.main', color: '#fff', p: 6 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box aria-hidden sx={{ width: 42, height: 42, borderRadius: 3, bgcolor: 'secondary.main', display: 'grid', placeItems: 'center' }}><SchoolIcon /></Box>
            <Typography variant="h3" component="p">Campus Assistant</Typography>
          </Stack>
          <Box>
            <Typography variant="h1" sx={{ mb: 3, maxWidth: 440 }}>Placements, organised.</Typography>
            <Stack spacing={1.75} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {POINTS.map((p) => (
                <Stack key={p} component="li" direction="row" spacing={1.5} alignItems="flex-start">
                  <CheckIcon fontSize="small" sx={{ mt: 0.25, color: '#93c5fd' }} />
                  <Typography sx={{ color: 'rgba(255,255,255,.85)' }}>{p}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,.55)' }}>Riverstone Institute of Technology · Placement Cell{USE_MOCK ? ' (demo)' : ''}</Typography>
        </Box>
        <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 2.5, sm: 6 } }}>
          <Box sx={{ width: '100%', maxWidth: 420 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ display: { md: 'none' }, mb: 3 }}>
              <Box aria-hidden sx={{ width: 34, height: 34, borderRadius: 2.5, bgcolor: 'primary.main', color: '#fff', display: 'grid', placeItems: 'center' }}><SchoolIcon fontSize="small" /></Box>
              <Typography variant="h4" component="p">Campus Assistant</Typography>
            </Stack>
            <Typography variant="h2" component="h1">{title}</Typography>
            {subtitle && <Typography color="text.secondary" sx={{ mt: 0.75, mb: 3 }}>{subtitle}</Typography>}
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
