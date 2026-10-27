import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import type { Permission, Role } from '@/types';
import { useAuth } from '@/auth/AuthContext';
import { ROLE_HOME } from '@/auth/permissions';
import { ForbiddenPage } from '@/pages/auth/Forbidden';

export const FullPageSpinner = () => (
  <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Loading" /></Box>
);

/** Frontend route protection is a UX layer only — the Flask API re-checks every request. */
export function RequireRole({ role }: { role: Role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role !== role) return <Navigate to="/forbidden" replace />;
  if (role === 'student' && !user.onboardingComplete && location.pathname !== '/student/onboarding') return <Navigate to="/student/onboarding" replace />;
  return <Outlet />;
}

/** Hides a page the user's role lacks permission for and shows the access-denied state in place. */
export function RequirePerm({ perm, children }: { perm: Permission | Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  const list = Array.isArray(perm) ? perm : [perm];
  return list.some(can) ? <>{children}</> : <ForbiddenPage embedded />;
}

export function PublicOnly() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (user) {
    // Return to the page the user originally asked for, but only if it belongs to their role.
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith(`/${user.role}`) ? from : ROLE_HOME[user.role]} replace />;
  }
  return <Outlet />;
}

export function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}
