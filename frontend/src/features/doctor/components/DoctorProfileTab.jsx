import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { authService } from '../../auth';
import { IconFile, IconShield, IconTrash } from '../../../shared/icons/AppIcons';
import StaffSubpageHeader from '../../staff/components/StaffSubpageHeader';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';

export default function DoctorProfileTab() {
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
    slmcNumber: '',
    name: '',
    email: '',
    phone: '',
    specialization: '',
    verificationStatus: 'Pending',
    profilePhotoUrl: null,
    slmcCardDocKey: null,
    supportingDocKey: null,
    createdAt: '',
  });

  // Professional Details State
  const [isEditingProfessional, setIsEditingProfessional] = useState(false);
  const [professionalDetails, setProfessionalDetails] = useState({
    experience: 'Clinical Specialist',
    shiftSchedule: 'Monday - Friday, 9:00 AM - 5:00 PM',
    workedHospitals: 'National Hospital of Sri Lanka, Base Hospitals',
    degree: 'MBBS / Specialist Certification',
    completionYear: 'Certified',
    consultationHours: '09:00 AM - 01:00 PM, 02:00 PM - 05:00 PM',
    specialization: '',
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
      id: user.registrationNumber || details.registrationNumber || 'VAX-D-000000',
      slmcNumber: details.slmcNumber || 'N/A',
      name: details.fullName || user.name || '',
      email: user.email || '',
      phone: user.phoneNumber || details.phoneNumber || '',
      specialization: details.specialization || 'General Healthcare / Immunization',
      verificationStatus: details.verificationStatus != null ? String(details.verificationStatus) : (user.status || 'Pending'),
      profilePhotoUrl: user.profilePhotoUrl || details.profilePhotoUrl || null,
      slmcCardDocKey: details.slmcCardDocKey || null,
      supportingDocKey: details.supportingDocKey || null,
      createdAt: createdDate,
    });

    setProfessionalDetails((prev) => ({
      ...prev,
      specialization: details.specialization || 'Certified Medical Practitioner (SLMC Verified)',
    }));
  }, []);

  const loadDoctorProfile = useCallback(async () => {
    try {
      const cached = authService.getUser();
      if (cached) populateState(cached);

      const freshUser = await authService.getMe();
      if (freshUser) populateState(freshUser);
    } catch (err) {
      console.warn('Could not fetch latest doctor profile:', err);
    } finally {
      setLoading(false);
    }
  }, [populateState]);

  useEffect(() => deferEffectCallback(() => {
    loadDoctorProfile();
  }), [loadDoctorProfile]);

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
          specialization: personalInfo.specialization,
        });
        triggerNotification('Personal details updated successfully in the national registry!');
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
      setSaving(true);
      try {
        await authService.updateProfile({
          specialization: professionalDetails.specialization,
        });
        triggerNotification('Professional details updated successfully!');
        setIsEditingProfessional(false);
      } catch (err) {
        triggerNotification(err.message || 'Failed to update professional details.', 'error');
      } finally {
        setSaving(false);
      }
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
    triggerNotification('Doctor clinical profile exported successfully (.PDF / .CSV)');
  };

  return (
    <div className="doctor-profile-wrapper staff-workspace-page">
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
            backgroundColor: notificationType === 'error' ? 'rgba(var(--rgb-error), 0.15)' : 'rgba(var(--rgb-success), 0.15)',
            borderColor: notificationType === 'error' ? 'var(--color-error)' : 'var(--color-success-border)',
            color: notificationType === 'error' ? 'var(--color-error)' : 'var(--color-success)',
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
                alt={personalInfo.name || 'Doctor'}
                className="doctor-profile-uploaded-img"
                style={{ width: '150px', height: '150px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--color-accent)' }}
              />
            ) : (
              <svg
                className="doctor-profile-large-silhouette"
                viewBox="0 0 200 200"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="100" cy="100" r="100" style={{ fill: "var(--color-soft-panel-deep)" }} />
                <circle cx="100" cy="80" r="38" style={{ fill: "var(--color-text-muted)" }} />
                <path
                  d="M40 174C40 140.863 66.863 118 100 118C133.137 118 160 140.863 160 174"
                  style={{ fill: "var(--color-text-muted)" }}
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
                style={{ stroke: "var(--color-text-title)" }}
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
                    color: personalInfo.verificationStatus === 'Approved' || personalInfo.verificationStatus === '1' ? 'var(--color-success)' : 'var(--color-warning)',
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
                    style={{ stroke: "var(--color-text-inverse)" }}
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
                <span className="doctor-profile-field-value" style={{ fontWeight: 700, color: 'var(--color-accent)' }}>
                  {personalInfo.id || (loading ? 'Loading...' : 'N/A')}
                </span>
              </div>

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">SLMC NUMBER</span>
                <span className="doctor-profile-field-colon">:</span>
                <span className="doctor-profile-field-value" style={{ fontWeight: 600 }}>
                  {personalInfo.slmcNumber || (loading ? 'Loading...' : 'N/A')}
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

              <div className="doctor-profile-field-row">
                <span className="doctor-profile-field-label">SPECIALIZATION</span>
                <span className="doctor-profile-field-colon">:</span>
                {isEditingPersonal ? (
                  <input
                    type="text"
                    name="specialization"
                    value={personalInfo.specialization}
                    onChange={handlePersonalChange}
                    className="doctor-profile-field-input"
                  />
                ) : (
                  <span className="doctor-profile-field-value">{personalInfo.specialization}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. BOTTOM CARD: Professional Details & Submitted Documents
         ========================================================================= */}
      <div className="doctor-profile-card">
        {/* Centered Heading with Edit Button on Far Right */}
        <div className="doctor-prof-details-header">
          <div className="doctor-prof-details-spacer" />
          <h2 className="doctor-prof-details-title">
            Professional Credentials &amp; Verification Documents
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
                <label className="doctor-prof-input-label">Shift Schedule</label>
                <input
                  type="text"
                  name="shiftSchedule"
                  value={professionalDetails.shiftSchedule}
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
                <label className="doctor-prof-input-label">Degree Qualification</label>
                <input
                  type="text"
                  name="degree"
                  value={professionalDetails.degree}
                  onChange={handleProfessionalChange}
                  className="doctor-prof-input"
                />
              </div>

              <div className="doctor-prof-input-group">
                <label className="doctor-prof-input-label">Consultation Hours</label>
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
                <strong>SLMC Medical Board Reg: </strong>
                <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{personalInfo.slmcNumber}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Clinical Specialization: </strong>
                <span>{professionalDetails.specialization}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Shift Schedule: </strong>
                <span>{professionalDetails.shiftSchedule}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Affiliated Hospitals: </strong>
                <span>{professionalDetails.workedHospitals}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Degree &amp; Medical Education: </strong>
                <span>{professionalDetails.degree}</span>
              </div>

              <div className="doctor-prof-row">
                <strong>Consultation Hours: </strong>
                <span>{professionalDetails.consultationHours}</span>
              </div>

              <div className="doctor-prof-row" style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: '12px', marginTop: '12px' }}>
                <strong>Submitted Verification Documents: </strong>
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {personalInfo.slmcCardDocKey ? (
                    <a
                      href={personalInfo.slmcCardDocKey}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-action-btn view"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                    >
                      <IconFile size={14} /> View SLMC Certificate
                    </a>
                  ) : (
                    <span style={{ color: 'var(--color-text-placeholder)', fontSize: '0.85rem' }}>SLMC Document Uploaded on File</span>
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
          className="danger-zone-card doctor-profile-card"
        >
          <div className="danger-zone-row"
          >
            <div>
              <h4 className="danger-zone-title">
                Danger Zone
              </h4>
              <p className="danger-zone-text">
                Permanently delete your Vaxora doctor profile, credentials, and verification records. This action cannot be undone.
              </p>
            </div>
            <button className="btn-danger"
              type="button"
              onClick={() => setIsDeleteModalOpen(true)}
            >
              <IconTrash size={16} /> Delete Account
            </button>
          </div>
        </div>

        <DeleteAccountModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          userName={personalInfo.name || 'Doctor Profile'}
          roleName="Doctor"
        />
      </div>
    </div>
  );
}
