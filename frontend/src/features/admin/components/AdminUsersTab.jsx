import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useCallback } from 'react';
import { authService } from '../../auth';
import {
  IconClock,
  IconUsers,
  RoleAvatarIcon,
} from '../../../shared/icons/AppIcons';

export default function AdminUsersTab() {
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [notification, setNotification] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  const showToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3500);
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authService.getAllUsers();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        setUsers([]);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err.message || 'Failed to load user directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => {
    loadUsers();
  }), [loadUsers]);

  // Handle status toggle (Active <-> Suspended)
  const handleToggleStatus = async (user) => {
    if (user.role === 'admin') return;
    const newStatus = user.status === 'active' ? 'Suspended' : 'Active';
    setActionLoading(user.id);
    try {
      await authService.updateUserStatus(user.id, newStatus);
      showToast(`User ${user.name} marked as ${newStatus.toUpperCase()}`);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: newStatus.toLowerCase() } : u))
      );
      if (selectedUser && selectedUser.id === user.id) {
        setSelectedUser((prev) => ({ ...prev, status: newStatus.toLowerCase() }));
      }
    } catch (err) {
      alert(err.message || 'Failed to update user status.');
    } finally {
      setActionLoading(null);
    }
  };

  // Filter users in memory
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.identifier && u.identifier.toLowerCase().includes(q)) ||
        (u.facilityOrDetails && u.facilityOrDetails.toLowerCase().includes(q)) ||
        (u.phoneNumber && u.phoneNumber.includes(q))
      );
    }
    return true;
  });

  const countByRole = (role) => {
    if (role === 'all') return users.length;
    return users.filter((u) => u.role === role).length;
  };

  return (
    <div className="admin-users-page">
      {/* Toast Notification */}
      {notification && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{ maxWidth: '1060px', margin: '0 auto 20px', width: '100%' }}
        >
          ✓ {notification}
        </div>
      )}

      {/* Main Container Card */}
      <div className="doctor-card admin-main-card">
        <div className="doctor-card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div className="doctor-card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span className="icon-shade icon-shade-blue"><IconUsers size={22} /></span>
              National User Directory
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
              Manage, filter, and inspect accounts for all registered doctors, nurses, hospitals, and citizens.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="doctor-filter-btn"
              onClick={loadUsers}
              disabled={loading}
              title="Refresh users from server"
            >
              🔄 Refresh
            </button>
          </div>

          {/* Role Filters */}
          <div className="doctor-filter-pills" style={{ width: '100%', marginTop: '6px' }}>
            <button
              type="button"
              className={`doctor-filter-btn ${roleFilter === 'all' ? 'active' : ''}`}
              onClick={() => setRoleFilter('all')}
            >
              All Roles ({countByRole('all')})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${roleFilter === 'doctor' ? 'active' : ''}`}
              onClick={() => setRoleFilter('doctor')}
            >
              🩺 Doctors ({countByRole('doctor')})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${roleFilter === 'nurse' ? 'active' : ''}`}
              onClick={() => setRoleFilter('nurse')}
            >
              👩‍⚕️ Nurses ({countByRole('nurse')})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${roleFilter === 'hospital' ? 'active' : ''}`}
              onClick={() => setRoleFilter('hospital')}
            >
              🏥 Hospitals ({countByRole('hospital')})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${roleFilter === 'patient' ? 'active' : ''}`}
              onClick={() => setRoleFilter('patient')}
            >
              👤 Patients ({countByRole('patient')})
            </button>
          </div>
        </div>

        {/* Search & Status Filter Controls */}
        <div className="admin-controls-bar">
          <div className="doctor-search-bar" style={{ flex: 1, margin: 0 }}>
            <span className="doctor-search-icon">🔍</span>
            <input
              type="text"
              className="doctor-search-input"
              placeholder="Search by name, email, SLMC/SLNC/Registration ID, NIC, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Status:</label>
            <select
              aria-label="Filter users by status"
              className="doctor-filter-date-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: '6px 12px' }}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active / Verified</option>
              <option value="pending">Pending Approval</option>
              <option value="suspended">Suspended</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div style={{ padding: '16px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '8px', margin: '16px', fontSize: '0.9rem' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Users Table */}
        <div className="doctor-table-wrapper">
          <table className="doctor-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Registration / License ID</th>
                <th>Contact Info</th>
                <th>Hospital / Details</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    <div style={{ display: 'inline-flex', animation: 'spin 1s linear infinite', marginBottom: '8px' }}><IconClock size={24} /></div>
                    <div>Loading live user directory...</div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: '#94a3b8' }}>
                    No user accounts found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="doctor-patient-cell">
                        <span
                          className="doctor-patient-name-link"
                          onClick={() => {
                            setSelectedUser(u);
                            setIsDetailModalOpen(true);
                          }}
                        >
                          {u.name}
                        </span>
                        <span className="doctor-patient-sub" style={{ color: '#94a3b8' }}>
                          UID: {u.id.substring(0, 8)}... • Joined {new Date(u.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`admin-role-badge ${u.role}`}>
                        <RoleAvatarIcon role={u.role} size={14} />
                        {u.role === 'doctor' && 'Doctor'}
                        {u.role === 'nurse' && 'Nurse'}
                        {u.role === 'hospital' && 'Hospital'}
                        {u.role === 'patient' && 'Patient'}
                        {u.role === 'admin' && 'Admin'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                        {u.registrationNumber && (
                          <span className="admin-id-pill" style={{ color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.4)', background: 'rgba(16, 185, 129, 0.12)', fontSize: '0.78rem' }}>
                            {u.registrationNumber}
                          </span>
                        )}
                        <span className="admin-id-pill" style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)', fontSize: '0.74rem' }}>
                          {u.identifier}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.84rem' }}>
                        <div style={{ color: '#ffffff', fontWeight: 600 }}>{u.email}</div>
                        <div style={{ color: '#94a3b8', marginTop: '2px' }}>{u.phoneNumber || '—'}</div>
                      </div>
                    </td>
                    <td style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.85rem' }}>
                      {u.facilityOrDetails}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {u.status === 'active' && (
                        <span className="doctor-status-badge status-completed">
                          ✓ Verified / Active
                        </span>
                      )}
                      {u.status === 'pending' && (
                        <span className="doctor-status-badge status-waiting">
                          ⏳ Pending Approval
                        </span>
                      )}
                      {u.status === 'suspended' && (
                        <span className="doctor-status-badge status-rejected" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
                          ⛔ Suspended
                        </span>
                      )}
                      {u.status === 'rejected' && (
                        <span className="doctor-status-badge status-rejected">
                          ✕ Rejected
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="doctor-table-btn"
                          style={{ background: '#0369a1', color: '#ffffff', borderColor: '#38bdf8' }}
                          onClick={() => {
                            setSelectedUser(u);
                            setIsDetailModalOpen(true);
                          }}
                          title="Inspect full user record"
                        >
                          Details
                        </button>
                        {u.role !== 'admin' && (
                          <button
                            type="button"
                            className="doctor-table-btn"
                            disabled={actionLoading === u.id}
                            style={{
                              background: u.status === 'active' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: u.status === 'active' ? '#f87171' : '#34d399',
                              borderColor: u.status === 'active' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)',
                            }}
                            onClick={() => handleToggleStatus(u)}
                            title={u.status === 'active' ? 'Suspend User Access' : 'Activate User Access'}
                          >
                            {actionLoading === u.id
                              ? '...'
                              : u.status === 'active'
                              ? 'Suspend'
                              : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Details Modal */}
      {isDetailModalOpen && selectedUser && (
        <div className="doctor-modal-overlay" onClick={() => setIsDetailModalOpen(false)}>
          <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="doctor-modal-header" style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0369a1 100%)' }}>
              <div>
                <h3 className="doctor-modal-title">Account Profile &amp; Credentials</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
                  User ID: {selectedUser.id} • Registered in National Health Directory
                </p>
              </div>
              <button type="button" className="doctor-modal-close-btn" onClick={() => setIsDetailModalOpen(false)}>
                &times;
              </button>
            </div>

            <div className="doctor-modal-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '14px', background: '#111a2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', marginBottom: '16px' }}>
                <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                  <RoleAvatarIcon role={selectedUser.role} size={40} />
                </div>
                <div>
                  <h3 style={{ margin: 0, color: '#ffffff', fontSize: '1.2rem', fontWeight: 800 }}>{selectedUser.name}</h3>
                  <span className={`admin-role-badge ${selectedUser.role}`} style={{ marginTop: '4px' }}>
                    {selectedUser.role.toUpperCase()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.88rem' }}>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Email Address</span>
                  <span className="admin-detail-val" style={{ color: '#ffffff' }}>{selectedUser.email}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Phone Number</span>
                  <span className="admin-detail-val" style={{ color: '#ffffff' }}>{selectedUser.phoneNumber || 'N/A'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Official Registration / ID</span>
                  <span className="admin-detail-val" style={{ fontWeight: 700, color: '#38bdf8' }}>{selectedUser.identifier}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Hospital / Details</span>
                  <span className="admin-detail-val" style={{ color: '#ffffff' }}>{selectedUser.facilityOrDetails}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Joined Date</span>
                  <span className="admin-detail-val" style={{ color: '#ffffff' }}>{new Date(selectedUser.createdAt).toLocaleString()}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Account Status</span>
                  <span className="admin-detail-val" style={{ textTransform: 'capitalize', fontWeight: 700, color: selectedUser.status === 'active' ? '#34d399' : '#fbbf24' }}>
                    {selectedUser.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="doctor-modal-footer">
              <button
                type="button"
                className="doctor-btn-cancel"
                onClick={() => setIsDetailModalOpen(false)}
              >
                Close
              </button>
              {selectedUser.role !== 'admin' && (
                <button
                  type="button"
                  className="doctor-btn-submit"
                  disabled={actionLoading === selectedUser.id}
                  style={{
                    background: selectedUser.status === 'active' ? '#dc2626' : '#16a34a',
                  }}
                  onClick={() => {
                    handleToggleStatus(selectedUser);
                  }}
                >
                  {selectedUser.status === 'active' ? 'Suspend Account' : 'Activate Account'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
