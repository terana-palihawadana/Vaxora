import StaffClinicalDashboard from '../../staff/components/StaffClinicalDashboard';
import ClinicalAdministerModal from './ClinicalAdministerModal';
import AefiReportModal from './AefiReportModal';
import doctorHomeHero from '../../../assets/images/doctor-home-hero.jpg';
import { withStaffTitle } from '../../../shared/utils/staffName';

function formatDoctorName(user) {
  return withStaffTitle(user?.name, 'Dr.', 'Doctor');
}

export default function DoctorDashboardOverview() {
  return (
    <StaffClinicalDashboard
      formatTitle={formatDoctorName}
      heroImage={doctorHomeHero}
      spotlightBadge="Active Clinical Consultation"
      allowHospitalSwitch
      AdministerModal={ClinicalAdministerModal}
      AefiModal={AefiReportModal}
    />
  );
}
