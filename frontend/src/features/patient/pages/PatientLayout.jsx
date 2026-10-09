
import { Outlet } from 'react-router-dom';
import { PatientNavbar } from '../components';
import '../../../styles/portal-polish.css';

export default function PatientLayout() {
  return (
    <div className="patient-dashboard-container">
      {/* 1. Patient Portal Header & Navigation */}
      <PatientNavbar />

      {/* 2. Main Nested Route Content */}
      <main className="patient-main-content">
        <Outlet />
      </main>

      {/* 3. Patient Portal Footer matching spec */}
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
