import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

import {
  RoleSelector,
  LoginForm,
  PatientSignupForm,
  DoctorSignupForm,
  NurseSignupForm,
  HospitalSignupForm,
  ForgotPasswordForm,
} from '../components';

export default function AuthPage({ onAuthSuccess }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive mode from route pathname
  const getModeFromPath = (pathname) => {
    if (pathname.includes('signup')) return 'signup';
    if (pathname.includes('forgot') || pathname.includes('reset')) return 'forgot_password';
    return 'login';
  };

  const mode = getModeFromPath(location.pathname);
  const [selectedRole, setSelectedRole] = useState('patient'); // 'patient' | 'doctor' | 'nurse' | 'hospital'
  const [signupPendingInfo, setSignupPendingInfo] = useState(null);

  const handleBackToHome = () => {
    navigate('/');
  };

  const handleSwitchToSignup = () => {
    setSignupPendingInfo(null);
    navigate('/signup');
  };

  const handleSwitchToLogin = () => {
    setSignupPendingInfo(null);
    navigate('/login');
  };

  const handleForgotPassword = () => {
    setSignupPendingInfo(null);
    navigate('/forgot-password');
  };

  // Direct redirection based strictly on BACKEND RETURNED ROLE
  const routeByRole = (role) => {
    const normalizedRole = (role || '').toUpperCase();
    switch (normalizedRole) {
      case 'PATIENT':
        return '/patient/dashboard';
      case 'DOCTOR':
        return '/doctor/dashboard';
      case 'NURSE':
        return '/nurse/dashboard';
      case 'HOSPITAL':
        return '/hospital/dashboard';
      case 'ADMIN':
        return '/admin/dashboard';
      default:
        return '/patient/dashboard';
    }
  };

  const handleLoginSuccess = (authResponse) => {
    const user = authResponse?.user;
    onAuthSuccess?.(user);

    if (user?.role) {
      const targetPath = routeByRole(user.role);
      navigate(targetPath);
    } else {
      navigate('/patient/dashboard');
    }
  };

  const handleSignupSuccess = (authResponse) => {
    const user = authResponse?.user;
    onAuthSuccess?.(user);

    // If patient, direct straight to dashboard
    if (user?.role === 'PATIENT' || user?.status === 'Active') {
      navigate('/patient/dashboard');
    } else {
      // For Doctor, Nurse, Hospital, status is Pending verification
      setSignupPendingInfo({
        name: user?.name,
        role: user?.role,
        message: authResponse?.message || 'Application submitted for administrative verification.'
      });
    }
  };

  return (
    <div className="auth-wrapper">
      {/* Back to Home Navigation */}
      <div className="auth-back-nav">
        <button
          type="button"
          className="btn-back-home"
          onClick={handleBackToHome}
          aria-label="Back to home page"
        >
          <span>←</span> Back to Home
        </button>
      </div>

      <div className="auth-container">
        {/* =========================================================================
            1. LEFT CURVED BLUE BANNER
           ========================================================================= */}
        <div className="auth-banner-left">
          {mode === 'login' && (
            <>
              <h1 className="auth-welcome-text">
                Welcome back
              </h1>
              <p className="auth-banner-subtext">
                Log into your Vaxora immunization portal to manage appointments, clinical records, and health analytics.
              </p>
            </>
          )}

          {mode === 'signup' && (
            <>
              <h1 className="auth-welcome-text">
                Welcome To Vaxora
              </h1>
              <p className="auth-banner-subtext">
                Join the national vaccination network for secure appointments, verified professional licensing, and live updates.
              </p>
            </>
          )}

          {mode === 'forgot_password' && (
            <>
              <h1 className="auth-welcome-text">
                Reset Password
              </h1>
              <p className="auth-banner-subtext">
                Verify your identity and set up a new password to regain access to your Vaxora healthcare profile.
              </p>
            </>
          )}
        </div>

        {/* =========================================================================
            2. RIGHT FORM CARD
           ========================================================================= */}
        <div className="auth-form-side">
          <div className="auth-card-inner">
            <div className="auth-header">
              <img src={logo} alt="Vaxora Logo" className="auth-logo" />
              {mode === 'signup' && !signupPendingInfo && (
                <h2 className="auth-form-title">Create an account</h2>
              )}
              {mode === 'forgot_password' && (
                <h2 className="auth-form-title">Reset Password</h2>
              )}
            </div>

            {/* Login Mode */}
            {mode === 'login' && (
              <LoginForm
                onSwitchToSignup={handleSwitchToSignup}
                onForgotPassword={handleForgotPassword}
                onSuccess={handleLoginSuccess}
              />
            )}

            {/* Forgot Password Mode */}
            {mode === 'forgot_password' && (
              <ForgotPasswordForm
                onSwitchToLogin={handleSwitchToLogin}
                onSuccess={handleSwitchToLogin}
              />
            )}

            {/* Signup Mode */}
            {mode === 'signup' && (
              <>
                {signupPendingInfo ? (
                  <div className="auth-success-alert" role="alert" style={{ textAlign: 'left' }}>
                    <h4 style={{ color: 'var(--color-accent)', fontSize: '1.15rem' }}>Application Under Review</h4>
                    <p style={{ marginTop: '8px', color: 'var(--color-text-body)' }}>
                      Thank you, <strong>{signupPendingInfo.name}</strong>. Your <strong>{signupPendingInfo.role}</strong> registration documents have been securely submitted for administrative verification.
                    </p>
                    <p style={{ marginTop: '8px', color: 'var(--color-text-body)', fontSize: '0.85rem' }}>
                      Once approved, you will be able to log into your dashboard and access clinical features.
                    </p>
                    <div style={{ marginTop: '18px' }}>
                      <button
                        type="button"
                        className="btn-auth-submit"
                        onClick={handleSwitchToLogin}
                      >
                        Return to Log In
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Role Selector at the top */}
                    <RoleSelector
                      selectedRole={selectedRole}
                      onSelectRole={setSelectedRole}
                    />

                    {/* Role-Specific Form Fields */}
                    {selectedRole === 'patient' && (
                      <PatientSignupForm onSuccess={handleSignupSuccess} />
                    )}

                    {selectedRole === 'doctor' && (
                      <DoctorSignupForm onSuccess={handleSignupSuccess} />
                    )}

                    {selectedRole === 'nurse' && (
                      <NurseSignupForm onSuccess={handleSignupSuccess} />
                    )}

                    {selectedRole === 'doctor_nurse' && (
                      <DoctorSignupForm onSuccess={handleSignupSuccess} />
                    )}

                    {selectedRole === 'hospital' && (
                      <HospitalSignupForm onSuccess={handleSignupSuccess} />
                    )}

                    <div className="auth-switch-row">
                      <button
                        type="button"
                        className="btn-auth-switch"
                        onClick={handleSwitchToLogin}
                      >
                        Already have an account? Log in
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
