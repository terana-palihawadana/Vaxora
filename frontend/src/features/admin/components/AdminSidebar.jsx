import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

import { authService } from '../../auth';
import { IconClose, IconMenu } from '../../../shared/icons/AppIcons';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';

export default function AdminSidebar({ pendingApprovalsCount = 0 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [confirm, confirmDialog] = useConfirmDialog();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'Log out?',
      message: 'You will need to sign in again to access the admin panel.',
      cancelLabel: 'Stay',
      confirmLabel: 'Log out',
      destructive: true,
    });
    if (!ok) return;
    await authService.logout();
    navigate('/login');
  };

  const navItems = [
    {
      path: '/admin/dashboard',
      label: 'Dashboard',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      ),
    },
    {
      path: '/admin/users',
      label: 'Users Directory',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      path: '/admin/approvals',
      label: 'Approvals Queue',
      badge: pendingApprovalsCount,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      ),
    },
    {
      path: '/admin/feedback',
      label: 'Feedback & Inquiries',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      path: '/admin/audit',
      label: 'System Audit Logs',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      path: '/admin/profile',
      label: 'Admin Settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  const isActive = (itemPath) => {
    if (itemPath === '/admin/dashboard') {
      return location.pathname === '/admin/dashboard' || location.pathname === '/admin' || location.pathname === '/admin/';
    }
    return location.pathname.startsWith(itemPath);
  };

  const handleNavigate = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <>
        {/* Mobile Topbar with Hamburger Toggle */}
      <header className="admin-mobile-topbar">
        <div className="admin-mobile-brand" onClick={() => handleNavigate('/admin/dashboard')}>
          <img src={logo} alt="Vaxora Logo" className="admin-logo-img" />
          <span className="admin-brand-tag">SUPERADMIN</span>
        </div>
        <button
          type="button"
          className="admin-hamburger-btn"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label={mobileOpen ? 'Close Menu' : 'Open Menu'}
        >
          {mobileOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
        </button>
      </header>

      {/* Backdrop for Mobile */}
      {mobileOpen && (
        <div className="admin-sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main Sidebar */}
      <aside className={`admin-dark-sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Sidebar Brand Header */}
        <div className="admin-sidebar-brand" onClick={() => handleNavigate('/admin/dashboard')}>
          <img src={logo} alt="Vaxora Logo" className="admin-logo-img" />
          <div className="admin-brand-badge">
            <span className="admin-brand-title">VAXORA</span>
            <span className="admin-brand-sub">National Command</span>
          </div>
        </div>

        <div className="admin-sidebar-divider" />

        {/* Sidebar Navigation Links */}
        <nav className="admin-sidebar-nav" aria-label="Admin Navigation">
          <div className="admin-nav-section-label">MAIN CONTROLS</div>
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`admin-sidebar-link ${active ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
              >
                <span className="admin-link-icon">{item.icon}</span>
                <span className="admin-link-label">{item.label}</span>
                {item.badge > 0 && (
                  <span className="admin-link-badge">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Bottom Profile Card */}
        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-user-card" onClick={() => handleNavigate('/admin/profile')}>
            <div className="admin-sidebar-avatar">
              <svg viewBox="0 0 40 40" width="36" height="36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="19" fill="#0f172a" stroke="#0ea5e9" strokeWidth="1.5" />
                <circle cx="20" cy="15" r="7" fill="#38bdf8" />
                <path d="M8 34C8 27.5 13.5 24 20 24C26.5 24 32 27.5 32 34" fill="#38bdf8" />
              </svg>
            </div>
            <div className="admin-sidebar-user-info">
              <div className="admin-sidebar-user-name">Dr. V. Ratnayake</div>
              <div className="admin-sidebar-user-role">Superadministrator</div>
            </div>
          </div>

          <button
            type="button"
            className="admin-sidebar-logout-btn"
            onClick={handleLogout}
            title="Log Out of Admin Panel"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Log Out</span>
          </button>
        </div>
      </aside>
      {confirmDialog}
    </>
  );
}
