import StaffClinicalDashboard from '../../staff/components/StaffClinicalDashboard';
import NurseClinicalAdministerModal from './NurseClinicalAdministerModal';
import NurseAefiReportModal from './NurseAefiReportModal';
import nurseHomeHero from '../../../assets/images/nurse-home-hero.jpg';
import { withStaffTitle } from '../../../shared/utils/staffName';

function formatNurseName(user) {
  return withStaffTitle(user?.name, 'Nurse');
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
