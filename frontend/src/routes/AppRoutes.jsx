
import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from '../features/landing';
import { AuthPage } from '../features/auth';
import ProtectedRoute from './ProtectedRoute';

import {
  PatientLayout,
  DashboardOverview,
  AppointmentsTab,
  VaccinationHistoryTab,
  FeedbackTab,
  PatientProfileTab,
} from '../features/patient';

import {
  HospitalLayout,
  HospitalDashboardOverview,
  HospitalInventoryTab,
  HospitalStaffTab,
  HospitalRosterTab,
  HospitalAppointmentsPage,
  HospitalSessionsPage,
  HospitalProfileTab,
  FeedbackTab as HospitalFeedbackTab,
} from '../features/hospital';

import {
  DoctorLayout,
  DoctorDashboardOverview,
  DoctorPatientsTab,
  DoctorProfileTab,
  DoctorAffiliationsTab,
  FeedbackTab as DoctorFeedbackTab,
} from '../features/doctor';

import {
  NurseLayout,
  NurseDashboardOverview,
  NursePatientsTab,
  NurseProfileTab,
  NurseAffiliationsTab,
  FeedbackTab as NurseFeedbackTab,
} from '../features/nurse';

import StaffAppointmentsTab from '../features/staff/components/StaffAppointmentsTab';

import {
  AdminLayout,
  AdminDashboardOverview,
  AdminUsersTab,
  AdminApprovalsTab,
  AdminFeedbackTab,
  AdminAuditLogsTab,
  AdminProfileTab,
} from '../features/admin';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/signup" element={<AuthPage />} />
      <Route path="/forgot-password" element={<AuthPage />} />
      <Route path="/reset-password" element={<AuthPage />} />

      {/* Protected Patient Portal Routes */}
      <Route
        path="/patient"
        element={
          <ProtectedRoute allowedRoles={['PATIENT', 'ADMIN']}>
            <PatientLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/patient/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardOverview />} />
        <Route path="appointments" element={<AppointmentsTab />} />
        <Route path="vaccination-history" element={<VaccinationHistoryTab />} />
        <Route path="history" element={<VaccinationHistoryTab />} />
        <Route path="feedback" element={<FeedbackTab />} />
        <Route path="profile" element={<PatientProfileTab />} />
      </Route>

      {/* Protected Hospital Portal Routes */}
      <Route
        path="/hospital"
        element={
          <ProtectedRoute allowedRoles={['HOSPITAL', 'ADMIN']}>
            <HospitalLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/hospital/dashboard" replace />} />
        <Route path="dashboard" element={<HospitalDashboardOverview />} />
        <Route path="appointments" element={<HospitalAppointmentsPage />} />
        <Route path="queue" element={<Navigate to="/hospital/appointments" replace />} />
        <Route path="roster" element={<HospitalRosterTab />} />
        <Route path="inventory" element={<HospitalInventoryTab />} />
        <Route path="sessions" element={<HospitalSessionsPage />} />
        <Route path="schedules" element={<Navigate to="/hospital/sessions" replace />} />
        <Route path="booths" element={<Navigate to="/hospital/sessions?view=booths" replace />} />
        <Route path="staff" element={<HospitalStaffTab />} />
        <Route path="feedback" element={<HospitalFeedbackTab />} />
        <Route path="profile" element={<HospitalProfileTab />} />
      </Route>

      {/* Protected Doctor Portal Routes */}
      <Route
        path="/doctor"
        element={
          <ProtectedRoute allowedRoles={['DOCTOR', 'ADMIN']}>
            <DoctorLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/doctor/dashboard" replace />} />
        <Route path="dashboard" element={<DoctorDashboardOverview />} />
        <Route path="appointments" element={<StaffAppointmentsTab />} />
        <Route path="patients" element={<DoctorPatientsTab />} />
        <Route path="patient-history" element={<Navigate to="/doctor/patients" replace />} />
        <Route path="history" element={<Navigate to="/doctor/patients" replace />} />
        <Route path="shifts" element={<DoctorAffiliationsTab view="shifts" />} />
        <Route path="hospitals" element={<DoctorAffiliationsTab view="hospitals" />} />
        <Route path="affiliations" element={<Navigate to="/doctor/hospitals" replace />} />
        <Route path="feedback" element={<DoctorFeedbackTab />} />
        <Route path="profile" element={<DoctorProfileTab />} />
      </Route>

      {/* Protected Nurse Portal Routes */}
      <Route
        path="/nurse"
        element={
          <ProtectedRoute allowedRoles={['NURSE', 'ADMIN']}>
            <NurseLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/nurse/dashboard" replace />} />
        <Route path="dashboard" element={<NurseDashboardOverview />} />
        <Route path="appointments" element={<StaffAppointmentsTab />} />
        <Route path="patients" element={<NursePatientsTab />} />
        <Route path="patient-history" element={<Navigate to="/nurse/patients" replace />} />
        <Route path="history" element={<Navigate to="/nurse/patients" replace />} />
        <Route path="shifts" element={<NurseAffiliationsTab view="shifts" />} />
        <Route path="hospitals" element={<NurseAffiliationsTab view="hospitals" />} />
        <Route path="affiliations" element={<Navigate to="/nurse/hospitals" replace />} />
        <Route path="feedback" element={<NurseFeedbackTab />} />
        <Route path="profile" element={<NurseProfileTab />} />
      </Route>

      {/* Protected Admin Portal Routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardOverview />} />
        <Route path="users" element={<AdminUsersTab />} />
        <Route path="approvals" element={<AdminApprovalsTab />} />
        <Route path="hospitals" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="campaigns" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="feedback" element={<AdminFeedbackTab />} />
        <Route path="audit" element={<AdminAuditLogsTab />} />
        <Route path="profile" element={<AdminProfileTab />} />
      </Route>

      {/* Catch-All Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
