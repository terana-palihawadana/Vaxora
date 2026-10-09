
import { Outlet } from 'react-router-dom';
import { DoctorNavbar } from '../components';
import '../../../styles/doctor.css';
import '../../../styles/portal-polish.css';

export default function DoctorLayout() {
  return (
    <div className="doctor-dashboard-container">
      {/* 1. Doctor Header & Navigation */}
      <DoctorNavbar />

      {/* 2. Main Nested Route Content */}
      <main className="doctor-content-area">
        <Outlet />
      </main>

      {/* 3. Footer */}
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
