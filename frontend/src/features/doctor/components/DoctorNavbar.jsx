import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

import { authService, getUser, subscribeAuthUser } from '../../auth';
import DeleteAccountModal from '../../auth/components/DeleteAccountModal';
import { IconClose, IconDoctor, IconLogout, IconMenu, IconStethoscope, IconTrash } from '../../../shared/icons/AppIcons';
import { withStaffTitle } from '../../../shared/utils/staffName';
import usePendingInviteCount from '../../staff/hooks/usePendingInviteCount';

export default function DoctorNavbar() {
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

  const pendingInvites = usePendingInviteCount();

  const navItems = [
    { path: '/doctor/dashboard', label: 'Home' },
    { path: '/doctor/patients', label: 'Patients' },
    { path: '/doctor/shifts', label: 'My shifts' },
    { path: '/doctor/hospitals', label: 'Hospitals', badge: pendingInvites },
    { path: '/doctor/feedback', label: 'Feedback' },
  ];

  const isActive = (itemPath) => {
    if (itemPath === '/doctor/dashboard') {
      return location.pathname === '/doctor/dashboard' || location.pathname === '/doctor' || location.pathname === '/doctor/';
    }
    return location.pathname.startsWith(itemPath);
  };

  const handleNavigate = (path) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  return (
    <header className="doctor-header">
      <div className="doctor-header-inner">
        {/* Brand Logo */}
        <div className="doctor-brand-group" onClick={() => handleNavigate('/doctor/dashboard')}>
          <img src={logo} alt="Vaxora Logo" className="doctor-logo-img" />
        </div>

        {/* Center Pill Navigation (Desktop / Tablet) */}
        <nav className="doctor-nav-tabs desktop-nav-pill" aria-label="Doctor Portal Navigation">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`doctor-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
              >
                {item.label}
                {item.badge > 0 ? <span className="nav-count-badge">{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>

        {/* Right User Profile Avatar & Mobile Hamburger Toggle */}
        <div className="doctor-actions-area">
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="doctor-avatar-button"
              onClick={() => {
                setShowProfileMenu((prev) => !prev);
                setMobileMenuOpen(false);
              }}
              title="Doctor Account Profile"
              aria-label="Doctor Account Profile"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span className="navbar-user-meta">
                <span className="navbar-user-name">{withStaffTitle(user?.name, 'Dr.', 'Doctor')}</span>
                <span className="navbar-user-sub">
                  {user?.registrationNumber
                    || user?.profileDetails?.specialization
                    || 'Doctor'}
                </span>
              </span>
              {user?.profilePhotoUrl ? (
                <img
                  key={user.profilePhotoUrl}
                  src={user.profilePhotoUrl}
                  alt={user.name || 'Doctor'}
                  className="navbar-avatar-img"
                />
              ) : (
                <div className="navbar-avatar-fallback">
                  <IconDoctor size={20} />
                </div>
              )}
            </button>

            {showProfileMenu && (
              <div className="doctor-profile-dropdown">
                <div className="doctor-dropdown-header">
                  <div className="doctor-dropdown-name">{withStaffTitle(user?.name, 'Dr.', 'Dr. Medical Practitioner')}</div>
                  <div className="doctor-dropdown-meta">{user?.profileDetails?.specialization || 'Consultant Specialist'}</div>
                  {user?.registrationNumber && (
                    <div className="doctor-dropdown-meta" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                      Reg: {user.registrationNumber}
                    </div>
                  )}
                </div>

                <div style={{ height: '1px', background: 'var(--color-surface-subtle)', margin: '6px 0 10px' }} />

                <button
                  type="button"
                  className="doctor-dropdown-link"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/doctor/profile');
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
                  {item.label}
                  {item.badge > 0 ? <span className="nav-count-badge">{item.badge}</span> : null}
                </button>
              );
            })}
            <div style={{ height: '1px', background: 'var(--color-soft-panel-deep)', margin: '6px 0' }} />
            <button
              type="button"
              className="portal-mobile-nav-btn"
              onClick={() => handleNavigate('/doctor/profile')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <IconStethoscope size={16} /> Doctor Profile
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
        userName={withStaffTitle(user?.name, 'Dr.', 'Dr. Medical Practitioner')}
        roleName="Doctor"
      />
    </header>
  );
}
