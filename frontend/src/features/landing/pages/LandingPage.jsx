import { useEffect, useRef, useState } from 'react';

import {
  Navbar,
  HeroSection,
  AboutSection,
  StatsSection,
  FeaturesSection,
  RolesSection,
  StepsSection,
  ContactSection,
  ReviewsSection,
  FaqSection,
  CtaSection,
  Footer,
} from '../components';
import { NAV_ITEMS } from '../components/navItems';

export default function LandingPage() {
  const [activeNav, setActiveNav] = useState('home');
  // While a nav click is smooth-scrolling, keep the clicked item highlighted
  // instead of flicking through every section on the way.
  const navLockUntil = useRef(0);

  // Highlight the nav item for the section being read: the last section
  // whose top has passed a line 40% down the viewport.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < navLockUntil.current) return;
      const line = window.innerHeight * 0.4;
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
      let current = NAV_ITEMS[0].id;
      NAV_ITEMS.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      });
      if (atBottom) current = NAV_ITEMS[NAV_ITEMS.length - 1].id;
      setActiveNav(current);
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

  const scrollToSection = (id) => {
    setActiveNav(id);
    navLockUntil.current = Date.now() + 1000;
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const focusContactForm = () => {
    scrollToSection('contact');
    const nameInput = document.getElementById('contact-name-input');
    if (nameInput) {
      nameInput.focus();
    }
  };

  // Reveal content as it scrolls into view. Items in the same group fade up
  // one after another; big cards zoom in slightly.
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const fadeTargets = [
      '.section-head',
      '.about-title',
      '.about-description',
      '.stat-card',
      '.feature-card',
      '.role-card',
      '.step-card',
      '.reviews-title',
      '.faq-item',
      '.contact-info',
      '.contact-form-card',
    ];
    const zoomTargets = ['.about-card', '.cta-card'];

    const items = [];
    const tag = (selector, kind) => {
      document.querySelectorAll(`.landing-container main ${selector}`).forEach((el) => {
        const siblings = [...el.parentElement.children].filter((c) => c.matches(selector));
        el.dataset.reveal = kind;
        el.style.setProperty('--reveal-delay', `${Math.min(siblings.indexOf(el), 5) * 90}ms`);
        items.push(el);
      });
    };
    fadeTargets.forEach((selector) => tag(selector, 'up'));
    zoomTargets.forEach((selector) => tag(selector, 'zoom'));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            el.classList.add('is-revealed');
            observer.unobserve(el);
            // Hand the element back to its own styles (hover lifts etc.)
            // once the entrance has finished.
            const delay = parseInt(el.style.getPropertyValue('--reveal-delay'), 10) || 0;
            setTimeout(() => {
              delete el.dataset.reveal;
              el.classList.remove('is-revealed');
            }, delay + 900);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-container">
      {/* 1. Header / Navigation */}
      <Navbar
        activeNav={activeNav}
        onNavClick={scrollToSection}
      />

      <main>
        {/* 2. Hero Section */}
        <HeroSection />

        {/* 3. About the Portal */}
        <AboutSection />

        {/* 4. Portal Statistics & Impact Badges */}
        <StatsSection />

        {/* 5. Feature Highlights */}
        <FeaturesSection />

        {/* 6. Built for Every Role */}
        <RolesSection />

        {/* 7. How It Works */}
        <StepsSection />

        {/* 8. User Reviews Carousel */}
        <ReviewsSection />

        {/* 9. FAQ */}
        <FaqSection />

        {/* 10. Contact Us & Booking Form */}
        <ContactSection onArrowClick={focusContactForm} />

        {/* 11. Final Call to Action */}
        <CtaSection />
      </main>

      {/* 12. Footer */}
      <Footer onNavClick={scrollToSection} />
    </div>
  );
}
