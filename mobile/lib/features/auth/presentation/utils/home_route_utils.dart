import 'package:flutter/material.dart';

import '../../../inventory/presentation/screens/hospital_main_screen.dart';
import '../../../patient/presentation/screens/patient_main_screen.dart';
import '../../../staff/presentation/screens/staff_main_screen.dart';
import '../screens/unsupported_role_screen.dart';

/// Resolves post-login home from an API role string.
Widget homeScreenForRole(String rawRole) {
  final role = rawRole.toUpperCase().trim();

  if (role == 'ADMIN') return const UnsupportedRoleScreen();
  if (role == 'HOSPITAL') return const HospitalMainScreen();

  if (role == 'DOCTOR' || role == 'NURSE') {
    return const StaffMainScreen();
  }

  return const PatientMainScreen();
}

String staffRoleLabel(String rawRole) {
  final role = rawRole.toUpperCase().trim();
  if (role.contains('DOCTOR')) return 'Doctor';
  if (role.contains('NURSE')) return 'Nurse';
  return rawRole.isEmpty ? 'Staff' : rawRole;
}
