import {
  IconCalendar,
  IconBot,
  IconClipboard,
  IconShield,
  IconSyringe,
  IconPackage,
} from '../../../shared/icons/AppIcons';

const features = [
  {
    Icon: IconCalendar,
    title: 'Online booking',
    text: 'Pick a hospital, a vaccine and a time slot in a few taps.',
  },
  {
    Icon: IconBot,
    title: 'AI booking assistant',
    text: 'Book by chatting. The assistant finds an open slot for you.',
  },
  {
    Icon: IconClipboard,
    title: 'Vaccination history',
    text: 'Every dose you receive is saved to one record you can view any time.',
  },
  {
    Icon: IconShield,
    title: 'Personal care plan',
    text: 'See which vaccines are due next, based on your own history.',
  },
  {
    Icon: IconSyringe,
    title: 'Clinic workflow',
    text: 'Doctors and nurses run the booth queue and record each dose.',
  },
  {
    Icon: IconPackage,
    title: 'Stock and staff',
    text: 'Hospitals track vaccine batches, booths and staff rosters.',
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="landing-section">
      <div className="section-head">
        <span className="section-eyebrow">Features</span>
        <h2 className="landing-section-title">Everything a vaccination visit needs</h2>
        <p className="section-lead">
          One system for booking, the clinic visit and the record that follows.
        </p>
      </div>

      <div className="feature-grid">
        {features.map(({ Icon, title, text }) => (
          <article key={title} className="feature-card">
            <span className="feature-icon">
              <Icon size={22} />
            </span>
            <h3 className="feature-title">{title}</h3>
            <p className="feature-text">{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
