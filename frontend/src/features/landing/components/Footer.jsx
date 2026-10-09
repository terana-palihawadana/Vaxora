import { Link } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';

// Placeholder profiles: each opens the platform's own site until Vaxora has
// real accounts.
const socials = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/',
    path: 'M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H7v4h2v9h4v-9h3l1-4h-4V9c0-.6.4-1 1-1z',
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/',
    path: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm5.5-1.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
    stroke: true,
  },
  {
    label: 'X',
    href: 'https://x.com/',
    path: 'M4 4h4.6l4.1 5.6L17.6 4H20l-6.2 7.1L20.5 20h-4.6l-4.4-6-5.2 6H4l6.4-7.4z',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/',
    path: 'M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4 6h3.8v1.7c.6-1 1.9-2 3.9-2 4 0 4.3 2.6 4.3 6V21h-4v-5.6c0-1.4 0-3.1-2-3.1s-2.2 1.5-2.2 3V21H10z',
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/',
    path: 'M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1c.3-1.2.4-2.5.4-3.8s-.1-2.6-.4-3.8zM10 15V9l5.2 3z',
  },
];

export default function Footer({ onNavClick }) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <p className="footer-name">Vaxora</p>
          <p className="footer-tagline">
            Vaccination booking and records for Sri Lanka, made simple and secure.
          </p>
          <ul className="footer-socials">
            {socials.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  className="footer-social"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Vaxora on ${s.label}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    {s.stroke ? (
                      <path d={s.path} fill="none" stroke="currentColor" strokeWidth="1.8" />
                    ) : (
                      <path d={s.path} fill="currentColor" />
                    )}
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <nav className="footer-col" aria-label="Explore">
          <p className="footer-heading">Explore</p>
          {NAV_ITEMS.map((link) => (
            <button
              key={link.id}
              type="button"
              className="footer-link"
              onClick={() => onNavClick(link.id)}
            >
              {link.label}
            </button>
          ))}
        </nav>

        <nav className="footer-col" aria-label="Patients">
          <p className="footer-heading">Patients</p>
          <Link to="/signup" className="footer-link">Book a vaccine</Link>
          <Link to="/login" className="footer-link">Log in</Link>
          <Link to="/signup" className="footer-link">Create an account</Link>
          <Link to="/forgot-password" className="footer-link">Reset password</Link>
        </nav>

        <nav className="footer-col" aria-label="Staff and hospitals">
          <p className="footer-heading">Staff &amp; hospitals</p>
          <Link to="/login" className="footer-link">Doctor log in</Link>
          <Link to="/login" className="footer-link">Nurse log in</Link>
          <Link to="/login" className="footer-link">Hospital log in</Link>
          <Link to="/signup" className="footer-link">Register a hospital</Link>
        </nav>

        <div className="footer-col">
          <p className="footer-heading">Contact</p>
          <p className="footer-text">Colombo, Sri Lanka</p>
          <a href="mailto:support@vaxora.lk" className="footer-link">support@vaxora.lk</a>
          <p className="footer-text">Mon to Sat, 8 am to 6 pm</p>
          <button type="button" className="footer-link footer-link-accent" onClick={() => onNavClick('contact')}>
            Send us a message →
          </button>
        </div>
      </div>

      <div className="footer-bottom">
        <p className="footer-copyright">© {currentYear} Vaxora. All rights reserved.</p>
        <p className="footer-copyright">Built by SLIIT students</p>
      </div>
    </footer>
  );
}
