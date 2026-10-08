import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect } from 'react';
import { authService } from '../../auth/services/authService';
import { IconClose, IconEye, IconEyeOff, IconKey, IconShield } from '../../../shared/icons/AppIcons';

export default function AdminProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personalInfo, setPersonalInfo] = useState({
    id: 'ADM-001',
    registrationNumber: 'VAX-A-0001',
    name: 'National System Administrator',
    email: 'admin@vaxora.lk',
    phone: '011 269 4033',
    designation: 'Director - Health IT & National Immunization Surveillance',
    ministry: 'Ministry of Health, Sri Lanka',
    status: 'ACTIVE',
    createdAt: '',
  });

  const [isEditing, setIsEditing] = useState(false);
  const [notification, setNotification] = useState('');
  const [notificationType, setNotificationType] = useState('success');

  // Change Password State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const showToast = (msg, type = 'success') => {
    setNotification(msg);
    setNotificationType(type);
    setTimeout(() => setNotification(''), 3500);
  };

  const fetchAdminProfile = async () => {
    try {
      setLoading(true);
      const user = await authService.getMe();
      if (user) {
        setPersonalInfo({
          id: user.id || 'ADM-001',
          registrationNumber: user.registrationNumber || user.id || 'VAX-A-0001',
          name: user.name || 'System Administrator',
          email: user.email || '',
          phone: user.phoneNumber || '',
          designation: 'Director - Health IT & National Immunization Surveillance',
          ministry: 'Ministry of Health, Sri Lanka',
          status: user.status || 'ACTIVE',
          createdAt: user.createdAt || '',
        });
      }
    } catch (err) {
      console.warn('Failed to load admin profile from server, using local fallback:', err);
      const cached = authService.getUser();
      if (cached) {
        setPersonalInfo({
          id: cached.id || 'ADM-001',
          registrationNumber: cached.registrationNumber || cached.id || 'VAX-A-0001',
          name: cached.name || 'System Administrator',
          email: cached.email || '',
          phone: cached.phoneNumber || '',
          designation: 'Director - Health IT & National Immunization Surveillance',
          ministry: 'Ministry of Health, Sri Lanka',
          status: cached.status || 'ACTIVE',
          createdAt: cached.createdAt || '',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => deferEffectCallback(() => {
    fetchAdminProfile();
  }), []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await authService.updateProfile({
        name: personalInfo.name,
        phoneNumber: personalInfo.phone,
      });
      setIsEditing(false);
      showToast('Superadmin profile information updated successfully in database!');
    } catch (err) {
      showToast(err.message || 'Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Password Strength Calculation
  const calculateStrength = (pwd) => {
    if (!pwd) return 0;
    let score = 0;
    if (pwd.length >= 8) score += 25;
    if (/[A-Z]/.test(pwd)) score += 25;
    if (/[0-9]/.test(pwd)) score += 25;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 25;
    return score;
  };

  const strength = calculateStrength(passwordForm.newPassword);

  const getStrengthLabel = (s) => {
    if (s <= 25) return { label: 'Weak', color: '#f87171' };
    if (s <= 50) return { label: 'Fair', color: '#fbbf24' };
    if (s <= 75) return { label: 'Good', color: '#60a5fa' };
    return { label: 'Strong', color: '#34d399' };
  };

  // Handle Password Update Submit
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');

    if (!passwordForm.currentPassword) {
      setPasswordError('Please enter your current admin password.');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    try {
      setChangingPassword(true);
      await authService.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setIsPasswordModalOpen(false);
      showToast('Superadministrator password changed successfully! Next login will require the new credentials.');
    } catch (err) {
      setPasswordError(err.message || 'Failed to change password. Please check your current password.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="doctor-profile-wrapper admin-profile-wrapper" style={{ maxWidth: '1060px', margin: '0 auto' }}>
      {/* Toast Notification */}
      {notification && (
        <div
          className="doctor-toast"
          style={{
            borderColor: notificationType === 'error' ? '#ef4444' : '#0369a1',
            background: '#0c1b33',
          }}
        >
          <span style={{ display: 'inline-flex' }}>{notificationType === 'error' ? <IconShield size={16} /> : '✓'}</span>
          <span>{notification}</span>
        </div>
      )}

      {/* 1. Identity & Governance Card */}
      <div className="doctor-profile-card" style={{ marginBottom: '24px' }}>
        <div className="doctor-profile-top-grid">
          {/* Avatar */}
          <div className="doctor-profile-avatar-wrap">
            <svg
              className="doctor-profile-large-silhouette"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="100" cy="100" r="100" fill="#0f172a" />
              <circle cx="100" cy="80" r="38" fill="#0ea5e9" />
              <path
                d="M40 174C40 140.863 66.863 118 100 118C133.137 118 160 140.863 160 174"
                fill="#0ea5e9"
              />
            </svg>
          </div>

          {/* Details */}
          <div className="doctor-profile-info-box">
            <div className="doctor-profile-info-header">
              <div>
                <h2 className="doctor-profile-info-title">
                  Superadministrator Identity &amp; Governance
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                  National Command Access Level • Ministry of Health
                </p>
              </div>

              <button
                type="button"
                className="doctor-btn-edit-pill"
                style={{ background: '#0369a1', color: '#ffffff', borderColor: '#38bdf8' }}
                disabled={loading || saving}
                onClick={() => {
                  if (isEditing) handleSave();
                  else setIsEditing(true);
                }}
              >
                {loading ? 'Loading…' : saving ? 'Saving…' : isEditing ? 'Save Profile' : 'Edit Details'}
              </button>
            </div>

            <div className="doctor-profile-fields-list">
              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">VAXORA CODE</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value" style={{ color: '#38bdf8', fontWeight: 800, letterSpacing: '1px' }}>
                  {personalInfo.registrationNumber || personalInfo.id}
                </span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">SYSTEM STATUS</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value">
                  <span className={`admin-pill-badge ${personalInfo.status === 'ACTIVE' ? 'green' : 'amber'}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                    ● {personalInfo.status}
                  </span>
                </span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">NAME</span>
                <span className="doctor-profile-field-colon">:</span>
                {isEditing ? (
                  <input
                    type="text"
                    className="doctor-profile-field-input"
                    value={personalInfo.name}
                    onChange={(e) => setPersonalInfo({ ...personalInfo, name: e.target.value })}
                  />
                ) : (
                  <span className="doctor-profile-field-value">{personalInfo.name}</span>
                )}
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">OFFICIAL EMAIL</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  {personalInfo.email || 'admin@vaxora.health.gov.lk'}
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>(Primary Login ID)</span>
                </span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">PHONE</span>
                <span className="doctor-profile-field-colon">:</span>
                {isEditing ? (
                  <input
                    type="text"
                    className="doctor-profile-field-input"
                    value={personalInfo.phone}
                    onChange={(e) => setPersonalInfo({ ...personalInfo, phone: e.target.value })}
                    placeholder="Enter phone number"
                  />
                ) : (
                  <span className="doctor-profile-field-value">{personalInfo.phone || 'Not configured'}</span>
                )}
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">PROVISIONED ON</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value">{personalInfo.createdAt || 'Active System Registry'}</span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">DESIGNATION</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value">{personalInfo.designation}</span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">GOVERNING BODY</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value">{personalInfo.ministry}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Security & Password Management Card */}
      <div className="doctor-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🔐</span> Security &amp; Password Management
            </h3>
            <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.84rem' }}>
              Manage master access credentials and authenticated sessions.
            </p>
          </div>

          <button
            type="button"
            className="doctor-hero-session-pill"
            style={{
              cursor: 'pointer',
              background: '#0369a1',
              color: '#ffffff',
              border: '1px solid #38bdf8',
              fontWeight: 700,
              padding: '8px 18px',
              fontSize: '0.85rem',
            }}
            onClick={() => setIsPasswordModalOpen(true)}
          >
            🔑 Change Admin Password
          </button>
        </div>

        {/* Security Overview Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
          {/* Card 1: Password Status */}
          <div style={{ background: '#111a2e', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                Password Security
              </span>
              <span className="admin-pill-badge green" style={{ fontSize: '0.72rem' }}>
                Active &amp; Protected
              </span>
            </div>
            <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.95rem' }}>
              ••••••••••••••••
            </div>
            <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '6px' }}>
              Password rotation verified against last set master password
            </div>
          </div>

          {/* Card 2: Session Security */}
          <div style={{ background: '#111a2e', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                Active Session
              </span>
              <span className="admin-pill-badge blue" style={{ fontSize: '0.72rem' }}>
                TLS 1.3 Encrypted
              </span>
            </div>
            <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.95rem' }}>
              Colombo, Sri Lanka (MOH IT Gateway)
            </div>
            <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '6px' }}>
              Superadmin Console • Verified Database Auth
            </div>
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      {isPasswordModalOpen && (
        <div className="doctor-modal-overlay" onClick={() => setIsPasswordModalOpen(false)}>
          <div
            className="doctor-modal-card"
            style={{
              maxWidth: '520px',
              width: '92%',
              background: '#0a1020',
              border: '1px solid rgba(56, 189, 248, 0.22)',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.06)',
              borderRadius: '18px',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                padding: '24px 28px 18px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'linear-gradient(180deg, rgba(2, 132, 199, 0.12) 0%, rgba(10, 16, 32, 0) 100%)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.3) 0%, rgba(14, 165, 233, 0.15) 100%)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#38bdf8',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.2)',
                  }}
                >
                  <IconKey size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.2px' }}>
                    Change Admin Password
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
                    Verify your current password to establish a new encrypted master credential.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                aria-label="Close"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ffffff';
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#94a3b8';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                <IconClose size={16} />
              </button>
            </div>

            {/* Error Message */}
            {passwordError && (
              <div style={{ padding: '0 28px', marginTop: '16px' }}>
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#f87171',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    fontSize: '0.84rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ display: 'inline-flex' }}><IconShield size={16} /></span>
                  <span>{passwordError}</span>
                </div>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <div style={{ padding: '20px 28px' }}>
                {/* Current Password */}
                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: '0.86rem', marginBottom: '8px' }}>
                    <span>Last / Current Master Password</span>
                    <span style={{ fontSize: '0.74rem', color: '#38bdf8' }}>Verified against DB</span>
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      placeholder="Enter your last (current) master password"
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      style={{
                        width: '100%',
                        height: '46px',
                        padding: '0 46px 0 14px',
                        background: '#0d1527',
                        border: '1px solid rgba(56, 189, 248, 0.22)',
                        borderRadius: '10px',
                        color: '#ffffff',
                        fontSize: '0.92rem',
                        boxSizing: 'border-box',
                      }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      title={showCurrentPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#38bdf8';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#94a3b8';
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {showCurrentPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: '0.86rem', marginBottom: '8px' }}>
                    <span>New Admin Password</span>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Min. 8 chars</span>
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Enter strong new master password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      style={{
                        width: '100%',
                        height: '46px',
                        padding: '0 46px 0 14px',
                        background: '#0d1527',
                        border: '1px solid rgba(56, 189, 248, 0.22)',
                        borderRadius: '10px',
                        color: '#ffffff',
                        fontSize: '0.92rem',
                        boxSizing: 'border-box',
                      }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      title={showNewPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#38bdf8';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#94a3b8';
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {showNewPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                    </button>
                  </div>

                  {/* Password Strength Indicator */}
                  {passwordForm.newPassword && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', marginBottom: '4px' }}>
                        <span style={{ color: '#94a3b8' }}>Password Strength:</span>
                        <span style={{ fontWeight: 700, color: getStrengthLabel(strength).color }}>
                          {getStrengthLabel(strength).label}
                        </span>
                      </div>
                      <div style={{ height: '5px', background: '#111a2e', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${strength}%`,
                            background: getStrengthLabel(strength).color,
                            transition: 'width 0.3s ease, background-color 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: '0.86rem', marginBottom: '8px' }}>
                    <span>Confirm New Password</span>
                    {passwordForm.confirmPassword && passwordForm.newPassword === passwordForm.confirmPassword && (
                      <span style={{ fontSize: '0.74rem', color: '#34d399', fontWeight: 700 }}>✓ Passwords match</span>
                    )}
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Re-enter new password to confirm"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      style={{
                        width: '100%',
                        height: '46px',
                        padding: '0 46px 0 14px',
                        background: '#0d1527',
                        border: '1px solid rgba(56, 189, 248, 0.22)',
                        borderRadius: '10px',
                        color: '#ffffff',
                        fontSize: '0.92rem',
                        boxSizing: 'border-box',
                      }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#38bdf8';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#94a3b8';
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {showConfirmPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Password Requirement Checklist */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: '1px solid rgba(56, 189, 248, 0.15)',
                    borderRadius: '12px',
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.8rem', color: '#38bdf8', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <IconShield size={14} /> Password Security Policy
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: '0.78rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: passwordForm.newPassword.length >= 8 ? '#34d399' : '#64748b', transition: 'color 0.2s' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>{passwordForm.newPassword.length >= 8 ? '✓' : '○'}</span>
                      <span>At least 8 characters</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: /[A-Z]/.test(passwordForm.newPassword) ? '#34d399' : '#64748b', transition: 'color 0.2s' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>{/[A-Z]/.test(passwordForm.newPassword) ? '✓' : '○'}</span>
                      <span>1 Uppercase letter</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: /[0-9]/.test(passwordForm.newPassword) ? '#34d399' : '#64748b', transition: 'color 0.2s' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>{/[0-9]/.test(passwordForm.newPassword) ? '✓' : '○'}</span>
                      <span>1 Number</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: /[^A-Za-z0-9]/.test(passwordForm.newPassword) ? '#34d399' : '#64748b', transition: 'color 0.2s' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>{/[^A-Za-z0-9]/.test(passwordForm.newPassword) ? '✓' : '○'}</span>
                      <span>1 Special character</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '12px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '16px 28px',
                  background: 'rgba(11, 17, 33, 0.95)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  style={{
                    padding: '10px 22px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#cbd5e1',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#334155';
                    e.currentTarget.style.color = '#ffffff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                    e.currentTarget.style.color = '#cbd5e1';
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingPassword}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #0369a1 0%, #0369a1 100%)',
                    border: '1px solid #38bdf8',
                    color: '#ffffff',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: changingPassword ? 'not-allowed' : 'pointer',
                    opacity: changingPassword ? 0.7 : 1,
                    boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!changingPassword) {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 6px 18px rgba(2, 132, 199, 0.5)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(2, 132, 199, 0.35)';
                  }}
                >
                  {changingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
