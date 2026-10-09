import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
} from '../../../shared/icons/AppIcons';
import heroPatient from '../../../assets/images/landing/hero-patient.jpg';
import heroFamily from '../../../assets/images/landing/hero-family.jpg';
import heroClinic from '../../../assets/images/landing/hero-clinic.jpg';
import heroHospital from '../../../assets/images/landing/hero-hospital.jpg';

// The timer bar's fill animation drives autoplay, so pausing the animation
// (hover, focus, pause button, reduced motion) pauses the slides too.
const SLIDE_MS = 6500;
const SWIPE_PX = 50;

const highlights = ['Verified staff', 'Secure records', 'AI booking help'];

const slides = [
  {
    name: 'Patients',
    image: heroPatient,
    alt: 'A smiling woman receiving a vaccine from a nurse',
    eyebrow: 'Vaccination made simple',
    title: 'Book your vaccine in a few minutes',
    text: 'Streamlining healthcare with secure, accessible, and efficient vaccination management for all Sri Lankans',
    primary: { to: '/signup', label: 'Book vaccine' },
    secondary: { to: '/login', label: 'Log in' },
    showHighlights: true,
  },
  {
    name: 'Families',
    image: heroFamily,
    alt: 'A paediatric nurse vaccinating a baby held by their mother',
    eyebrow: 'For the whole family',
    title: 'Every dose, in one record',
    text: 'Book for yourself and keep a clear vaccination history you can open any time.',
    primary: { to: '/signup', label: 'Create an account' },
  },
  {
    name: 'Clinics',
    image: heroClinic,
    alt: 'A nurse caring for a patient in a clinic',
    eyebrow: 'For doctors and nurses',
    title: 'Clinics that run on time',
    text: 'Manage the booth queue, give each dose and record it in the same place.',
    primary: { to: '/login', label: 'Staff log in' },
  },
  {
    name: 'Hospitals',
    image: heroHospital,
    alt: 'Hospital staff walking down a bright corridor',
    eyebrow: 'For hospitals',
    title: 'Verified hospitals and staff',
    text: 'The Ministry of Health checks every professional before they can join.',
    primary: { to: '/signup', label: 'Get started' },
  },
];

const pad = (n) => String(n).padStart(2, '0');

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export default function HeroSection() {
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(prefersReducedMotion);
  const [hoverPaused, setHoverPaused] = useState(false);
  const touchStartX = useRef(null);

  const paused = userPaused || hoverPaused;
  const count = slides.length;

  const go = useCallback((next) => {
    setIndex((next + count) % count);
  }, [count]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  };

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > SWIPE_PX) go(index + (dx < 0 ? 1 : -1));
    touchStartX.current = null;
  };

  return (
    <section
      id="home"
      className={`lp-hero ${paused ? 'is-paused' : ''}`}
      aria-roledescription="carousel"
      aria-label="Vaxora highlights"
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Full-bleed backgrounds and the text for each slide */}
      {slides.map((slide, i) => {
        const active = i === index;
        return (
          <div
            key={slide.name}
            className={`lp-hero-slide ${active ? 'is-active' : ''}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}: ${slide.name}`}
            aria-hidden={!active}
          >
            <img
              src={slide.image}
              alt={slide.alt}
              className="lp-hero-img"
              loading={i === 0 ? 'eager' : 'lazy'}
            />
            <div className="lp-hero-overlay" aria-hidden="true" />

            <div className="lp-hero-content">
              <span className="lp-hero-eyebrow">{slide.eyebrow}</span>
              {i === 0 ? (
                <h1 className="lp-hero-title">{slide.title}</h1>
              ) : (
                <h2 className="lp-hero-title">{slide.title}</h2>
              )}
              <p className="lp-hero-text">{slide.text}</p>
              <div className="lp-hero-actions">
                <Link
                  to={slide.primary.to}
                  className="lp-hero-btn lp-hero-btn-primary"
                  tabIndex={active ? undefined : -1}
                >
                  {slide.primary.label}
                  <span className="lp-hero-btn-arrow" aria-hidden="true">→</span>
                </Link>
                {slide.secondary && (
                  <Link
                    to={slide.secondary.to}
                    className="lp-hero-btn lp-hero-btn-ghost"
                    tabIndex={active ? undefined : -1}
                  >
                    {slide.secondary.label}
                  </Link>
                )}
              </div>
              {slide.showHighlights && (
                <ul className="lp-hero-highlights">
                  {highlights.map((item) => (
                    <li key={item}>
                      <IconCheck size={16} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}

      {/* Big outlined word for the current slide */}
      <p className="lp-hero-ghost" key={`ghost-${index}`} aria-hidden="true">
        {slides[index].name}
      </p>

      {/* Vertical slide line (desktop) */}
      <div className="lp-hero-rail">
        {slides.map((slide, i) => (
          <button
            key={slide.name}
            type="button"
            className={`lp-hero-rail-dot ${i === index ? 'is-active' : ''}`}
            onClick={() => go(i)}
            aria-label={`Go to slide ${i + 1}: ${slide.name}`}
            aria-current={i === index ? 'true' : undefined}
          />
        ))}
        <span className="lp-hero-rail-count" aria-hidden="true">
          {pad(index + 1)}/{pad(count)}
        </span>
      </div>

      {/* Card deck temporarily commented out
      <div
        className="lp-hero-deck"
        onMouseEnter={() => setHoverPaused(true)}
        onMouseLeave={() => setHoverPaused(false)}
      >
        {slides.map((slide, i) => {
          // 0 = current slide (leaves into the background), 1.. = queue
          const pos = (i - index + count) % count;
          return (
            <button
              key={slide.name}
              type="button"
              className={`lp-hero-card ${pos === 0 ? 'is-current' : ''}`}
              style={{ '--pos': pos - 1 }}
              onClick={() => go(i)}
              tabIndex={pos === 0 ? -1 : undefined}
              aria-hidden={pos === 0}
              aria-label={`Show ${slide.name}: ${slide.title}`}
            >
              <span className="lp-hero-card-label">
                <span className="lp-hero-card-name">{slide.name}</span>
                <span className="lp-hero-card-sub">{slide.eyebrow}</span>
              </span>
              <span className="lp-hero-card-media">
                <img src={slide.image} alt="" loading="lazy" />
              </span>
            </button>
          );
        })}
      </div>
      */}

      {/* Prev / pause / next — sits where the old 01—04 loader was */}
      <div className="lp-hero-nav">
        <button type="button" className="lp-hero-round" onClick={() => go(index - 1)} aria-label="Previous slide">
          <IconChevronLeft size={20} />
        </button>
        <button
          type="button"
          className="lp-hero-round lp-hero-round-sm"
          onClick={() => setUserPaused((p) => !p)}
          aria-label={userPaused ? 'Play slideshow' : 'Pause slideshow'}
        >
          {userPaused ? (
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className="lp-hero-round" onClick={() => go(index + 1)} aria-label="Next slide">
          <IconChevronRight size={20} />
        </button>
        {/* Hidden timer keeps autoplay without showing the loader */}
        <span className="lp-hero-timer lp-hero-timer-hidden" aria-hidden="true">
          <span
            key={index}
            className="lp-hero-timer-fill"
            style={{ animationDuration: `${SLIDE_MS}ms` }}
            onAnimationEnd={() => go(index + 1)}
          />
        </span>
      </div>
    </section>
  );
}
