import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../../../assets/images/logo.png';
import { NAV_ITEMS as navItems } from './navItems';

// How the logo stays readable over the hero photo:
// 'chip' = frosted white tile behind it, 'wordmark' = word turns white.
const LOGO_STYLE = 'wordmark';
export default function Navbar({ activeNav, onNavClick }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [overHero, setOverHero] = useState(true);

  // The header blends into the hero carousel, then turns solid once the
  // carousel has scrolled out from under it.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = document.getElementById('home');
      const header = document.querySelector('.site-header');
      if (!hero || !header) return;
      setOverHero(hero.getBoundingClientRect().bottom > header.offsetHeight);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const handleNavClick = (section) => {
    onNavClick(section);
    setMobileMenuOpen(false);
  };

  const transparent = overHero && !mobileMenuOpen;

  return (
    <header
      className={`site-header ${transparent ? 'is-over-hero' : ''}`}
      data-logo={LOGO_STYLE}
    >
      <div className="header-inner">
        <a href="#home" className="brand-logo" onClick={() => handleNavClick('home')}>
          <span className="logo-stack">
            <img src={logo} alt="Vaxora Logo" className="logo-img" />
            {/* White copy of the wordmark, shown over the hero in the
                "wordmark" style; the coloured mark above it stays as is. */}
            <img src={logo} alt="" aria-hidden="true" className="logo-img logo-img-word" />
          </span>
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
