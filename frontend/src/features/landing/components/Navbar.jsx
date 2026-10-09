import { useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'features', label: 'Features' },
  { id: 'about', label: 'About' },
  { id: 'faq', label: 'FAQ' },
  { id: 'contact', label: 'Contact us' },
];

export default function Navbar({ activeNav, onNavClick }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (section) => {
    onNavClick(section);
    setMobileMenuOpen(false);
  };

  return (
    <header className="site-header">
      <div className="header-inner">
        <a href="#home" className="brand-logo" onClick={() => handleNavClick('home')}>
          <img src={logo} alt="Vaxora Logo" className="logo-img" />
        </a>

        {/* Desktop Navigation Pill */}
        <nav className="nav-pill desktop-nav-pill" aria-label="Main Navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-link ${activeNav === item.id ? 'active' : ''}`}
              onClick={() => handleNavClick(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Desktop Header Actions */}
        <div className="header-actions desktop-header-actions">
          <Link to="/login" className="btn-login">
            Log in
          </Link>
          <Link to="/signup" className="btn-signup">
            Sign up
          </Link>
        </div>

        {/* Mobile Hamburger Button */}
        <button
          type="button"
          className="mobile-hamburger-btn"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile Dropdown Menu Drawer */}
      {mobileMenuOpen && (
        <div className="mobile-nav-drawer">
          <nav className="mobile-nav-links">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mobile-nav-link ${activeNav === item.id ? 'active' : ''}`}
                onClick={() => handleNavClick(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mobile-drawer-actions">
            <Link to="/login" className="btn-login mobile-btn-login" onClick={() => setMobileMenuOpen(false)}>
              Log in
            </Link>
            <Link to="/signup" className="btn-signup mobile-btn-signup" onClick={() => setMobileMenuOpen(false)}>
              Sign up
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
