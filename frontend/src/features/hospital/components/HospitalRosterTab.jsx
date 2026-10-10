import { useCallback, useEffect, useState } from 'react';
import HospitalCoverRequestsPanel from './HospitalCoverRequestsPanel';
import HospitalShiftsPanel from './HospitalShiftsPanel';
import staffService from '../services/staffService';
import PortalHero from '../../../components/PortalHero';
import HeroTabs from '../../../components/HeroTabs';
import useViewParam from '../../../shared/hooks/useViewParam';

const VIEWS = ['shifts', 'covers'];

export default function HospitalRosterTab() {
  const [view, setView] = useViewParam(VIEWS);
  const [pendingCoverCount, setPendingCoverCount] = useState(0);

  const handlePendingCoverCount = useCallback((count) => {
    setPendingCoverCount(Number(count) || 0);
  }, []);

  // Badge on the Cover requests tab before that panel is opened.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await staffService.getHospitalShiftSwaps({ status: 'Pending', limit: 40 });
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setPendingCoverCount(
          list.filter((r) => String(r.status || '').toLowerCase() === 'pending').length
        );
      } catch {
        if (!cancelled) setPendingCoverCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="hospital-dashboard-tab">
      <PortalHero
        eyebrow="Roster & cover"
        title="Shift roster"
        subtitle="Plan the week's shifts, let the scheduling agent suggest a roster, and approve cover requests."
      >
        <HeroTabs
          label="Roster views"
          tabs={[
            { key: 'shifts', label: 'Shifts' },
            { key: 'covers', label: 'Cover requests', badge: pendingCoverCount },
          ]}
          active={view}
          onChange={setView}
        />
      </PortalHero>

      {view === 'shifts' ? (
        <HospitalShiftsPanel />
      ) : (
        <HospitalCoverRequestsPanel onPendingCountChange={handlePendingCoverCount} />
      )}
    </div>
  );
}
