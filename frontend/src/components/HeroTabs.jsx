/**
 * Pill tabs that sit inside a PortalHero to switch a page's views.
 * tabs: [{ key, label, badge? }]
 */
export default function HeroTabs({ tabs, active, onChange, label }) {
  return (
    <div className="hospital-staff-hero-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`hospital-staff-hero-tab ${active === tab.key ? 'active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.badge > 0 ? <span className="hospital-staff-hero-tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
