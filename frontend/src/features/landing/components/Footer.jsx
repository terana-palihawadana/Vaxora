import { Link } from 'react-router-dom';

const exploreLinks = [
  { id: 'features', label: 'Features' },
  { id: 'roles', label: 'Roles' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'faq', label: 'FAQ' },
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
        </div>

        <nav className="footer-col" aria-label="Explore">
          <p className="footer-heading">Explore</p>
          {exploreLinks.map((link) => (
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

        <nav className="footer-col" aria-label="Account">
          <p className="footer-heading">Account</p>
          <Link to="/login" className="footer-link">Log in</Link>
          <Link to="/signup" className="footer-link">Sign up</Link>
          <Link to="/forgot-password" className="footer-link">Reset password</Link>
        </nav>

        <nav className="footer-col" aria-label="Support">
          <p className="footer-heading">Support</p>
          <button type="button" className="footer-link" onClick={() => onNavClick('contact')}>
            Contact us
          </button>
          <button type="button" className="footer-link" onClick={() => onNavClick('reviews')}>
            Reviews
          </button>
        </nav>
      </div>

      <div className="footer-bottom">
        <p className="footer-copyright">© {currentYear} Vaxora. All rights reserved.</p>
      </div>
    </footer>
  );
}
