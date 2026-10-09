import { Link } from 'react-router-dom';
import heroVaccine from '../../../assets/images/hero_vaccine.jpg';
import { IconCheck } from '../../../shared/icons/AppIcons';

const highlights = ['Verified staff', 'Secure records', 'AI booking help'];

export default function HeroSection() {
  return (
    <section id="home" className="hero-section">
      <div className="hero-grid">
        <div className="hero-content">
          <span className="section-eyebrow">Vaccination made simple</span>
          <h1 className="hero-title">
            Book your vaccine in a few minutes
          </h1>
          <p className="hero-subtitle">
            Streamlining healthcare with secure, accessible, and efficient vaccination management for all Sri Lankans
          </p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="btn-primary btn-book">
              Book vaccine
            </Link>
            <Link to="/login" className="btn-hero-secondary">
              Log in
            </Link>
          </div>
          <ul className="hero-highlights">
            {highlights.map((item) => (
              <li key={item}>
                <IconCheck size={16} className="hero-highlight-icon" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="hero-media-wrapper">
          <div className="hero-card">
            <img
              src={heroVaccine}
              alt="Medical professional holding vaccine vial and syringe"
              className="hero-image"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
