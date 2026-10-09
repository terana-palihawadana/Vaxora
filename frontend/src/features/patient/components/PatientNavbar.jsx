import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

import { authService, getUser, subscribeAuthUser } from '../../auth';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';
import { IconClose, IconLogout, IconMenu, IconTrash, IconUser } from '../../../shared/icons/AppIcons';

export default function PatientNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
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
    await authService.logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/patient/dashboard', label: 'Home' },
    { path: '/patient/appointments', label: 'Appointments' },
    { path: '/patient/vaccination-history', label: 'Patient history' },
    { path: '/patient/feedback', label: 'Feedback' },
  ];

  const isActive = (itemPath) => {
    if (itemPath === '/patient/dashboard') {
      return location.pathname === '/patient/dashboard' || location.pathname === '/patient' || location.pathname === '/patient/';
    }
    if (itemPath === '/patient/vaccination-history') {
      return location.pathname.includes('vaccination-history') || location.pathname.includes('history');
    }
    return location.pathname.startsWith(itemPath);
  };

  const handleNavigate = (path) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  return (
    <header className="patient-header">
      <div className="patient-header-inner">
        {/* Brand Logo */}
        <div
          className="patient-brand"
          onClick={() => handleNavigate('/patient/dashboard')}
        >
          <img src={logo} alt="Vaxora Logo" className="patient-logo-img" />
        </div>

        {/* Center Pill Navigation (Desktop / Tablet) */}
        <nav className="patient-nav-tabs desktop-nav-pill" aria-label="Patient Portal Navigation">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`patient-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right User Profile Avatar & Mobile Hamburger Toggle */}
        <div className="patient-user-area">
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="patient-avatar-button"
              onClick={() => {
                setShowProfileMenu((prev) => !prev);
                setMobileMenuOpen(false);
              }}
              title="Account Profile"
              aria-label="Account Profile"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span className="navbar-user-meta">
                <span className="navbar-user-name">{user?.name || 'Patient'}</span>
                <span className="navbar-user-sub">
                  {user?.registrationNumber || user?.email || 'Patient'}
                </span>
              </span>
              {user?.profilePhotoUrl ? (
                <img
                  key={user.profilePhotoUrl}
                  src={user.profilePhotoUrl}
                  alt={user.name || 'Patient'}
                  className="navbar-avatar-img"
                />
              ) : (
                <div className="navbar-avatar-fallback">
                  <IconUser size={20} />
                </div>
              )}
            </button>

            {/* Profile Dropdown Popup */}
            {showProfileMenu && (
              <div className="patient-profile-dropdown">
                <div className="profile-dropdown-header">
                  <div className="profile-dropdown-name">{user?.name || 'Patient Profile'}</div>
                  <div className="profile-dropdown-id">
                    {user?.registrationNumber ? `ID: ${user.registrationNumber}` : (user?.email || '')}
                  </div>
                </div>
                <div className="profile-dropdown-divider" />
                <button
                  type="button"
                  className="profile-dropdown-link"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/patient/profile');
                  }}
                >
                  View Profile
                </button>
                <button
                  type="button"
                  className="profile-dropdown-logout"
                  onClick={handleLogout}
                >
                  Log Out
                </button>

                <button
                  type="button"
                  className="profile-dropdown-delete"
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
                  {item.label}
                </button>
              );
            })}
            <div style={{ height: '1px', background: 'var(--color-soft-panel-deep)', margin: '6px 0' }} />
            <button
              type="button"
              className="portal-mobile-nav-btn"
              onClick={() => handleNavigate('/patient/profile')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <IconUser size={16} /> View My Profile
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
      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        userName={user?.name || 'Patient Profile'}
        roleName="Patient"
      />
    </header>
  );
}
