
import { Navigate, useLocation } from 'react-router-dom';
import { getToken, getUser, clearAuth } from '../features/auth';

/**
 * Route guard that ensures user is authenticated, has the required role,
 * and is approved/Active by the system administrator.
 */
export default function ProtectedRoute({ allowedRoles = [], children }) {
  const token = getToken();
  const user = getUser();
  const location = useLocation();

  // 1. Not logged in
  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const userRole = (user.role || '').toUpperCase();
  const userStatus = (user.status || '').toLowerCase();

  // 2. Pending, Rejected or Suspended verification block (Doctor, Nurse, Hospital)
  if (userRole !== 'PATIENT' && userRole !== 'ADMIN') {
    if (userStatus === 'pending' || userStatus === 'pendingverification') {
      clearAuth();
      return (
        <Navigate
          to="/login"
          state={{
            message: 'Your account is currently under review by the Ministry of Health. Access will be granted once approved by the administrator.',
          }}
          replace
        />
      );
    }
    if (userStatus === 'rejected') {
      clearAuth();
      return (
        <Navigate
          to="/login"
          state={{
            message: 'Your registration application was not approved by the administrator.',
          }}
          replace
        />
      );
    }
    if (userStatus === 'suspended') {
      clearAuth();
      return (
        <Navigate
          to="/login"
          state={{
            message: 'Your account has been suspended by the administrator.',
          }}
          replace
        />
      );
    }
  }

  const normalizedAllowedRoles = allowedRoles.map((r) => r.toUpperCase());

  // 3. Role mismatch (e.g., patient trying to access /admin or /doctor)
  if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(userRole)) {
    switch (userRole) {
      case 'PATIENT':
        return <Navigate to="/patient/dashboard" replace />;
      case 'DOCTOR':
        return <Navigate to="/doctor/dashboard" replace />;
      case 'NURSE':
        return <Navigate to="/nurse/dashboard" replace />;
      case 'HOSPITAL':
        return <Navigate to="/hospital/dashboard" replace />;
      case 'FRONT_DESK':
        return <Navigate to="/desk" replace />;
      case 'ADMIN':
        return <Navigate to="/admin/dashboard" replace />;
      default:
        return <Navigate to="/login" replace />;
    }
  }

  return children;
}
