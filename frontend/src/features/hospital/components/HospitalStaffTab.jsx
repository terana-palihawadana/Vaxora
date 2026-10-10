import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddStaffRequestModal from './AddStaffRequestModal';
import HospitalCoverRequestsPanel from './HospitalCoverRequestsPanel';
import HospitalShiftsPanel from './HospitalShiftsPanel';
import staffService from '../services/staffService';
import PortalHero from '../../../components/PortalHero';
import {
  IconClock,
  IconDoctor,
  IconNurse,
  IconUsers,
  RoleAvatarIcon,
} from './HospitalIcons';

function mapAffiliationToCard(item) {
  const isPending = item.status === 'Pending';
  const roleLabel = item.staffRole === 'DOCTOR' ? 'Doctor' : 'Nurse';
  const liveDuty =
    String(item.dutyStatus || '').toLowerCase() === 'onbreak'
      ? 'On break'
      : item.isOnDutyNow
        ? item.isClockedIn
          ? 'Clocked in'
          : 'On shift'
        : 'Not on duty';

  return {
    id: item.affiliationId,
    name: item.staffName,
    vaxoraId: item.staffRegistrationNumber,
    role: roleLabel,
    specialty: item.specialization || (roleLabel === 'Doctor' ? 'Doctor' : 'Nursing Staff'),
    email: item.email || '—',
    phone: item.phoneNumber || '—',
    affiliationStatus: item.status,
    isOnDutyNow: Boolean(item.isOnDutyNow),
    status: isPending ? 'Pending Request' : liveDuty,
    photoUrl: item.staffProfilePhotoUrl || null,
    invitedAt: item.invitedAt,
  };
}

export default function HospitalStaffTab() {
  const [pageView, setPageView] = useState('directory'); // 'directory' | 'shifts' | 'covers'
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState([]);
  const [actionId, setActionId] = useState(null);
  // Removing staff also frees their upcoming shifts, so ask for a second click.
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [sortBy] = useState('name');
  const [page, setPage] = useState(1);
  const [pendingCoverCount, setPendingCoverCount] = useState(0);
  const pageSize = 6;

  const toastTimerRef = useRef(null);
  const handlePendingCoverCount = useCallback((count) => {
    setPendingCoverCount(Number(count) || 0);
  }, []);

  const showToast = (message) => {
    setNotification(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotification(''), 4000);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await staffService.getHospitalStaff({ status: 'All' });
      const mapped = (Array.isArray(data) ? data : [])
        .filter((item) => item.status === 'Active' || item.status === 'Pending')
        .map(mapAffiliationToCard);
      setStaffList(mapped);
    } catch (err) {
      setError(err.message || 'Failed to load hospital staff.');
      setStaffList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => {
    loadStaff();
  }), [loadStaff]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await staffService.getHospitalShiftSwaps({ status: 'Pending', limit: 40 });
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setPendingCoverCount(
          list.filter((r) => String(r.status || '').toLowerCase() === 'pending').length
        );
      } catch {
        if (!cancelled) setPendingCoverCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSendRequest = async (registrationNumber) => {
    setIsSubmitting(true);
    try {
      const invited = await staffService.inviteStaff(registrationNumber);
      showToast(`Invitation sent to ${invited.staffName} (${invited.staffRegistrationNumber}).`);
      await loadStaff();
    } catch (err) {
      setError(err.message || 'Failed to send staff invitation.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (affiliationId) => {
    setActionId(affiliationId);
    try {
      await staffService.removeAffiliation(affiliationId);
      showToast('Staff request cancelled.');
      await loadStaff();
    } catch (err) {
      setError(err.message || 'Failed to cancel request.');
    } finally {
      setActionId(null);
    }
  };

  const handleRemoveStaff = async (affiliationId) => {
    if (confirmRemoveId !== affiliationId) {
      setConfirmRemoveId(affiliationId);
      return;
    }
    setConfirmRemoveId(null);
    setActionId(affiliationId);
    try {
      const result = await staffService.removeAffiliation(affiliationId);
      const freed = Number(result?.freedShiftCount) || 0;
      showToast(
        freed > 0
          ? `Staff removed. ${freed} upcoming shift${freed === 1 ? ' was' : 's were'} freed — reassign them in Shifts.`
          : 'Staff removed from roster.'
      );
      await loadStaff();
    } catch (err) {
      setError(err.message || 'Failed to remove staff.');
    } finally {
      setActionId(null);
    }
  };

  const filteredStaff = useMemo(() => {
    const filtered = staffList.filter((staff) => {
      const haystack = `${staff.name} ${staff.vaxoraId} ${staff.specialty} ${staff.email}`.toLowerCase();
      const matchesSearch = haystack.includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (activeTab === 'doctors') return staff.role === 'Doctor';
      if (activeTab === 'nurses') return staff.role === 'Nurse';
      if (activeTab === 'pending') return staff.affiliationStatus === 'Pending';
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'role') return a.role.localeCompare(b.role) || a.name.localeCompare(b.name);
      if (sortBy === 'status') {
        return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [staffList, activeTab, searchQuery, sortBy]);

  useEffect(() => deferEffectCallback(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(filteredStaff.length / pageSize))));
  }), [activeTab, searchQuery, sortBy, filteredStaff.length]);

  const pageCount = Math.max(1, Math.ceil(filteredStaff.length / pageSize));
  const visibleStaff = filteredStaff.slice((page - 1) * pageSize, page * pageSize);

  const activeStaff = staffList.filter((s) => s.affiliationStatus === 'Active');
  const doctorsCount = activeStaff.filter((s) => s.role === 'Doctor').length;
  const nursesCount = activeStaff.filter((s) => s.role === 'Nurse').length;
  const pendingCount = staffList.filter((s) => s.affiliationStatus === 'Pending').length;

  return (
    <div className="hospital-dashboard-tab">
      {notification && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{ maxWidth: '1400px', width: '100%', marginBottom: '20px' }}
        >
          {notification}
        </div>
      )}

      {error && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{
            maxWidth: '1400px',
            width: '100%',
            marginBottom: '20px',
            background: 'var(--color-error-bg)',
            color: 'var(--color-error)',
            borderColor: 'var(--color-error-border)',
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => setError('')}
            style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)' }}
          >
            Dismiss
          </button>
        </div>
      )}

      <PortalHero
        eyebrow="Staff management"
        title="Hospital Medical Staff & Doctors"
        subtitle="Manage affiliated doctors and nurses. Invite verified practitioners with their Vaxora ID."
      >
        <div className="hospital-staff-hero-tabs" role="tablist" aria-label="Staff views">
          <button
            type="button"
            role="tab"
            aria-selected={pageView === 'directory'}
            className={`hospital-staff-hero-tab ${pageView === 'directory' ? 'active' : ''}`}
            onClick={() => setPageView('directory')}
          >
            Directory
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pageView === 'shifts'}
            className={`hospital-staff-hero-tab ${pageView === 'shifts' ? 'active' : ''}`}
            onClick={() => setPageView('shifts')}
          >
            Shifts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pageView === 'covers'}
            className={`hospital-staff-hero-tab ${pageView === 'covers' ? 'active' : ''}`}
            onClick={() => setPageView('covers')}
          >
            Cover requests
            {pendingCoverCount > 0 ? (
              <span className="hospital-staff-hero-tab-badge">{pendingCoverCount}</span>
            ) : null}
          </button>
        </div>
      </PortalHero>

      {pageView === 'shifts' ? (
        <HospitalShiftsPanel />
      ) : pageView === 'covers' ? (
        <HospitalCoverRequestsPanel onPendingCountChange={handlePendingCoverCount} />
      ) : (
      <>
      <div className="hospital-staff-toolbar">
        <button
          type="button"
          className="hospital-staff-hero-btn secondary"
          onClick={loadStaff}
          disabled={loading}
        >
          Refresh
        </button>
        <button
          type="button"
          className="hospital-staff-hero-btn primary"
          onClick={() => setIsModalOpen(true)}
        >
          <span>+</span> Add New Staff
        </button>
      </div>

      <div className="hospital-metrics-grid hospital-metrics-grid--4" style={{ marginBottom: '24px' }}>
        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-slate">
            <IconUsers size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Active Affiliated Staff</span>
            <span className="hospital-stat-value">{activeStaff.length}</span>
            <span className="hospital-stat-meta">Accepted roster members</span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-blue">
            <IconDoctor size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Doctors</span>
            <span className="hospital-stat-value">{doctorsCount}</span>
            <span className="hospital-stat-meta">Active affiliations</span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-green">
            <IconNurse size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Nurses</span>
            <span className="hospital-stat-value">{nursesCount}</span>
            <span className="hospital-stat-meta">Active affiliations</span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-amber">
            <IconClock size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Pending Requests</span>
            <span className="hospital-stat-value">{pendingCount}</span>
            <span className="hospital-stat-meta">Awaiting acceptance</span>
          </div>
        </div>
      </div>

      <div className="hospital-staff-toolbar">
        <div className="hospital-staff-filters" role="group" aria-label="Filter staff by category">
          <button
            type="button"
            className={`hospital-nav-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
            style={{
              background: activeTab === 'all' ? 'var(--color-primary)' : 'var(--color-surface)',
              border: '1px solid var(--color-border-card)',
            }}
          >
            All ({staffList.length})
          </button>

          <button
            type="button"
            className={`hospital-nav-btn ${activeTab === 'doctors' ? 'active' : ''}`}
            onClick={() => setActiveTab('doctors')}
            style={{
              background: activeTab === 'doctors' ? 'var(--color-primary)' : 'var(--color-surface)',
              border: '1px solid var(--color-border-card)',
            }}
          >
            Doctors ({staffList.filter((s) => s.role === 'Doctor').length})
          </button>

          <button
            type="button"
            className={`hospital-nav-btn ${activeTab === 'nurses' ? 'active' : ''}`}
            onClick={() => setActiveTab('nurses')}
            style={{
              background: activeTab === 'nurses' ? 'var(--color-primary)' : 'var(--color-surface)',
              border: '1px solid var(--color-border-card)',
            }}
          >
            Nurses ({staffList.filter((s) => s.role === 'Nurse').length})
          </button>

          <button
            type="button"
            className={`hospital-nav-btn ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending')}
            style={{
              background: activeTab === 'pending' ? 'var(--color-primary)' : 'var(--color-surface)',
              border: '1px solid var(--color-border-card)',
            }}
          >
            Pending ({pendingCount})
          </button>
        </div>

        <input
          aria-label="Search staff directory"
          type="text"
          placeholder="Search name, Vaxora ID, email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="queue-search-input hospital-staff-search"
        />
      </div>

      <div className="booths-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {loading ? (
          <div
            className="hospital-section-card empty-state-text"
            style={{ gridColumn: '1 / -1' }}
          >
            Loading staff directory...
          </div>
        ) : filteredStaff.length === 0 ? (
          <div
            className="hospital-section-card empty-state-text"
            style={{ gridColumn: '1 / -1' }}
          >
            {staffList.length === 0
              ? 'No staff yet. Invite an approved doctor or nurse with their Vaxora ID to get started.'
              : 'No staff matches the current search or filter.'}
          </div>
        ) : (
            visibleStaff.map((staff) => (
            <div
              key={staff.id}
              className="booth-card"
              style={{
                padding: '22px',
                border:
                  staff.affiliationStatus === 'Pending'
                    ? '1px solid rgba(245, 158, 11, 0.45)'
                    : '1px solid rgba(var(--rgb-primary-dark), 0.18)',
              }}
            >
              <div className="booth-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    className="booth-number-tag"
                    style={{
                      background: staff.role === 'Doctor' ? 'var(--color-brand-blue)' : 'var(--color-primary)',
                      color: 'var(--color-text-inverse)',
                      borderColor: staff.role === 'Doctor' ? 'var(--color-primary-dark)' : 'var(--color-primary-hover)',
                    }}
                  >
                    {staff.role}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      background: 'var(--color-info-bg)',
                      color: 'var(--color-primary)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-info-border)',
                    }}
                  >
                    {staff.vaxoraId}
                  </span>
                </div>

                <div className="booth-status-indicator">
                  <span
                    className="telemetry-pulse"
                    style={{
                      width: '6px',
                      height: '6px',
                      background:
                        staff.isOnDutyNow
                          ? 'var(--color-success)'
                          : staff.affiliationStatus === 'Pending'
                            ? 'var(--color-warning)'
                            : 'var(--color-text-placeholder)',
                    }}
                  />
                  <span
                    style={{
                      color:
                        staff.isOnDutyNow
                          ? 'var(--color-success)'
                          : staff.affiliationStatus === 'Pending'
                            ? 'var(--color-warning)'
                            : 'var(--color-text-muted)',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                    }}
                  >
                    {staff.status}
                  </span>
                </div>
              </div>

              <div className="booth-staff-info" style={{ padding: '14px', background: 'var(--color-bg)' }}>
                <div
                  className="staff-avatar-mini"
                  style={{ width: '50px', height: '50px', background: 'var(--color-soft-panel-deep)', color: 'var(--color-text-body)', overflow: 'hidden' }}
                >
                  {staff.photoUrl ? (
                    <img
                      src={staff.photoUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <RoleAvatarIcon role={staff.role} size={24} />
                  )}
                </div>
                <div className="staff-text-group" style={{ gap: '2px' }}>
                  <span className="staff-name" style={{ fontSize: '1.08rem' }}>
                    {staff.name}
                  </span>
                  <span className="staff-role-desc" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                    {staff.specialty}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {staff.email}
                  </span>
                </div>
              </div>

              <div className="booth-stats-row" style={{ paddingTop: '10px', gap: '8px', flexWrap: 'wrap' }}>
                {staff.affiliationStatus === 'Pending' ? (
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(staff.id)}
                    disabled={actionId === staff.id}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                  >
                    {actionId === staff.id ? 'Cancelling...' : 'Cancel Request'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRemoveStaff(staff.id)}
                      disabled={actionId === staff.id}
                      title={
                        confirmRemoveId === staff.id
                          ? 'Their upcoming shifts here will be freed for reassignment'
                          : undefined
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-error)',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                      }}
                    >
                      {actionId === staff.id
                        ? 'Removing...'
                        : confirmRemoveId === staff.id
                          ? 'Confirm remove?'
                          : 'Remove'}
                    </button>
                    {confirmRemoveId === staff.id && actionId !== staff.id ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-text-muted)',
                          fontWeight: 600,
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                        }}
                      >
                        Keep
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {!loading && filteredStaff.length > 0 && (
        <div
          aria-label="Staff directory pagination"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '18px' }}
        >
          <button
            type="button"
            className="hospital-nav-btn"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
          >
            Previous
          </button>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            className="hospital-nav-btn"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page === pageCount}
          >
            Next
          </button>
        </div>
      )}

      <AddStaffRequestModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSendRequest={handleSendRequest}
        isSubmitting={isSubmitting}
      />
      </>
      )}
    </div>
  );
}
