import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { authService } from '../../auth';
import AddStaffRequestModal from './AddStaffRequestModal';
import staffService from '../services/staffService';
import { IconDoctor, IconFile, IconNurse } from './HospitalIcons';
import HospitalSubpageHero from './HospitalSubpageHero';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';
import { IconTrash } from '../../../shared/icons/AppIcons';

export default function HospitalProfileTab() {
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [notification, setNotification] = useState('');
  const [notificationType, setNotificationType] = useState('success');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [hospitalInfo, setHospitalInfo] = useState({
    id: '',
    regNumber: '',
    name: '',
    email: '',
    hospitalNumber: '',
    hospitalType: '',
    operatingHours: '',
    address: '',
    district: '',
    province: '',
    verificationStatus: 'Pending',
    logoUrl: null,
    registrationDocKey: null,
    mohDocKey: null,
  });

  const [doctors, setDoctors] = useState([]);
  const [nurses, setNurses] = useState([]);

  const showNotification = (msg, type = 'success') => {
    setNotification(msg);
    setNotificationType(type);
    setTimeout(() => setNotification(''), 3500);
  };

  const populateState = useCallback((user) => {
    const details = user.profileDetails || {};
    setHospitalInfo({
      id: user.registrationNumber || details.registrationNumber || 'VAX-H-000000',
      regNumber: details.registrationNumber || 'N/A',
      name: details.hospitalName || user.name || '',
      email: user.email || '',
      hospitalNumber: details.contactNumber || user.phoneNumber || '',
      hospitalType: details.hospitalType || 'General Hospital',
      operatingHours: details.operatingHours || '24/7 Emergency & Outpatient',
      address: details.address || '',
      district: details.district || '',
      province: details.province || '',
      verificationStatus: details.verificationStatus != null ? String(details.verificationStatus) : (user.status || 'Pending'),
      logoUrl: user.profilePhotoUrl || details.logoUrl || null,
      registrationDocKey: details.registrationDocKey || null,
      mohDocKey: details.mohDocKey || null,
    });
  }, []);

  const applyStaffList = useCallback((list) => {
    const active = (Array.isArray(list) ? list : []).filter((item) => item.status === 'Active');
    setDoctors(
      active
        .filter((item) => item.staffRole === 'DOCTOR')
        .map((item) => ({
          id: item.affiliationId,
          name: item.staffName,
          photoUrl: item.staffProfilePhotoUrl || null,
        }))
    );
    setNurses(
      active
        .filter((item) => item.staffRole === 'NURSE')
        .map((item) => ({
          id: item.affiliationId,
          name: item.staffName,
          photoUrl: item.staffProfilePhotoUrl || null,
        }))
    );
  }, []);

  const loadHospitalProfile = useCallback(async () => {
    try {
      const cached = authService.getUser();
      if (cached) populateState(cached);

      const [freshUser, staffList] = await Promise.all([
        authService.getMe(),
        staffService.getHospitalStaff({ status: 'Active' }).catch(() => []),
      ]);
      if (freshUser) populateState(freshUser);
      applyStaffList(staffList);
    } catch (err) {
      console.warn('Could not fetch latest hospital profile:', err);
    } finally {
      setLoading(false);
    }
  }, [populateState, applyStaffList]);

  useEffect(() => deferEffectCallback(() => {
    loadHospitalProfile();
  }), [loadHospitalProfile]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setHospitalInfo((prev) => ({ ...prev, [name]: value }));
  };

  const handleToggleEdit = async () => {
    if (isEditing) {
      setSaving(true);
      try {
        await authService.updateProfile({
          hospitalName: hospitalInfo.name,
          phoneNumber: hospitalInfo.hospitalNumber,
          hospitalType: hospitalInfo.hospitalType,
          operatingHours: hospitalInfo.operatingHours,
          address: hospitalInfo.address,
          district: hospitalInfo.district,
          province: hospitalInfo.province,
        });
        showNotification('Hospital profile updated successfully in the national directory!');
        setIsEditing(false);
      } catch (err) {
        showNotification(err.message || 'Failed to update hospital details.', 'error');
      } finally {
        setSaving(false);
      }
    } else {
      setIsEditing(true);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const updated = await authService.updateProfilePhoto(file);
      const url = updated?.profilePhotoUrl || updated?.profileDetails?.logoUrl;
      if (url) setHospitalInfo((prev) => ({ ...prev, logoUrl: url }));
      showNotification('Hospital logo updated successfully!');
    } catch (err) {
      showNotification(err.message || 'Failed to upload hospital logo.', 'error');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleInviteStaff = async (registrationNumber) => {
    setIsInviting(true);
    try {
      const invited = await staffService.inviteStaff(registrationNumber);
      showNotification(`Invitation sent to ${invited.staffName} (${invited.staffRegistrationNumber}).`);
      setIsInviteOpen(false);
      const staffList = await staffService.getHospitalStaff({ status: 'Active' }).catch(() => []);
      applyStaffList(staffList);
    } catch (err) {
      showNotification(err.message || 'Failed to send staff invitation.', 'error');
      throw err;
    } finally {
      setIsInviting(false);
    }
  };

  const handleExport = () => {
    showNotification('Exported Hospital Clinical & Verification Sheet (.PDF)');
  };

  return (
    <div className="hospital-profile-wrapper">
      <HospitalSubpageHero
        eyebrow="Hospital identity"
        title="Hospital profile"
        subtitle="Keep your facility details, verification information, and affiliated clinical team up to date."
      />
      <AddStaffRequestModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        onSendRequest={handleInviteStaff}
        isSubmitting={isInviting}
      />

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
          {notificationType === 'error' ? '⚠️' : '✓'} {notification}
        </div>
      )}

      {/* =========================================================================
          1. TOP CARD: Avatar & Hospital Information
         ========================================================================= */}
      <div className="manage-appointments-card profile-top-card" style={{ width: '100%' }}>
        <div className="profile-top-grid">
          {/* Left: Large Avatar with Edit Icon */}
          <div className="profile-avatar-column">
            <div className="profile-avatar-wrap">
              {hospitalInfo.logoUrl ? (
                <img
                  src={hospitalInfo.logoUrl}
                  alt={hospitalInfo.name || 'Hospital'}
                  style={{ width: '150px', height: '150px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--color-accent)' }}
                />
              ) : (
                <svg
                  className="profile-large-silhouette"
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

              {/* Hidden file input for logo upload */}
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                onChange={handleLogoUpload}
              />

              {/* Edit Avatar Badge Icon */}
              <button
                type="button"
                className="btn-avatar-edit"
                title="Update Hospital Logo"
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
          </div>

          {/* Right: Hospital Information Inner Card */}
          <div className="profile-info-column">
            <div className="profile-info-card">
              {/* Card Header Row */}
              <div className="profile-info-header">
                <div>
                  <h2 className="profile-info-title">
                    Hospital Profile &amp; Accreditation
                  </h2>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: hospitalInfo.verificationStatus === 'Approved' || hospitalInfo.verificationStatus === '1' ? 'var(--color-success)' : 'var(--color-warning)',
                    }}
                  >
                    ● Status: {hospitalInfo.verificationStatus === 'Approved' || hospitalInfo.verificationStatus === '1' ? 'Accredited / Verified' : 'Under Review'}
                  </span>
                </div>
                <div className="profile-header-actions">
                  <button
                    type="button"
                    className="btn-profile-edit"
                    onClick={handleToggleEdit}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : isEditing ? 'Save' : 'Edit'}
                  </button>

                  <button
                    type="button"
                    className="btn-profile-export"
                    title="Export / View System Profile"
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

              {/* Hospital Information Fields */}
              <div className="profile-fields-list">
                <div className="profile-field-row">
                  <span className="profile-field-label">VAXORA CODE</span>
                  <span className="profile-field-colon">:</span>
                  <span className="profile-field-value" style={{ fontWeight: 700, color: 'var(--color-accent)' }}>
                    {hospitalInfo.id || (loading ? 'Loading...' : 'N/A')}
                  </span>
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">HOSPITAL NAME</span>
                  <span className="profile-field-colon">:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      name="name"
                      value={hospitalInfo.name}
                      onChange={handleChange}
                      className="profile-field-input"
                    />
                  ) : (
                    <span className="profile-field-value">{hospitalInfo.name || (loading ? 'Loading...' : 'N/A')}</span>
                  )}
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">TYPE</span>
                  <span className="profile-field-colon">:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      name="hospitalType"
                      value={hospitalInfo.hospitalType}
                      onChange={handleChange}
                      className="profile-field-input"
                    />
                  ) : (
                    <span className="profile-field-value">{hospitalInfo.hospitalType || 'General Hospital'}</span>
                  )}
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">HOURS</span>
                  <span className="profile-field-colon">:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      name="operatingHours"
                      value={hospitalInfo.operatingHours}
                      onChange={handleChange}
                      className="profile-field-input"
                    />
                  ) : (
                    <span className="profile-field-value">{hospitalInfo.operatingHours || '24/7 Outpatient & Emergency'}</span>
                  )}
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">ADDRESS</span>
                  <span className="profile-field-colon">:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      name="address"
                      value={hospitalInfo.address}
                      onChange={handleChange}
                      className="profile-field-input"
                    />
                  ) : (
                    <span className="profile-field-value">{hospitalInfo.address || 'Sri Lanka'}</span>
                  )}
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">DISTRICT / PROVINCE</span>
                  <span className="profile-field-colon">:</span>
                  <span className="profile-field-value">{hospitalInfo.district || 'Colombo'}, {hospitalInfo.province || 'Western'}</span>
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">EMAIL</span>
                  <span className="profile-field-colon">:</span>
                  <span className="profile-field-value">{hospitalInfo.email || (loading ? 'Loading...' : 'N/A')}</span>
                </div>

                <div className="profile-field-row">
                  <span className="profile-field-label">CONTACT NUMBER</span>
                  <span className="profile-field-colon">:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      name="hospitalNumber"
                      value={hospitalInfo.hospitalNumber}
                      onChange={handleChange}
                      className="profile-field-input"
                    />
                  ) : (
                    <span className="profile-field-value">{hospitalInfo.hospitalNumber || 'Not provided'}</span>
                  )}
                </div>

                {/* Document links */}
                <div className="profile-field-row" style={{ marginTop: '8px' }}>
                  <span className="profile-field-label">DOCUMENTS</span>
                  <span className="profile-field-colon">:</span>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {hospitalInfo.registrationDocKey ? (
                      <a
                        href={hospitalInfo.registrationDocKey}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="admin-action-btn view"
                        style={{ textDecoration: 'none', fontSize: '0.8rem' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <IconFile size={14} /> Reg Certificate
                        </span>
                      </a>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Registration Document on File</span>
                    )}

                    {hospitalInfo.mohDocKey && (
                      <a
                        href={hospitalInfo.mohDocKey}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="admin-action-btn view"
                        style={{ textDecoration: 'none', fontSize: '0.8rem' }}
                      >
                        🏛️ MOH Clearance
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. BOTTOM CARD: Doctors & Nurses
         ========================================================================= */}
      <div
        className="manage-appointments-card profile-bottom-card"
        style={{ width: '100%', padding: '32px 36px', display: 'flex', flexDirection: 'column', gap: '36px' }}
      >
        {/* Doctors Section */}
        <div className="hospital-staff-section">
          <h2 className="hospital-staff-heading">Assigned Doctors &amp; Medical Officers</h2>
          <div className="hospital-staff-row">
            {doctors.map((doc) => (
              <div key={doc.id} className="hospital-staff-item">
                <div className="hospital-staff-avatar-circle">
                  {doc.photoUrl ? (
                    <img src={doc.photoUrl} alt={doc.name} className="hospital-staff-silhouette" style={{ objectFit: 'cover' }} />
                  ) : (
                    <IconDoctor size={40} style={{ color: "var(--color-text-muted)" }} />
                  )}
                </div>
                <span className="hospital-staff-name">{doc.name}</span>
              </div>
            ))}

            <button
              type="button"
              className="hospital-staff-add-btn"
              onClick={() => setIsInviteOpen(true)}
              title="Assign New Doctor"
              aria-label="Assign New Doctor"
            >
              <svg className="hospital-staff-add-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M14 5v18M5 14h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Nurses Section */}
        <div className="hospital-staff-section">
          <h2 className="hospital-staff-heading">Assigned Immunization Nurses</h2>
          <div className="hospital-staff-row">
            {nurses.map((nurse) => (
              <div key={nurse.id} className="hospital-staff-item">
                <div className="hospital-staff-avatar-circle">
                  {nurse.photoUrl ? (
                    <img src={nurse.photoUrl} alt={nurse.name} className="hospital-staff-silhouette" style={{ objectFit: 'cover' }} />
                  ) : (
                    <IconNurse size={40} style={{ color: 'var(--color-accent)' }} />
                  )}
                </div>
                <span className="hospital-staff-name">{nurse.name}</span>
              </div>
            ))}

            <button
              type="button"
              className="hospital-staff-add-btn"
              onClick={() => setIsInviteOpen(true)}
              title="Assign New Nurse"
              aria-label="Assign New Nurse"
            >
              <svg className="hospital-staff-add-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M14 5v18M5 14h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Danger Zone Card */}
        <div
          className="danger-zone-card hospital-staff-section"
        >
          <div className="danger-zone-row"
          >
            <div>
              <h4 className="danger-zone-title">
                Danger Zone
              </h4>
              <p className="danger-zone-text">
                Permanently delete your hospital facility account, staff rosters, vaults, and inventory registrations. This action cannot be undone.
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
          userName={hospitalInfo.name || 'Hospital Facility'}
          roleName="Hospital"
        />
      </div>
    </div>
  );
}
