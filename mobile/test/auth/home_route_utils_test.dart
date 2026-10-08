import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/presentation/screens/unsupported_role_screen.dart';
import 'package:mobile/features/auth/presentation/utils/home_route_utils.dart';
import 'package:mobile/features/inventory/presentation/screens/hospital_main_screen.dart';
import 'package:mobile/features/patient/presentation/screens/patient_main_screen.dart';
import 'package:mobile/features/staff/presentation/screens/staff_main_screen.dart';

void main() {
  group('homeScreenForRole', () {
    test('routes administrators away from hospital workflows', () {
      expect(homeScreenForRole('ADMIN'), isA<UnsupportedRoleScreen>());
    });

    test('routes hospital users to the hospital home', () {
      expect(homeScreenForRole('HOSPITAL'), isA<HospitalMainScreen>());
    });

    test('routes clinical staff to the staff home', () {
      expect(homeScreenForRole('DOCTOR'), isA<StaffMainScreen>());
      expect(homeScreenForRole('NURSE'), isA<StaffMainScreen>());
    });

    test('routes patients to the patient home', () {
      expect(homeScreenForRole('PATIENT'), isA<PatientMainScreen>());
    });
  });
}
