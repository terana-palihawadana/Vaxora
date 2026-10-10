/**
 * Pill links inside a PortalHero that smooth-scroll to same-page sections.
 * links: [{ id, label }]
 */
export default function HeroSectionLinks({ links, label = 'Page sections' }) {
  if (!Array.isArray(links) || links.length < 2) return null;

  const goTo = (id) => (event) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="hospital-staff-hero-tabs" aria-label={label}>
      {links.map((link) => (
        <a
          key={link.id}
          href={`#${link.id}`}
          className="hospital-staff-hero-tab"
          onClick={goTo(link.id)}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
