
import StaffHospitalAffiliationsTab from '../../staff/components/StaffHospitalAffiliationsTab';

/** view: 'shifts' (My shifts page) or 'hospitals' (Hospitals page). */
export default function DoctorAffiliationsTab({ view }) {
  return <StaffHospitalAffiliationsTab roleLabel="Doctor" view={view} />;
}
