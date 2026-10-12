import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useState } from 'react';
import deskService from '../services/deskService';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';

function formatLastLogin(value) {
  if (!value) return 'Never signed in';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never signed in';
  return `Last sign-in ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Hospital manager: create and remove the logins used at the front desk. */
export default function DeskAccountsPanel() {
  const [confirm, confirmDialog] = useConfirmDialog();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionId, setActionId] = useState(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await deskService.getDeskAccounts();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load front desk accounts.');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => {
    loadAccounts();
  }), [loadAccounts]);

  const closeModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setFullName('');
    setPhoneNumber('');
    setEmail('');
    setPassword('');
    setFormError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setFormError('Enter the staff member\'s full name.');
      return;
    }
    const trimmedPhone = phoneNumber.trim();
    if (trimmedPhone && !/^\+?[0-9 ]{9,15}$/.test(trimmedPhone)) {
      setFormError('Enter a valid phone number.');
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError('Enter the email the desk will sign in with.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');
    try {
      await deskService.createDeskAccount({
        fullName: trimmedName,
        phoneNumber: trimmedPhone,
        email: trimmedEmail,
        password,
      });
      setIsModalOpen(false);
      setFullName('');
      setPhoneNumber('');
      setEmail('');
      setPassword('');
      await loadAccounts();
    } catch (err) {
      setFormError(err.message || 'Failed to create front desk account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (account) => {
    const ok = await confirm({
      title: 'Remove desk account?',
      message: `Remove ${account.fullName || account.email}? They will be signed out and can no longer use the front desk.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setActionId(account.affiliationId);
    setError('');
    try {
      await deskService.removeDeskAccount(account.affiliationId);
      await loadAccounts();
    } catch (err) {
      setError(err.message || 'Failed to remove front desk account.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="hospital-section-card" id="desk-accounts">
      <div className="section-card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="section-title-group">
          <h2>Front desk accounts</h2>
          <p className="section-title-desc">
            Separate logins for reception. They handle appointments only: check-in, walk-ins, payments, no-shows and bookings.
          </p>
        </div>
        <div className="section-controls-group">
          <button
            type="button"
            className="hospital-staff-hero-btn primary"
            onClick={() => setIsModalOpen(true)}
          >
            <span>+</span> Add Desk Account
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: '0.875rem', margin: '12px 0 0' }} role="alert">
          {error}
        </p>
      )}

      <div
        className="booths-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: '16px' }}
      >
        {loading ? (
          <div className="empty-state-text" style={{ gridColumn: '1 / -1' }}>
            Loading front desk accounts...
          </div>
        ) : accounts.length === 0 ? (
          <div className="empty-state-text" style={{ gridColumn: '1 / -1' }}>
            {error ? 'Front desk accounts are unavailable right now.' : 'No front desk accounts yet.'}
          </div>
        ) : (
          accounts.map((account) => (
            <div
              key={account.affiliationId}
              className="booth-card"
              style={{
                '--tone': 'var(--color-info)',
                padding: '18px',
                border: '1px solid rgba(var(--rgb-primary-dark), 0.18)',
              }}
            >
              <div className="booth-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    className="booth-number-tag"
                    style={{
                      background: 'var(--color-info)',
                      color: 'var(--color-text-inverse)',
                      borderColor: 'var(--color-info)',
                    }}
                  >
                    Front desk
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      background: 'var(--color-info-bg)',
                      color: 'var(--color-primary)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-info-border)',
                    }}
                  >
                    {account.registrationNumber}
                  </span>
                </div>
              </div>

              <div className="staff-text-group" style={{ gap: '2px', marginTop: '12px', minWidth: 0 }}>
                <span className="staff-name" style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}>
                  {account.fullName || account.email}
                </span>
                {account.fullName && (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                    {account.email}
                  </span>
                )}
                {account.phoneNumber && (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {account.phoneNumber}
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {formatLastLogin(account.lastLoginAt)}
                </span>
              </div>

              <div className="booth-stats-row" style={{ paddingTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => handleRemove(account)}
                  disabled={actionId === account.affiliationId}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-error)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {actionId === account.affiliationId ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Add Desk Account</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '3px 0 0' }}>
                  Create a login for a front desk staff member
                </p>
              </div>
              <button type="button" className="modal-close-btn" onClick={closeModal} disabled={isSubmitting}>
                &times;
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="modal-form-group">
                  <label className="modal-label" htmlFor="desk-account-name">Full name *</label>
                  <input
                    id="desk-account-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. John Smith"
                    className="modal-input"
                    disabled={isSubmitting}
                    maxLength={150}
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                <div className="modal-form-group">
                  <label className="modal-label" htmlFor="desk-account-phone">Phone</label>
                  <input
                    id="desk-account-phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. 0771234567"
                    className="modal-input"
                    disabled={isSubmitting}
                    maxLength={20}
                    autoComplete="off"
                  />
                </div>

                <div className="modal-form-group">
                  <label className="modal-label" htmlFor="desk-account-email">Email *</label>
                  <input
                    id="desk-account-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. reception@hospital.lk"
                    className="modal-input"
                    disabled={isSubmitting}
                    autoComplete="off"
                  />
                </div>

                <div className="modal-form-group">
                  <label className="modal-label" htmlFor="desk-account-password">Password *</label>
                  <input
                    id="desk-account-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="modal-input"
                    disabled={isSubmitting}
                    autoComplete="new-password"
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Share it with the staff member. They sign in on the normal login page.
                  </span>
                </div>

                {formError && (
                  <div style={{ color: 'var(--color-error)', fontSize: '0.875rem', marginTop: '8px' }} role="alert">
                    {formError}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={closeModal} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-modal-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
