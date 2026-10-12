import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

import { authService, clearAuth } from '../../auth';
import { IconHospital } from '../../hospital/components/HospitalIcons';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';
import deskService from '../services/deskService';

export default function DeskNavbar() {
  const navigate = useNavigate();
  const [confirm, confirmDialog] = useConfirmDialog();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [hospital, setHospital] = useState(null);
  const user = authService.getUser();
  const profileMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const loadHospital = async () => {
      try {
        const data = await deskService.getMyHospital();
        if (!cancelled) setHospital(data);
      } catch (err) {
        // A 403 means the hospital removed this desk account: end the session.
        if (!cancelled && err?.status === 403) {
          clearAuth();
          navigate('/login', {
            replace: true,
            state: { message: 'This front desk account has been removed by the hospital.' },
          });
        }
        /* otherwise keep the generic label */
      }
    };
    loadHospital();
    const id = window.setInterval(loadHospital, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [navigate]);

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
      message: 'You will need to sign in again to use the front desk.',
      cancelLabel: 'Stay',
      confirmLabel: 'Log out',
      destructive: true,
    });
    if (!ok) return;
    await authService.logout();
    navigate('/login');
  };

  const hospitalName = hospital?.hospitalName || 'Front Desk';
  // Accounts created before names were collected come back as the generic "Front Desk".
  const staffName = user?.name && user.name !== 'Front Desk' ? user.name : '';

  return (
    <header className="hospital-header">
      <div className="hospital-header-inner">
        <div className="hospital-brand-group" onClick={() => navigate('/desk')}>
          <img src={logo} alt="Vaxora Logo" className="hospital-logo-img" />
        </div>

        {/* No centre nav here, so pin the account menu to the last grid column. */}
        <div className="hospital-actions-area" style={{ gridColumn: 3 }}>
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="hospital-avatar-button"
              onClick={() => setShowProfileMenu((prev) => !prev)}
              title="Front Desk Account"
              aria-label="Front Desk Account"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span className="navbar-user-meta">
                <span className="navbar-user-name">{staffName || hospitalName}</span>
                <span className="navbar-user-sub">Front desk</span>
              </span>
              {hospital?.hospitalLogoUrl ? (
                <img
                  src={hospital.hospitalLogoUrl}
                  alt={hospitalName}
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
                  <div className="hospital-dropdown-name">{staffName || hospitalName}</div>
                  {staffName && <div className="hospital-dropdown-meta">{hospitalName}</div>}
                  <div className="hospital-dropdown-meta">{user?.email || 'Front desk'}</div>
                  {user?.registrationNumber && (
                    <div className="hospital-dropdown-meta" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                      Desk ID: {user.registrationNumber}
                    </div>
                  )}
                </div>

                <div style={{ height: '1px', background: 'var(--color-surface-subtle)', margin: '6px 0 10px' }} />

                <button type="button" className="hospital-dropdown-logout" onClick={handleLogout}>
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmDialog}
    </header>
  );
}
