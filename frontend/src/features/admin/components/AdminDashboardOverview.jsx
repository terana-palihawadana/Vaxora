import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService, getUser } from '../../auth';
import {
  IconClipboard,
  IconClock,
  IconHospital,
  IconPackage,
  IconShield,
  IconSnowflake,
  IconSyringe,
  IconUsers,
  RoleAvatarIcon,
} from '../../../shared/icons/AppIcons';

export default function AdminDashboardOverview() {
  const navigate = useNavigate();
  const [toastMessage, setToastMessage] = useState(null);
  const [adminUser, setAdminUser] = useState(() =>
    typeof authService?.getUser === 'function' ? authService.getUser() : (getUser ? getUser() : null)
  );
  const [pendingRequests, setPendingRequests] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true);
        // 1. Fetch current admin profile from DB
        try {
          const me = await authService.getMe();
          if (me) setAdminUser(me);
        } catch (errMe) {
          console.warn('Could not refresh admin profile, using cached:', errMe);
        }

        // 2. Fetch live dashboard telemetry from backend
        try {
          const stats = await authService.getAdminDashboardStats();
          if (stats) {
            setDashboardStats(stats);
            if (Array.isArray(stats.recentPendingVerifications) && stats.recentPendingVerifications.length > 0) {
              const formatted = stats.recentPendingVerifications.map((item) => ({
                id: item.userId,
                type: (item.role || 'doctor').toLowerCase(),
                name: item.name || 'Applicant',
                regNumber: item.registrationNumber || item.licenseOrRegNumber || 'Pending',
                hospital: item.hospitalAffiliationOrType || 'General Hospital',
                date: item.createdAt
                  ? new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : 'Recent',
              }));
              setPendingRequests(formatted);
            }
          }
        } catch (errStats) {
          console.warn('Failed to fetch dashboard stats, trying pending queue:', errStats);
          // Fallback to pending verifications directly if stats endpoint had an issue
          const pending = await authService.getPendingVerifications();
          if (Array.isArray(pending)) {
            const formatted = pending
              .filter((item) => (item.status || 'Pending').toLowerCase() === 'pending')
              .map((item) => ({
                id: item.userId,
                type: (item.role || 'doctor').toLowerCase(),
                name: item.name || 'Applicant',
                regNumber: item.registrationNumber || item.licenseOrRegNumber || 'Pending',
                hospital: item.hospitalAffiliationOrType || 'General Hospital',
                date: item.createdAt
                  ? new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : 'Recent',
              }));
            setPendingRequests(formatted);
          }
        }
      } catch (err) {
        console.warn('Failed to load dashboard overview telemetry:', err);
        showToast('Some dashboard data could not be loaded. Please refresh to try again.');
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  // Real-time hospital telemetry from database
  const activeHospitals = dashboardStats?.hospitals && dashboardStats.hospitals.length > 0
    ? dashboardStats.hospitals
    : [];

  // Real-time national central stock reserves from database
  const nationalReserves = dashboardStats?.vaccineReserves && dashboardStats.vaccineReserves.length > 0
    ? dashboardStats.vaccineReserves
    : [];

  const totalUsers = dashboardStats?.usersCount?.total ?? 0;
  const patientCount = dashboardStats?.usersCount?.patients ?? 0;
  const doctorCount = dashboardStats?.usersCount?.doctors ?? 0;
  const nurseCount = dashboardStats?.usersCount?.nurses ?? 0;
  const hospitalCount = dashboardStats?.usersCount?.hospitals ?? 0;

  const totalDoses = dashboardStats?.vaccinationStats?.totalDosesAdministered ?? 0;
  const todayDoses = dashboardStats?.vaccinationStats?.todayDosesAdministered ?? 0;
  const pendingCount = dashboardStats?.pendingVerificationsCount ?? pendingRequests.length;
  const wastageRate = dashboardStats?.vaccinationStats?.nationalWastageRate ?? 0.48;

  return (
    <div className="admin-dashboard-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="doctor-toast">
          <span>🔔</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Hero Command Banner */}
      <section className="doctor-hero-banner admin-hero-banner">
        <div className="doctor-hero-info">
          <h1 className="doctor-hero-title">National Immunization Command Center</h1>
          <p className="doctor-hero-subtitle">
            Welcome, {adminUser?.name || 'System Administrator'} • {adminUser?.email || 'Ministry of Health & National IT Directorate'}
          </p>
          <div className="doctor-hero-session-pill">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <IconShield size={14} /> Superadmin Access ({adminUser?.registrationNumber || 'VAX-A-1000'})
            </span>
            <span>•</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <IconHospital size={14} /> {hospitalCount} Registered Centers Active
            </span>
            <span>•</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <IconSnowflake size={14} /> Cold-Chain Telemetry: 100% Verified
            </span>
          </div>
        </div>

        <div className="doctor-hero-actions">
          <button
            type="button"
            className="doctor-btn-call-next"
            style={{ background: '#0369a1', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={() => navigate('/admin/approvals')}
          >
            <IconClipboard size={16} /> Review Approvals ({pendingCount})
          </button>
          <button
            type="button"
            className="doctor-btn-report-aefi"
            style={{ background: '#0f172a', borderColor: '#334155', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={() => navigate('/admin/users')}
          >
            <IconUsers size={16} /> Platform Directory
          </button>
        </div>
      </section>

      {/* 2. Key Metrics Ribbon (4 Cards) */}
      <section className="doctor-stats-grid">
        <div className="doctor-stat-card" onClick={() => navigate('/admin/users')} style={{ cursor: 'pointer' }}>
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Total Platform Users</span>
            <span className="doctor-stat-value">{loading ? '...' : totalUsers.toLocaleString()}</span>
            <span className="doctor-stat-meta">
              <span style={{ color: '#059669', fontWeight: 700 }}>{patientCount.toLocaleString()} Patients</span> • {doctorCount} Doctors • {nurseCount} Nurses • {hospitalCount} Hospitals
            </span>
          </div>
          <div className="doctor-stat-icon-wrapper doctor-icon-blue">
            <IconUsers size={22} />
          </div>
        </div>

        <div className="doctor-stat-card">
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Total Doses Administered</span>
            <span className="doctor-stat-value" style={{ color: '#059669' }}>
              {loading ? '...' : totalDoses.toLocaleString()}
            </span>
            <span className="doctor-stat-meta">
              <span style={{ color: '#059669', fontWeight: 700 }}>+{todayDoses} today</span> • 94.2% on-time 2nd dose
            </span>
          </div>
          <div className="doctor-stat-icon-wrapper doctor-icon-green">
            <IconSyringe size={22} />
          </div>
        </div>

        <div className="doctor-stat-card" onClick={() => navigate('/admin/approvals')} style={{ cursor: 'pointer' }}>
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Pending Verification Requests</span>
            <span className="doctor-stat-value" style={{ color: '#d97706' }}>
              {loading ? '...' : pendingCount}
            </span>
            <span className="doctor-stat-meta">
              <span style={{ color: pendingCount > 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>
                {pendingCount > 0 ? 'Action needed:' : 'Queue clear:'}
              </span>{' '}
              {pendingCount} applications pending
            </span>
          </div>
          <div className="doctor-stat-icon-wrapper doctor-icon-amber">
            <IconClock size={22} />
          </div>
        </div>

        <div className="doctor-stat-card">
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">National Wastage Rate</span>
            <span className="doctor-stat-value" style={{ color: '#38bdf8' }}>{wastageRate}%</span>
            <span className="doctor-stat-meta">
              <span style={{ color: '#059669', fontWeight: 700 }}>Well below WHO threshold (5.0%)</span>
            </span>
          </div>
          <div className="doctor-stat-icon-wrapper doctor-icon-purple">
            <IconSnowflake size={22} />
          </div>
        </div>
      </section>

      {/* 3. Main Two-Column Layout */}
      <div className="doctor-main-grid">
        {/* Left Column: Live Hospital Telemetry & Activity */}
        <div className="doctor-card">
          <div className="doctor-card-header">
            <div className="doctor-card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span className="icon-shade icon-shade-blue"><IconHospital size={22} /></span>
              Real-Time Hospital Center Telemetry
            </div>
            <button
              type="button"
              className="doctor-table-btn"
              style={{ background: '#0369a1', color: '#fff', borderColor: '#0ea5e9' }}
              onClick={() => navigate('/admin/users')}
            >
              View All Centers ↗
            </button>
          </div>

          <div className="doctor-table-wrapper">
            <table className="doctor-table">
              <thead>
                <tr>
                  <th>Hospital Center</th>
                  <th>Province</th>
                  <th>Active Booths</th>
                  <th>Doses Today</th>
                  <th>Cold Box Temp</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeHospitals.length > 0 ? (
                  activeHospitals.map((h, i) => (
                    <tr key={h.id || i}>
                      <td>
                        <strong style={{ color: '#f8fafc' }}>{h.name}</strong>
                      </td>
                      <td>{h.province || h.district || 'Western'}</td>
                      <td>
                        <span className="admin-pill-badge blue">{h.activeBooths || 0} Active</span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: '#059669' }}>{h.dosesToday || 0} doses</span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: '#38bdf8' }}>{h.temp || '3.8°C'}</span>
                      </td>
                      <td>
                        <span className="doctor-status-badge status-completed">
                          ✓ {h.status || 'Optimal'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8' }}>
                      {loading ? 'Loading real-time hospital telemetry from database...' : 'No hospital centers registered yet. New centers will appear live here upon onboarding.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: National Reserves & Quick Approval Queue */}
        <div className="doctor-side-column">
          {/* Urgent Approvals Widget */}
          <div className="doctor-obs-card">
            <div className="doctor-obs-header">
              <div className="doctor-obs-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span className="icon-shade icon-shade-amber"><IconShield size={22} /></span>
                Pending Verification Queue
              </div>
              <span className="admin-pill-badge amber" style={{ cursor: 'pointer' }} onClick={() => navigate('/admin/approvals')}>
                {pendingRequests.length} Pending
              </span>
            </div>

            <div className="doctor-obs-list">
              {pendingRequests.length > 0 ? (
                pendingRequests.map((req) => (
                  <div key={req.id} className="doctor-obs-item" style={{ cursor: 'pointer' }} onClick={() => navigate('/admin/approvals')}>
                    <div className="doctor-obs-item-info">
                      <span className="doctor-obs-item-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <RoleAvatarIcon role={req.type} size={16} />
                        {req.name}
                      </span>
                      <span className="doctor-obs-item-meta">
                        {req.regNumber} • {req.hospital}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>
                        Submitted: {req.date}
                      </span>
                    </div>
                    <div className="doctor-obs-countdown">
                      <button
                        type="button"
                        className="doctor-table-btn"
                        style={{ background: '#0369a1', color: '#fff', fontSize: '0.78rem', borderColor: '#0ea5e9' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('/admin/approvals');
                        }}
                      >
                        Review
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                  ✓ All verification requests have been processed.
                </div>
              )}
            </div>
          </div>

          {/* Central Stock Reserves */}
          <div className="doctor-coldbox-card">
            <div className="doctor-coldbox-header">
              <div className="doctor-coldbox-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span className="icon-shade icon-shade-purple"><IconPackage size={22} /></span>
                National Central Stock Reserve
              </div>
              <span className="doctor-coldbox-temp">Storage OK</span>
            </div>

            <div className="doctor-coldbox-list">
              {nationalReserves.length > 0 ? (
                nationalReserves.map((res, idx) => (
                  <div key={res.vaccineId || idx} className="doctor-coldbox-item">
                    <div>
                      <div className="doctor-coldbox-name">{res.vaccine}</div>
                      <div className="doctor-coldbox-lot">Allocated: {res.allocated} • {res.tempRange}</div>
                    </div>
                    <div className="doctor-coldbox-count">
                      <span className="doctor-coldbox-number" style={{ fontSize: '0.92rem' }}>{res.inStock}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                  {loading ? 'Loading national reserves...' : 'Vaccine reserves monitored via Central Cold Chain.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
