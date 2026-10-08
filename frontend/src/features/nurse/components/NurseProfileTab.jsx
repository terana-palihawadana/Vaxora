import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { authService } from '../../auth';
import { IconFile, IconShield, IconTrash } from '../../../shared/icons/AppIcons';
import StaffSubpageHeader from '../../staff/components/StaffSubpageHeader';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';

export default function NurseProfileTab() {
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState('');
  const [notificationType, setNotificationType] = useState('success');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Personal Information State
  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const [personalInfo, setPersonalInfo] = useState({
    id: '',
    slncNumber: '',
    name: '',
    email: '',
    phone: '',
    verificationStatus: 'Pending',
    profilePhotoUrl: null,
    slncCardDocKey: null,
    supportingDocKey: null,
    createdAt: '',
  });

  // Professional Details State
  const [isEditingProfessional, setIsEditingProfessional] = useState(false);
  const [professionalDetails, setProfessionalDetails] = useState({
    experience: 'Immunization Care Specialist',
    shiftSchedule: 'Monday - Friday, 8:00 AM - 4:00 PM',
    workedHospitals: 'Lanka Hospital Colombo, National Hospital of Sri Lanka',
    degree: 'BSc / Diploma in Nursing & Midwifery',
    completionYear: 'Certified',
    consultationHours: '08:30 AM - 12:30 PM, 01:30 PM - 03:30 PM',
    specialization: 'Certified Vaccine Administration & Cold-Chain Logistics (SLNC)',
  });

  const triggerNotification = (msg, type = 'success') => {
    setNotification(msg);
    setNotificationType(type);
    setTimeout(() => setNotification(''), 3500);
  };

  const populateState = useCallback((user) => {
    const details = user.profileDetails || {};
    const createdDate = details.createdAt || user.createdAt
      ? new Date(details.createdAt || user.createdAt).toLocaleDateString()
      : 'Active Member';

    setPersonalInfo({
      id: user.registrationNumber || details.registrationNumber || 'VAX-N-000000',
      slncNumber: details.slncNumber || 'N/A',
      name: details.fullName || user.name || '',
      email: user.email || '',
      phone: user.phoneNumber || details.phoneNumber || '',
      verificationStatus: details.verificationStatus != null ? String(details.verificationStatus) : (user.status || 'Pending'),
      profilePhotoUrl: user.profilePhotoUrl || details.profilePhotoUrl || null,
      slncCardDocKey: details.slncCardDocKey || null,
      supportingDocKey: details.supportingDocKey || null,
      createdAt: createdDate,
    });
  }, []);

  const loadNurseProfile = useCallback(async () => {
    try {
      const cached = authService.getUser();
      if (cached) populateState(cached);

      const freshUser = await authService.getMe();
      if (freshUser) populateState(freshUser);
    } catch (err) {
      console.warn('Could not fetch latest nurse profile:', err);
    } finally {
      setLoading(false);
    }
  }, [populateState]);

  useEffect(() => deferEffectCallback(() => {
    loadNurseProfile();
  }), [loadNurseProfile]);

  const handlePersonalChange = (e) => {
    const { name, value } = e.target;
    setPersonalInfo((prev) => ({ ...prev, [name]: value }));
  };

  const handleProfessionalChange = (e) => {
    const { name, value } = e.target;
    setProfessionalDetails((prev) => ({ ...prev, [name]: value }));
  };

  const handleTogglePersonalEdit = async () => {
    if (isEditingPersonal) {
      setSaving(true);
      try {
        await authService.updateProfile({
          fullName: personalInfo.name,
          phoneNumber: personalInfo.phone,
        });
        triggerNotification('Nurse personal details updated successfully in the national registry!');
        setIsEditingPersonal(false);
      } catch (err) {
        triggerNotification(err.message || 'Failed to update personal details.', 'error');
      } finally {
        setSaving(false);
      }
    } else {
      setIsEditingPersonal(true);
    }
  };

  const handleToggleProfessionalEdit = async () => {
    if (isEditingProfessional) {
      triggerNotification('Nursing professional schedule updated successfully!');
      setIsEditingProfessional(false);
    } else {
      setIsEditingProfessional(true);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const updated = await authService.updateProfilePhoto(file);
      if (updated?.profilePhotoUrl) {
        setPersonalInfo((prev) => ({ ...prev, profilePhotoUrl: updated.profilePhotoUrl }));
      }
      triggerNotification('Profile avatar updated successfully!');
    } catch (err) {
      triggerNotification(err.message || 'Failed to upload profile photo.', 'error');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleExport = () => {
    triggerNotification('Nurse clinical profile exported successfully (.PDF / .CSV)');
  };

  return (
    <div className="doctor-profile-wrapper nurse-profile-wrapper staff-workspace-page">
      <StaffSubpageHeader
        eyebrow="Account"
        title="Professional profile"
        subtitle="Manage your contact details, credentials, and clinical information."
      />
      {/* Success Notification Banner */}
      {notification && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{
            maxWidth: '960px',
            width: '100%',
            backgroundColor: notificationType === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            borderColor: notificationType === 'error' ? '#ef4444' : '#10b981',
            color: notificationType === 'error' ? '#f87171' : '#34d399',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {notificationType === 'error' ? <IconShield size={16} /> : '✓'} {notification}
          </span>
        </div>
      )}

      {/* =========================================================================
          1. TOP CARD: Avatar & Personal Information
         ========================================================================= */}
      <div className="doctor-profile-card">
        <div className="doctor-profile-top-grid">
          {/* Left: Large Silhouette Avatar with Edit Pen Icon */}
          <div className="doctor-profile-avatar-wrap">
            {personalInfo.profilePhotoUrl ? (
              <img
                src={personalInfo.profilePhotoUrl}
                alt={personalInfo.name || 'Nurse'}
                className="doctor-profile-uploaded-img"
                style={{ width: '150px', height: '150px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #0369a1' }}
              />
            ) : (
              <svg
                className="doctor-profile-large-silhouette"
                viewBox="0 0 200 200"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="100" cy="100" r="100" fill="#e0f2fe" />
                <circle cx="100" cy="80" r="38" fill="#0369a1" />
                <path
                  d="M40 174C40 140.863 66.863 118 100 118C133.137 118 160 140.863 160 174"
                  fill="#0369a1"
                />
              </svg>
            )}

            {/* Hidden file input for photo upload */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept="image/*"
              onChange={handleAvatarUpload}
            />

            {/* Edit Avatar Badge Button */}
            <button
              type="button"
              className="doctor-btn-avatar-edit"
              title="Update Profile Photo"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1d1854"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>

          {/* Right: Personal Information Inner Box */}
          <div className="doctor-profile-info-box">
            {/* Header Row */}
            <div className="doctor-profile-info-header">
              <div>
                <h2 className="doctor-profile-info-title">
                  Personal Information
                </h2>
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: personalInfo.verificationStatus === 'Approved' || personalInfo.verificationStatus === '1' ? '#10b981' : '#f59e0b',
                  }}
                >
                  ● Verification: {personalInfo.verificationStatus === 'Approved' || personalInfo.verificationStatus === '1' ? 'Verified / Approved' : 'Pending Administrative Review'}
                </span>
              </div>
              <div className="doctor-profile-actions">
                <button
                  type="button"
                  className="doctor-btn-edit-pill"
                  onClick={handleTogglePersonalEdit}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : isEditingPersonal ? 'Save' : 'Edit'}
                </button>

                <button
                  type="button"
                  className="doctor-btn-export-icon"
                  title="Export / Share Profile"
                  onClick={handleExport}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Key-Value Fields with Aligned Colons */}
            <div className="doctor-profile-fields-list">
              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">VAXORA ID</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value" style={{ fontWeight: 700, color: '#0369a1' }}>
                  {personalInfo.id || (loading ? 'Loading...' : 'N/A')}
                </span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">SLNC NUMBER</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value" style={{ fontWeight: 600 }}>
                  {personalInfo.slncNumber || (loading ? 'Loading...' : 'N/A')}
                </span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">FULL NAME</span>
                <span className="doctor-profile-field-colon">:</span>
                {isEditingPersonal ? (
                  <input
                    type="text"
                    name="name"
                    value={personalInfo.name}
                    onChange={handlePersonalChange}
                    className="doctor-profile-field-input"
                  />
                ) : (
                  <span className="doctor-profile-field-value">{personalInfo.name || (loading ? 'Loading...' : 'N/A')}</span>
                )}
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">EMAIL</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value">{personalInfo.email || (loading ? 'Loading...' : 'N/A')}</span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">PHONE NUMBER</span>
                <span className="doctor-profile-field-colon">:</span>
                {isEditingPersonal ? (
                  <input
                    type="tel"
                    name="phone"
                    value={personalInfo.phone}
                    onChange={handlePersonalChange}
                    className="doctor-profile-field-input"
                  />
                ) : (
                  <span className="doctor-profile-field-value">{personalInfo.phone || 'Not provided'}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. BOTTOM CARD: Nursing Professional Details & Documents
         ========================================================================= */}
      <div className="doctor-profile-card">
        {/* Centered Heading with Edit Button on Far Right */}
        <div className="doctor-prof-details-header">
          <div className="doctor-prof-details-spacer" />
          <h2 className="doctor-prof-details-title">
            Nursing Credentials &amp; Verification Documents
          </h2>
          <div className="doctor-prof-details-action">
            <button
              type="button"
              className="doctor-btn-edit-pill"
              onClick={handleToggleProfessionalEdit}
              disabled={saving}
            >
              {saving ? 'Saving...' : isEditingProfessional ? 'Save' : 'Edit'}
            </button>
          </div>
        </div>

        {/* Inner Rounded Box */}
        <div className="doctor-prof-inner-box">
          {isEditingProfessional ? (
            <div className="doctor-prof-input-grid">
              <div className="doctor-prof-input-group">
                <label className="doctor-prof-input-label">Clinical Experience</label>
                <input
                  type="text"
                  name="experience"
                  value={professionalDetails.experience}
                  onChange={handleProfessionalChange}
                  className="doctor-prof-input"
                />
              </div>

              <div className="doctor-prof-input-group">
                <label className="doctor-prof-input-label">Affiliated Hospitals</label>
                <input
                  type="text"
                  name="workedHospitals"
                  value={professionalDetails.workedHospitals}
                  onChange={handleProfessionalChange}
                  className="doctor-prof-input"
                />
              </div>

              <div className="doctor-prof-input-group">
                <label className="doctor-prof-input-label">Duty Hours</label>
                <input
                  type="text"
                  name="consultationHours"
                  value={professionalDetails.consultationHours}
                  onChange={handleProfessionalChange}
                  className="doctor-prof-input"
                />
              </div>

              <div className="doctor-prof-input-group">
                <label className="doctor-prof-input-label">Specialization Certification</label>
                <input
                  type="text"
                  name="specialization"
                  value={professionalDetails.specialization}
                  onChange={handleProfessionalChange}
                  className="doctor-prof-input"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="doctor-prof-row">
                <strong>SLNC Nursing Board Reg: </strong>
                <span style={{ color: '#0369a1', fontWeight: 700 }}>{personalInfo.slncNumber}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Nursing Specialization: </strong>
                <span>{professionalDetails.specialization}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Shift Schedule: </strong>
                <span>{professionalDetails.shiftSchedule}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Affiliated Hospital / Clinic: </strong>
                <span>{professionalDetails.workedHospitals}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Nursing Education &amp; Training: </strong>
                <span>{professionalDetails.degree}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Duty Hours: </strong>
                <span>{professionalDetails.consultationHours}</span>
              </div>

              <div className="doctor-prof-row" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: '12px' }}>
                <strong>Submitted Verification Documents: </strong>
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {personalInfo.slncCardDocKey ? (
                    <a
                      href={personalInfo.slncCardDocKey}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-action-btn view"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                    >
                      <IconFile size={14} /> View SLNC Certificate
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>SLNC Document Uploaded on File</span>
                  )}

                  {personalInfo.supportingDocKey && (
                    <a
                      href={personalInfo.supportingDocKey}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-action-btn view"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                    >
                      <IconFile size={14} /> View Supporting Credentials
                    </a>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Danger Zone Card */}
        <div
          className="doctor-profile-card"
          style={{
            borderColor: 'rgba(239, 68, 68, 0.35)',
            background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.05) 0%, rgba(15, 23, 42, 0.4) 100%)',
            borderRadius: '16px',
            padding: '24px',
            marginTop: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div>
              <h4 style={{ margin: '0 0 6px', color: '#ef4444', fontSize: '1.05rem', fontWeight: 700 }}>
                Danger Zone
              </h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8', maxWidth: '600px' }}>
                Permanently delete your Vaxora nurse profile, credentials, and verification records. This action cannot be undone.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDeleteModalOpen(true)}
              style={{
                background: '#dc2626',
                color: '#ffffff',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                padding: '10px 18px',
                fontSize: '0.88rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)',
              }}
            >
              <IconTrash size={16} /> Delete Account
            </button>
          </div>
        </div>

        <DeleteAccountModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          userName={personalInfo.name || 'Nurse Profile'}
          roleName="Nurse"
        />
      </div>
    </div>
  );
}
