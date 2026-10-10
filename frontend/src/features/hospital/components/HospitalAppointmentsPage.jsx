import PortalHero from '../../../components/PortalHero';
import HeroTabs from '../../../components/HeroTabs';
import useViewParam from '../../../shared/hooks/useViewParam';
import HospitalDashboardOverview from './HospitalDashboardOverview';
import HospitalAppointmentsTab from './HospitalAppointmentsTab';

const VIEWS = ['today', 'bookings'];

/** Front desk: today's live queue, and every booking across dates. */
export default function HospitalAppointmentsPage() {
  const [view, setView] = useViewParam(VIEWS);

  return (
    <div className="hospital-dashboard-tab">
      <PortalHero
        eyebrow="Front desk"
        title="Appointments"
        subtitle={
          view === 'today'
            ? 'Check patients in, take desk payments, register walk-ins and mark no-shows.'
            : 'Every booking across dates. Accept, decline or cancel before the visit.'
        }
      >
        <HeroTabs
          label="Appointment views"
          tabs={[
            { key: 'today', label: 'Today' },
            { key: 'bookings', label: 'Bookings' },
          ]}
          active={view}
          onChange={setView}
        />
      </PortalHero>

      {view === 'today' ? (
        <HospitalDashboardOverview view="queue" />
      ) : (
        <HospitalAppointmentsTab view="bookings" />
      )}
    </div>
  );
}
