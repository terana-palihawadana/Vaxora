import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { IconShield } from '../../../shared/icons/AppIcons';

export default function DeleteAccountModal({ isOpen, onClose, userName, roleName }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleDelete = async () => {
    try {
      setLoading(true);
      setError('');
      await authService.deleteAccount();
      onClose();
      navigate('/login', {
        replace: true,
        state: { message: 'Your Vaxora account has been permanently deleted.' },
      });
    } catch (err) {
      console.error('Failed to delete account:', err);
      setError(err.message || 'Failed to delete your account. Please try again.');
      setLoading(false);
    }
  };

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(var(--rgb-primary-dark), 0.8)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '20px',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-primary-deep)',
          color: 'var(--color-text-inverse)',
          borderRadius: '16px',
          border: '1px solid rgba(var(--rgb-error), 0.4)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(var(--rgb-error), 0.25)',
          maxWidth: '480px',
          width: '100%',
          padding: '28px',
          position: 'relative',
          margin: 'auto',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning Icon & Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(var(--rgb-error), 0.15)',
              border: '1px solid rgba(var(--rgb-error), 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
              flexShrink: 0,
            }}
          >
            <IconShield size={22} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 800,
                color: 'var(--color-text-inverse)',
                fontFamily: 'var(--font-heading, "Outfit", sans-serif)',
              }}
            >
              Delete Account
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--color-text-placeholder)' }}>
              Permanent action for {roleName || 'User'}
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              background: 'rgba(var(--rgb-error), 0.15)',
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
              padding: '10px 12px',
              borderRadius: '8px',
              fontSize: '0.84rem',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        {/* Description Body */}
        <div
          style={{
            fontSize: '0.88rem',
            lineHeight: 1.5,
            color: 'var(--color-border-card)',
            marginBottom: '20px',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '14px',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--color-error)' }}>
            Are you sure you want to delete the account for "{userName || 'this profile'}"?
          </p>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-placeholder)' }}>
            This will permanently remove your profile, registration details, documents, and credentials from the Vaxora database. This action cannot be undone.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'var(--color-primary-dark)',
              color: 'var(--color-border-light)',
              border: '1px solid var(--color-text-body)',
              borderRadius: '8px',
              padding: '9px 18px',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            style={{
              background: 'var(--color-error)',
              color: 'var(--color-text-inverse)',
              border: '1px solid var(--color-error)',
              borderRadius: '8px',
              padding: '9px 20px',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(var(--rgb-error), 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {loading ? 'Deleting...' : 'Yes, Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
