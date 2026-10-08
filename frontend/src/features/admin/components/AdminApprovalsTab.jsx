import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useCallback } from 'react';
import { authService } from '../../auth';
import {
  IconClock,
  IconShield,
  RoleAvatarIcon,
} from '../../../shared/icons/AppIcons';

export default function AdminApprovalsTab() {
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isInspectModalOpen, setIsInspectModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [notification, setNotification] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [requests, setRequests] = useState([]);

  const showToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3500);
  };

  const fetchPendingApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authService.getPendingVerifications();
      if (Array.isArray(data)) {
        const formatted = data.map((item) => ({
          id: `APP-${item.userId.substring(0, 8)}`,
          userId: item.userId,
          type: (item.role || 'doctor').toLowerCase(),
          name: item.name || 'Healthcare Applicant',
          email: item.email,
          phone: item.phoneNumber || 'N/A',
          licenseId: item.licenseOrRegNumber || 'N/A',
          registrationNumber: item.registrationNumber,
          facility: item.hospitalAffiliationOrType || 'General Healthcare',
          appliedAt: new Date(item.createdAt).toLocaleString(),
          documentName: item.primaryDocUrl ? 'Verification_Credential.pdf' : 'Document Attached',
          primaryDocUrl: item.primaryDocUrl,
          supportingDocUrl: item.supportingDocUrl,
          profilePhotoUrl: item.profilePhotoOrLogoUrl,
          status: (item.status || 'Pending').toLowerCase(),
        }));
        setRequests(formatted);
      } else {
        setRequests([]);
      }
    } catch (err) {
      console.error('Failed to load pending verifications:', err);
      showToast(`⚠️ Error loading queue: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => {
    fetchPendingApprovals();
  }), [fetchPendingApprovals]);

  // Approve Request
  const handleApprove = async (req) => {
    if (!req.userId) return;
    setActionLoading(true);
    try {
      await authService.decideVerification(req.userId, 'Approve');
      showToast(`✅ Approved ${req.type.toUpperCase()}: ${req.name} (${req.licenseId}). Account activated.`);
      setIsInspectModalOpen(false);
      await fetchPendingApprovals();
    } catch (err) {
      showToast(`❌ Failed to approve: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Reject Request
  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!selectedRequest || !selectedRequest.userId) return;
    const reason = rejectionReason.trim() || 'Incomplete or unverified credential submission.';

    setActionLoading(true);
    try {
      await authService.decideVerification(selectedRequest.userId, 'Reject', reason);
      showToast(`❌ Application for ${selectedRequest.name} rejected.`);
      setIsRejectModalOpen(false);
      setIsInspectModalOpen(false);
      setRejectionReason('');
      await fetchPendingApprovals();
    } catch (err) {
      showToast(`❌ Failed to reject: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Filter requests
  const filteredRequests = requests.filter((r) => {
    if (filterType === 'pending' && r.status !== 'pending') return false;
    if (filterType === 'approved' && r.status !== 'approved' && r.status !== 'active') return false;
    if (filterType === 'doctor' && r.type !== 'doctor') return false;
    if (filterType === 'nurse' && r.type !== 'nurse') return false;
    if (filterType === 'hospital' && r.type !== 'hospital') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.licenseId && r.licenseId.toLowerCase().includes(q)) ||
        (r.facility && r.facility.toLowerCase().includes(q)) ||
        (r.email && r.email.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="admin-approvals-page">
      {/* Toast Notification */}
      {notification && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{ maxWidth: '1060px', margin: '0 auto 20px', width: '100%' }}
        >
          {notification}
        </div>
      )}

      {/* Main Approvals Card */}
      <div className="doctor-card admin-main-card">
        <div className="doctor-card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div className="doctor-card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span className="icon-shade icon-shade-amber"><IconShield size={22} /></span>
              Doctor, Nurse &amp; Hospital Approval Queue
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
              All Doctors, Nurses, and Hospitals must be verified and approved before accessing clinical tools.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="doctor-filter-btn"
              onClick={fetchPendingApprovals}
              disabled={loading}
              title="Refresh queue from server"
            >
              🔄 Refresh
            </button>
          </div>

          {/* Filter Pills */}
          <div className="doctor-filter-pills" style={{ width: '100%', marginTop: '6px' }}>
            <button
              type="button"
              className={`doctor-filter-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All In Queue ({requests.length})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${filterType === 'pending' ? 'active' : ''}`}
              onClick={() => setFilterType('pending')}
            >
              ⏳ Pending ({pendingCount})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${filterType === 'doctor' ? 'active' : ''}`}
              onClick={() => setFilterType('doctor')}
            >
              🩺 Doctors
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${filterType === 'nurse' ? 'active' : ''}`}
              onClick={() => setFilterType('nurse')}
            >
              👩‍⚕️ Nurses
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${filterType === 'hospital' ? 'active' : ''}`}
              onClick={() => setFilterType('hospital')}
            >
              🏥 Hospitals
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="doctor-search-bar">
          <span className="doctor-search-icon">🔍</span>
          <input
            type="text"
            className="doctor-search-input"
            placeholder="Search pending applications by name, SLMC/SLNC/MOH license, or hospital..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Applications Table */}
        <div className="doctor-table-wrapper" tabIndex={0} role="region" aria-label="Pending verifications table">
          <table className="doctor-table">
            <thead>
              <tr>
                <th>Applicant / Organization</th>
                <th>Category</th>
                <th>Vaxora Reg Code</th>
                <th>Licensing Code</th>
                <th>Hospital / Details</th>
                <th>Verification Document</th>
                <th>Submission Time</th>
                <th>Status</th>
                <th>Approval Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    <div style={{ display: 'inline-flex', animation: 'spin 1s linear infinite', marginBottom: '8px' }}><IconClock size={24} /></div>
                    <div>Fetching live verification queue...</div>
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '36px', color: '#94a3b8' }}>
                    No applications currently pending verification.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {req.profilePhotoUrl ? (
                          <a
                            href={req.profilePhotoUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Click to view full profile photo/logo"
                            style={{ display: 'block', flexShrink: 0 }}
                          >
                            <img
                              src={req.profilePhotoUrl}
                              alt={req.name}
                              style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: req.type === 'hospital' ? '8px' : '50%',
                                objectFit: 'cover',
                                border: '1.5px solid rgba(56, 189, 248, 0.45)',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                cursor: 'pointer',
                              }}
                            />
                          </a>
                        ) : (
                          <div
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: req.type === 'hospital' ? '8px' : '50%',
                              background: '#111c38',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#94a3b8',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                              flexShrink: 0,
                            }}
                          >
                            <RoleAvatarIcon role={req.type} size={20} />
                          </div>
                        )}
                        <div className="doctor-patient-cell">
                          <span
                            className="doctor-patient-name-link"
                            onClick={() => {
                              setSelectedRequest(req);
                              setIsInspectModalOpen(true);
                            }}
                          >
                            {req.name}
                          </span>
                          <span className="doctor-patient-sub" style={{ color: '#94a3b8' }}>
                            {req.email} • {req.phone}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`admin-role-badge ${req.type}`}>
                        <RoleAvatarIcon role={req.type} size={14} />
                        {req.type === 'doctor' && 'Doctor'}
                        {req.type === 'nurse' && 'Nurse'}
                        {req.type === 'hospital' && 'Hospital'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {req.registrationNumber ? (
                        <span className="admin-id-pill" style={{ color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.4)', background: 'rgba(16, 185, 129, 0.12)', fontSize: '0.8rem', fontWeight: 700 }}>
                          {req.registrationNumber}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="admin-id-pill" style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)', fontSize: '0.78rem' }}>
                        {req.licenseId}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.84rem', color: '#e2e8f0', fontWeight: 600 }}>
                      {req.facility}
                    </td>
                    <td>
                      <div className="admin-doc-stack">
                        {/* 1. Primary Licensing Document */}
                        {req.primaryDocUrl ? (
                          <a
                            href={req.primaryDocUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="admin-doc-badge-link"
                            title="Open Primary Verification Document"
                          >
                            📄 {req.type === 'doctor' ? 'SLMC Certificate' : req.type === 'nurse' ? 'SLNC Card' : 'Registration Doc'} ↗
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            📄 Document Attached
                          </span>
                        )}

                        {/* 2. Supporting Document (if uploaded) */}
                        {req.supportingDocUrl && (
                          <a
                            href={req.supportingDocUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="admin-doc-badge-link supporting"
                            title="Open Supporting Document"
                          >
                            📎 Supporting Doc ↗
                          </a>
                        )}

                        {/* 3. Profile Photo / Logo (if uploaded) */}
                        {req.profilePhotoUrl && (
                          <a
                            href={req.profilePhotoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="admin-doc-badge-link photo"
                            title="Open Profile Photo / Logo"
                          >
                            🖼️ {req.type === 'hospital' ? 'Hospital Logo' : 'Profile Photo'} ↗
                          </a>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      {req.appliedAt}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {req.status === 'pending' && (
                        <span className="doctor-status-badge status-waiting">
                          ⏳ Pending
                        </span>
                      )}
                      {(req.status === 'active' || req.status === 'approved') && (
                        <span className="doctor-status-badge status-completed">
                          ✓ Approved
                        </span>
                      )}
                      {req.status === 'rejected' && (
                        <span className="doctor-status-badge status-rejected">
                          ✕ Rejected
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', minWidth: '190px' }}>
                      {req.status === 'pending' ? (
                        <div className="admin-action-btn-group">
                          <button
                            type="button"
                            className="admin-btn-action admin-btn-approve"
                            disabled={actionLoading}
                            onClick={() => handleApprove(req)}
                            title="Approve and activate credentials"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Approve
                          </button>
                          <button
                            type="button"
                            className="admin-btn-action admin-btn-reject"
                            disabled={actionLoading}
                            onClick={() => {
                              setSelectedRequest(req);
                              setIsRejectModalOpen(true);
                            }}
                            title="Reject application"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Reject
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="admin-btn-action admin-btn-view"
                          onClick={() => {
                            setSelectedRequest(req);
                            setIsInspectModalOpen(true);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          View Record
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Credentials & Decision Modal */}
      {isInspectModalOpen && selectedRequest && (
        <div className="doctor-modal-overlay" onClick={() => setIsInspectModalOpen(false)}>
          <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px' }}>
            <div className="doctor-modal-header" style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0369a1 100%)' }}>
              <div>
                <h3 className="doctor-modal-title">Verification Review: {selectedRequest.name}</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
                  Application ID: {selectedRequest.id} • Submitted on {selectedRequest.appliedAt}
                </p>
              </div>
              <button type="button" className="doctor-modal-close-btn" onClick={() => setIsInspectModalOpen(false)}>
                &times;
              </button>
            </div>

            <div className="doctor-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '0.88rem' }}>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Applicant Name</span>
                  <span className="admin-detail-val" style={{ fontWeight: 800, color: '#f8fafc' }}>{selectedRequest.name}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Role Type</span>
                  <span className="admin-detail-val" style={{ textTransform: 'capitalize', fontWeight: 700, color: '#38bdf8' }}>
                    {selectedRequest.type}
                  </span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Vaxora Registration Code</span>
                  <span className="admin-detail-val" style={{ fontWeight: 800, color: '#34d399' }}>
                    {selectedRequest.registrationNumber || 'Pending'}
                  </span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Licensing Code (SLMC / SLNC / MOH)</span>
                  <span className="admin-detail-val" style={{ fontWeight: 800, color: '#38bdf8' }}>{selectedRequest.licenseId}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Email Address</span>
                  <span className="admin-detail-val">{selectedRequest.email}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Phone Number</span>
                  <span className="admin-detail-val">{selectedRequest.phone}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Hospital / Specialization</span>
                  <span className="admin-detail-val">{selectedRequest.facility}</span>
                </div>
              </div>

              {/* Uploaded Documents Box */}
              <div style={{ marginTop: '16px', padding: '16px', background: '#0b1120', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Primary Licensing Document
                    </span>
                    <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.95rem', marginTop: '2px' }}>
                      {selectedRequest.documentName}
                    </div>
                  </div>
                  {selectedRequest.primaryDocUrl ? (
                    <a
                      href={selectedRequest.primaryDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 700, fontSize: '0.78rem', padding: '6px 12px', borderRadius: '6px', textDecoration: 'none' }}
                    >
                      View Document ↗
                    </a>
                  ) : (
                    <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700, fontSize: '0.75rem', padding: '4px 8px', borderRadius: '6px' }}>
                      Verified Upload
                    </span>
                  )}
                </div>
                {selectedRequest.supportingDocUrl && (
                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Supporting Document</span>
                    <a
                      href={selectedRequest.supportingDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#38bdf8', fontSize: '0.82rem', textDecoration: 'underline' }}
                    >
                      View Supporting File ↗
                    </a>
                  </div>
                )}
              </div>

              {/* Profile Photo / Logo Row */}
              {selectedRequest.profilePhotoUrl && (
                <div style={{ marginTop: '12px', padding: '12px 16px', background: '#0b1120', border: '1px solid rgba(52, 211, 153, 0.25)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img
                      src={selectedRequest.profilePhotoUrl}
                      alt="Profile preview"
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: selectedRequest.type === 'hospital' ? '8px' : '50%',
                        objectFit: 'cover',
                        border: '1.5px solid #34d399'
                      }}
                    />
                    <div>
                      <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.9rem' }}>
                        {selectedRequest.type === 'hospital' ? 'Hospital Logo' : 'Practitioner Profile Photo'}
                      </div>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Uploaded during registration</span>
                    </div>
                  </div>
                  <a
                    href={selectedRequest.profilePhotoUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.3)', fontWeight: 700, fontSize: '0.78rem', padding: '6px 12px', borderRadius: '6px', textDecoration: 'none' }}
                  >
                    View Image ↗
                  </a>
                </div>
              )}
            </div>

            <div className="doctor-modal-footer">
              <button
                type="button"
                className="doctor-btn-cancel"
                onClick={() => setIsInspectModalOpen(false)}
              >
                Close
              </button>
              {selectedRequest.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className="doctor-btn-cancel"
                    style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    onClick={() => {
                      setIsInspectModalOpen(false);
                      setIsRejectModalOpen(true);
                    }}
                  >
                    Reject Application...
                  </button>
                  <button
                    type="button"
                    className="doctor-btn-submit"
                    disabled={actionLoading}
                    onClick={() => handleApprove(selectedRequest)}
                  >
                    {actionLoading ? 'Processing...' : 'Approve & Issue Access'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rejection Reason Modal */}
      {isRejectModalOpen && selectedRequest && (
        <div className="doctor-modal-overlay" onClick={() => setIsRejectModalOpen(false)}>
          <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="doctor-modal-header" style={{ background: '#dc2626' }}>
              <div>
                <h3 className="doctor-modal-title">Reject Application</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
                  Provide reason for rejecting {selectedRequest.name}
                </p>
              </div>
              <button type="button" className="doctor-modal-close-btn" onClick={() => setIsRejectModalOpen(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleRejectSubmit}>
              <div className="doctor-modal-body">
                <p style={{ fontSize: '0.88rem', color: '#cbd5e1', marginBottom: '14px' }}>
                  Please enter the formal justification for administrative rejection. This reason will be recorded in the audit trail.
                </p>

                <div className="auth-input-group">
                  <textarea
                    rows={4}
                    className="auth-input"
                    required
                    placeholder="e.g. SLMC registration number does not match submitted credentials..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    style={{ resize: 'vertical', width: '100%', fontFamily: 'inherit' }}
                  />
                </div>
              </div>

              <div className="doctor-modal-footer">
                <button
                  type="button"
                  className="doctor-btn-cancel"
                  onClick={() => setIsRejectModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="doctor-btn-submit"
                  disabled={actionLoading}
                  style={{ background: '#dc2626' }}
                >
                  {actionLoading ? 'Submitting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
