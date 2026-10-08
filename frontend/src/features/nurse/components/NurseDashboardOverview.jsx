import StaffClinicalDashboard from '../../staff/components/StaffClinicalDashboard';
import NurseClinicalAdministerModal from './NurseClinicalAdministerModal';
import NurseAefiReportModal from './NurseAefiReportModal';
import nurseHomeHero from '../../../assets/images/nurse-home-hero.jpg';

function formatNurseName(user) {
  const raw = (user?.name || '').trim().replace(/^(?:(?:dr\.|dr\s|doctor\s|nurse\s)\s*)+/i, '').trim();
  if (!raw) return 'Nurse';
  return `Nurse ${raw}`;
}

export default function NurseDashboardOverview() {
  return (
    <StaffClinicalDashboard
      formatTitle={formatNurseName}
      heroImage={nurseHomeHero}
      heroClassName="nurse-home-hero"
      spotlightBadge="Active Immunization Station"
      allowHospitalSwitch
      AdministerModal={NurseClinicalAdministerModal}
      AefiModal={NurseAefiReportModal}
    />
  );
}
