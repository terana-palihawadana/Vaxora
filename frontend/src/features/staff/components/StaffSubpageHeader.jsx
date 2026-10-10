import PortalHero from '../../../components/PortalHero';

export default function StaffSubpageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <PortalHero eyebrow={eyebrow} title={title} subtitle={subtitle}>
      {children}
    </PortalHero>
  );
}
