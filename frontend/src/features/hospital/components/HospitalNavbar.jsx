import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

import { authService, getUser, subscribeAuthUser } from '../../auth';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';
import { IconClose, IconHospital, IconLogout, IconMenu, IconTrash } from './HospitalIcons';

export default function HospitalNavbar() {
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
    { path: '/hospital/dashboard', label: 'Home' },
    { path: '/hospital/appointments', label: 'Appointments' },
    { path: '/hospital/inventory', label: 'Inventory' },
    { path: '/hospital/staff', label: 'Staff' },
    { path: '/hospital/booths', label: 'Booths' },
    { path: '/hospital/feedback', label: 'Feedback' },
  ];

  const isActive = (itemPath) => {
    if (itemPath === '/hospital/dashboard') {
      return location.pathname === '/hospital/dashboard' || location.pathname === '/hospital' || location.pathname === '/hospital/';
    }
    return location.pathname.startsWith(itemPath);
  };

  const handleNavigate = (path) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  return (
    <header className="hospital-header">
      <div className="hospital-header-inner">
        {/* Brand Logo */}
        <div className="hospital-brand-group" onClick={() => handleNavigate('/hospital/dashboard')}>
          <img src={logo} alt="Vaxora Logo" className="hospital-logo-img" />
        </div>

        {/* Center Navigation Pills (Desktop / Tablet) */}
        <nav className="hospital-nav-tabs desktop-nav-pill" aria-label="Hospital Portal Navigation">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`hospital-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right Status Indicator, Profile & Mobile Hamburger */}
        <div className="hospital-actions-area">
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="hospital-avatar-button"
              onClick={() => {
                setShowProfileMenu((prev) => !prev);
                setMobileMenuOpen(false);
              }}
              title="Hospital Operations Account"
              aria-label="Hospital Account Profile"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span className="navbar-user-meta">
                <span className="navbar-user-name">{user?.name || 'Hospital'}</span>
                <span className="navbar-user-sub">
                  {user?.registrationNumber
                    || user?.profileDetails?.hospitalType
                    || 'Hospital'}
                </span>
              </span>
              {user?.profilePhotoUrl ? (
                <img
                  key={user.profilePhotoUrl}
                  src={user.profilePhotoUrl}
                  alt={user.name || 'Hospital'}
                  className="navbar-avatar-img"
                  style={{ borderColor: 'var(--color-success-border)' }}
                />
              ) : (
                <div className="hospital-avatar-circle">
                  <IconHospital size={18} />
                </div>
              )}
            </button>

            {showProfileMenu && (
              <div className="hospital-profile-dropdown">
                <div className="hospital-dropdown-header">
                  <div className="hospital-dropdown-name">{user?.name || 'Hospital'}</div>
                  <div className="hospital-dropdown-meta">{user?.profileDetails?.hospitalType || 'Administrator Portal'}</div>
                  {user?.registrationNumber && (
                    <div className="hospital-dropdown-meta" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                      Reg: {user.registrationNumber}
                    </div>
                  )}
                </div>

                <div style={{ height: '1px', background: 'var(--color-surface-subtle)', margin: '6px 0 10px' }} />

                <button
                  type="button"
                  className="hospital-dropdown-link"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/hospital/profile');
                  }}
                >
                  View Profile
                </button>

                <button
                  type="button"
                  className="hospital-dropdown-logout"
                  onClick={handleLogout}
                >
                  Log Out
                </button>

                <button
                  type="button"
                  className="hospital-dropdown-delete"
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
              onClick={() => handleNavigate('/hospital/profile')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <IconHospital size={16} /> Hospital Profile
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
        userName={user?.name || 'Hospital Operations'}
        roleName="Hospital"
      />
    </header>
  );
}
