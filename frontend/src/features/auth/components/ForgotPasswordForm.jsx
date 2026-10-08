import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { authService } from '../services/authService';

export default function ForgotPasswordForm({ onSwitchToLogin, onSuccess }) {
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [step, setStep] = useState(1); // 1: Enter email, 2: Enter code & new password, 3: Completed
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-detect token and email from URL link (e.g. from password reset email)
  useEffect(() => deferEffectCallback(() => {
    const params = new URLSearchParams(location.search);
    const tokenParam = params.get('token') || params.get('code');
    const emailParam = params.get('email');

    if (emailParam) {
      setEmail(emailParam);
    }
    if (tokenParam) {
      setResetCode(tokenParam);
      setStep(2);
    }
  }), [location.search]);

  const handleSendEmail = async (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');

    try {
      await authService.forgotPassword(email);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Failed to send reset instructions. Please check your email.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await authService.resetPassword(email, resetCode, newPassword, confirmPassword);
      setStep(3);
      setTimeout(() => {
        onSuccess?.();
      }, 2000);
    } catch (err) {
      setError(err.message || 'Invalid or expired verification token.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {step === 1 && (
        <form onSubmit={handleSendEmail} className="auth-form">
          <p style={{ fontSize: '0.92rem', color: 'var(--color-text-body)', textAlign: 'center', marginBottom: '8px' }}>
            Enter your registered email address and we will send you a verification code to reset your password.
          </p>

          {error && (
            <div style={{ 
              backgroundColor: 'rgba(var(--rgb-error), 0.1)', 
              color: 'var(--color-error)', 
              padding: '10px 14px', 
              borderRadius: '8px', 
              fontSize: '0.85rem', 
              fontWeight: 600,
              border: '1px solid rgba(var(--rgb-error), 0.2)' 
            }}>
              {error}
            </div>
          )}

          <div className="auth-input-group">
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="Registered Email Address"
              required
              disabled={loading}
              className="auth-input"
            />
          </div>

          <button type="submit" className="btn-auth-submit" disabled={loading}>
            {loading ? 'Sending Code...' : 'Send Reset Code'}
          </button>

          <div className="auth-switch-row">
            <button
              type="button"
              className="btn-auth-switch"
              onClick={onSwitchToLogin}
              disabled={loading}
            >
              Remember your password? Log in
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleResetPassword} className="auth-form">
          <div style={{ background: 'var(--color-info-bg)', border: '1px solid var(--color-info-border)', borderRadius: '10px', padding: '12px', fontSize: '0.86rem', color: 'var(--color-primary)', textAlign: 'center' }}>
            Password reset verification token for <strong>{email}</strong>
          </div>

          {error && (
            <div style={{ 
              backgroundColor: 'rgba(var(--rgb-error), 0.1)', 
              color: 'var(--color-error)', 
              padding: '10px 14px', 
              borderRadius: '8px', 
              fontSize: '0.85rem', 
              fontWeight: 600,
              border: '1px solid rgba(var(--rgb-error), 0.2)' 
            }}>
              {error}
            </div>
          )}

          <div className="auth-input-group">
            <input
              type="text"
              name="resetCode"
              value={resetCode}
              onChange={(e) => { setResetCode(e.target.value); setError(''); }}
              placeholder="Password Reset Token / Verification Code"
              required
              disabled={loading}
              className="auth-input"
            />
          </div>

          <div className="auth-input-group">
            <div className="password-input-container">
              <input
                type={showNewPassword ? 'text' : 'password'}
                name="newPassword"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
                placeholder="New Password (Min 6 characters)"
                required
                disabled={loading}
                className="auth-input"
              />
              <button
                type="button"
                className="btn-password-toggle"
                onClick={() => setShowNewPassword((prev) => !prev)}
                tabIndex={-1}
                title={showNewPassword ? 'Hide password' : 'Show password'}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
              >
                {showNewPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="auth-input-group">
            <div className="password-input-container">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder="Confirm New Password"
                required
                disabled={loading}
                className="auth-input"
              />
              <button
                type="button"
                className="btn-password-toggle"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                tabIndex={-1}
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-auth-submit" disabled={loading}>
            {loading ? 'Resetting Password...' : 'Reset Password'}
          </button>

          <div className="auth-switch-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="btn-auth-switch"
              onClick={() => { setStep(1); setError(''); }}
              style={{ fontSize: '0.85rem' }}
              disabled={loading}
            >
              Change email
            </button>
            <button
              type="button"
              className="btn-auth-switch"
              onClick={onSwitchToLogin}
              style={{ fontSize: '0.85rem' }}
              disabled={loading}
            >
              Back to Log in
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="auth-success-alert" role="alert">
          <h4>Password Reset Successful!</h4>
          <p>Your password has been updated in Vaxora. Redirecting to login...</p>
          <div style={{ marginTop: '14px' }}>
            <button
              type="button"
              className="btn-auth-submit"
              onClick={onSwitchToLogin}
            >
              Proceed to Log in
            </button>
          </div>
        </div>
      )}
    </>
  );
}
