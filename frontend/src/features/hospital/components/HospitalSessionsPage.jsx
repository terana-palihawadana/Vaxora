import PortalHero from '../../../components/PortalHero';
import HeroTabs from '../../../components/HeroTabs';
import useViewParam from '../../../shared/hooks/useViewParam';
import HospitalAppointmentsTab from './HospitalAppointmentsTab';
import HospitalBoothsPanel from './HospitalBoothsPanel';

const VIEWS = ['sessions', 'booths'];

/** What the hospital offers, where and when: published sessions and the booths that give each vaccine. */
export default function HospitalSessionsPage() {
  const [view, setView] = useViewParam(VIEWS);

  return (
    <div className="hospital-dashboard-tab">
      <PortalHero
        eyebrow="Clinic setup"
        title="Sessions"
        subtitle={
          view === 'sessions'
            ? 'Publish vaccination sessions and manage recurring availability. Patients book into these.'
            : 'Set up vaccination booths and the vaccines each one gives. Sessions open at matching booths.'
        }
      >
        <HeroTabs
          label="Session views"
          tabs={[
            { key: 'sessions', label: 'Sessions' },
            { key: 'booths', label: 'Booths' },
          ]}
          active={view}
          onChange={setView}
        />
      </PortalHero>

      {view === 'sessions' ? <HospitalAppointmentsTab view="sessions" /> : <HospitalBoothsPanel />}
    </div>
  );
}
