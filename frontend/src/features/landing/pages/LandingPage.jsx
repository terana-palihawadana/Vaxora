import { useState } from 'react';

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

export default function LandingPage() {
  const [activeNav, setActiveNav] = useState('home');

  const scrollToSection = (id) => {
    setActiveNav(id);
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
