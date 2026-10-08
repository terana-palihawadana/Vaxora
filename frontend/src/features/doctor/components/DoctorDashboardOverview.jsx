import StaffClinicalDashboard from '../../staff/components/StaffClinicalDashboard';
import ClinicalAdministerModal from './ClinicalAdministerModal';
import AefiReportModal from './AefiReportModal';
import doctorHomeHero from '../../../assets/images/doctor-home-hero.jpg';

function formatDoctorName(user) {
  const raw = (user?.name || '').trim().replace(/^(?:(?:dr\.|dr\s|doctor\s|nurse\s)\s*)+/i, '').trim();
  if (!raw) return 'Doctor';
  return `Dr. ${raw}`;
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
