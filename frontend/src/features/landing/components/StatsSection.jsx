
import badgeExperience from '../../../assets/icons/badge_experience.svg';
import networkMembers from '../../../assets/icons/network_members.svg';
import hospitalDoctors from '../../../assets/icons/hospital_doctors.svg';
import chartReviews from '../../../assets/icons/chart_reviews.svg';

const statsData = [
  {
    icon: badgeExperience,
    alt: 'Verification badge',
    highlight: 'Verified staff',
    subtext: 'Ministry approved',
  },
  {
    icon: networkMembers,
    alt: 'Connected network',
    highlight: 'AI booking',
    subtext: 'Finds your slot',
  },
  {
    icon: hospitalDoctors,
    alt: 'Hospitals and doctors',
    highlight: 'Live booth queue',
    subtext: 'Arrival to discharge',
  },
  {
    icon: chartReviews,
    alt: 'Records chart',
    highlight: 'Digital records',
    subtext: 'Every dose on file',
  },
];

export default function StatsSection() {
  return (
    <section className="stats-section" aria-label="Portal highlights">
      <div className="stats-grid">
        {statsData.map((stat, idx) => (
          <div key={idx} className="stat-card">
            <div className="stat-icon-wrapper">
              <img src={stat.icon} alt={stat.alt} className="stat-icon" />
            </div>
            <div className="stat-text">
              <h3 className="stat-highlight">{stat.highlight}</h3>
              <p className="stat-subtext">{stat.subtext}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
