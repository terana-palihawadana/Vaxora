
import StaffHospitalAffiliationsTab from '../../staff/components/StaffHospitalAffiliationsTab';

/** view: 'shifts' (My shifts page) or 'hospitals' (Hospitals page). */
export default function NurseAffiliationsTab({ view }) {
  return <StaffHospitalAffiliationsTab roleLabel="Nurse" view={view} />;
}
