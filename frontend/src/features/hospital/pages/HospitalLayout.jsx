
import { Outlet } from 'react-router-dom';
import { HospitalNavbar } from '../components';
import '../../../styles/hospital.css';
import '../../../styles/portal-polish.css';

export default function HospitalLayout() {
  return (
    <div className="hospital-dashboard-container">
      {/* 1. Hospital Operations Header & Navigation */}
      <HospitalNavbar />

      {/* 2. Main Nested Route Content */}
      <main className="hospital-content-area">
        <Outlet />
      </main>

      {/* 3. Hospital Footer */}
      <footer className="patient-portal-footer">
        <p className="patient-footer-line-1">
          Vaxora | Making Vaccination booking simple &amp; secure
        </p>
        <p className="patient-footer-line-2">
          @{new Date().getFullYear()} Vaxora. All rights reserved
        </p>
      </footer>
    </div>
  );
}
