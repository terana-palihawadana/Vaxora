import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';
import { authService, getUser, subscribeAuthUser } from '../../auth';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';
import { IconClose, IconLogout, IconMenu, IconShield, IconTrash } from '../../../shared/icons/AppIcons';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';

export default function AdminNavbar({ pendingApprovalsCount = 0 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [confirm, confirmDialog] = useConfirmDialog();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(() =>
    typeof authService?.getUser === 'function' ? authService.getUser() : (getUser ? getUser() : null)
  );
  const profileMenuRef = useRef(null);

  useEffect(
    () =>
      subscribeAuthUser(() => {
        setUser(typeof authService?.getUser === 'function' ? authService.getUser() : (getUser ? getUser() : null));
      }),
    []
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    }

    if (showProfileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showProfileMenu]);

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
    { path: '/admin/dashboard', label: 'Home' },
    { path: '/admin/users', label: 'Users' },
    { path: '/admin/approvals', label: 'Approvals', badge: pendingApprovalsCount },
    { path: '/admin/feedback', label: 'Feedback' },
    { path: '/admin/audit', label: 'Audit Logs' },
  ];

  const isActive = (itemPath) => {
    if (itemPath === '/admin/dashboard') {
      return location.pathname === '/admin/dashboard' || location.pathname === '/admin' || location.pathname === '/admin/';
    }
    return location.pathname.startsWith(itemPath);
  };

  const handleNavigate = (path) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  return (
    <header className="doctor-header admin-header">
      <div className="doctor-header-inner">
        {/* Brand Logo */}
        <div className="doctor-brand-group" onClick={() => handleNavigate('/admin/dashboard')}>
          <img src={logo} alt="Vaxora Logo" className="doctor-logo-img" />
        </div>

        {/* Center Pill Navigation (Desktop / Tablet) */}
        <nav className="doctor-nav-tabs desktop-nav-pill" aria-label="Admin Portal Navigation">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`doctor-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
                style={{ position: 'relative' }}
              >
                {item.label}
                {item.badge > 0 && (
                  <span className="admin-nav-counter-badge">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right User Profile Avatar & Mobile Hamburger Toggle */}
        <div className="doctor-actions-area">
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="doctor-avatar-button admin-avatar-btn"
              onClick={() => {
                setShowProfileMenu((prev) => !prev);
                setMobileMenuOpen(false);
              }}
              title="Superadmin Profile"
              aria-label="Superadmin Profile"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span className="navbar-user-meta">
                <span className="navbar-user-name">{user?.name || 'Admin'}</span>
                <span className="navbar-user-sub">
                  {user?.email || 'Administrator'}
                </span>
              </span>
              {user?.profilePhotoUrl ? (
                <img
                  key={user.profilePhotoUrl}
                  src={user.profilePhotoUrl}
                  alt={user.name || 'Admin'}
                  className="navbar-avatar-img"
                  style={{ borderColor: '#0ea5e9' }}
                />
              ) : (
                <div className="navbar-avatar-fallback" style={{ background: '#e0f2fe', color: '#0369a1', borderColor: '#0ea5e9' }}>
                  <IconShield size={20} />
                </div>
              )}
            </button>

            {showProfileMenu && (
              <div className="doctor-profile-dropdown">
                <div className="doctor-dropdown-header">
                  <div className="doctor-dropdown-name">{user?.name || 'System Administrator'}</div>
                  <div className="doctor-dropdown-meta">National System Superadmin</div>
                  <div className="doctor-dropdown-meta" style={{ color: '#0369a1', fontWeight: 600 }}>
                    {user?.email || 'MOH IT Directorate'}
                  </div>
                </div>

                <div style={{ height: '1px', background: '#f1f5f9', margin: '6px 0 10px' }} />

                <button
                  type="button"
                  className="doctor-dropdown-link"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/admin/profile');
                  }}
                >
                  View Profile
                </button>

                <button
                  type="button"
                  className="doctor-dropdown-logout"
                  onClick={handleLogout}
                >
                  Log Out
                </button>

                <button
                  type="button"
                  className="doctor-dropdown-delete"
                  onClick={() => {
                    setShowProfileMenu(false);
                    setIsDeleteModalOpen(true);
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <IconTrash size={16} /> Delete Account
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            className="mobile-hamburger-btn portal-hamburger-btn"
            onClick={() => {
              setMobileMenuOpen((prev) => !prev);
              setShowProfileMenu(false);
            }}
            aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          >
            {mobileMenuOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="portal-mobile-drawer">
          <nav className="portal-mobile-nav-list">
            {navItems.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  className={`portal-mobile-nav-btn ${active ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.path)}
                >
                  {item.label} {item.badge > 0 ? `(${item.badge})` : ''}
                </button>
              );
            })}
            <div style={{ height: '1px', background: '#e2e8f0', margin: '6px 0' }} />
            <button
              type="button"
              className="portal-mobile-nav-btn"
              onClick={() => handleNavigate('/admin/profile')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <IconShield size={16} /> Admin Profile
              </span>
            </button>
            <button
              type="button"
              className="portal-mobile-nav-btn text-danger"
              onClick={handleLogout}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <IconLogout size={16} /> Log Out
              </span>
            </button>
            <button
              type="button"
              className="portal-mobile-nav-btn text-danger"
              onClick={() => {
                setMobileMenuOpen(false);
                setIsDeleteModalOpen(true);
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <IconTrash size={16} /> Delete Account
              </span>
            </button>
          </nav>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {confirmDialog}
      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        userName={user?.name || 'System Administrator'}
        roleName="Administrator"
      />
    </header>
  );
}
