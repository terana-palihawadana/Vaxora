import { Link } from 'react-router-dom';

export default function CtaSection() {
  return (
    <section className="landing-section" aria-label="Get started">
      <div className="cta-card">
        <h2 className="cta-title">Ready for your next dose?</h2>
        <p className="cta-text">Create a free account and book in a few minutes.</p>
        <div className="cta-actions">
          <Link to="/signup" className="cta-btn-primary">
            Sign up
          </Link>
          <Link to="/login" className="cta-btn-secondary">
            Log in
          </Link>
        </div>
      </div>
    </section>
  );
}
