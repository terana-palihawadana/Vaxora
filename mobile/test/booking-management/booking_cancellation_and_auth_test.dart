import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/features/patient/data/repositories/appointment_repository.dart';
import 'package:mobile/features/patient/presentation/screens/patient_appointments_screen.dart';

import 'test_helpers.dart';

void main() {
  setUp(() {
    mockUserAndToken();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  group('Booking Management - Cancellation & Authentication', () {
    // Scenario 9: Booking cancellation works correctly
    testWidgets('9. Booking cancellation displays confirmation dialog, calls cancel API, and updates UI', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      bool cancelApiCalled = false;
      bool isCancelled = false;
      final testAppointment = createTestAppointment(
        id: 'apt-to-cancel-101',
        vaccineName: 'COVID-19 mRNA Booster',
        hospitalName: 'National Hospital Colombo',
        status: 'Pending',
      );

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path == '/api/appointments/apt-to-cancel-101/cancel' && method == 'DELETE') {
          cancelApiCalled = true;
          isCancelled = true;
          return MockHttpResponse(statusCode: 200, body: jsonEncode({'success': true}));
        }
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {
                'id': 'apt-to-cancel-101',
                'referenceNumber': 'VAX-2026-CANCEL',
                'vaccineName': 'COVID-19 mRNA Booster',
                'hospitalName': 'National Hospital Colombo',
                'appointmentDate': '2026-10-30',
                'timeSlot': '10:00 AM - 10:20 AM',
                'status': isCancelled ? 'Cancelled' : 'Pending',
                'fee': 0.0,
                'isPaid': true,
              },
            ]),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(PatientAppointmentsScreen(initialAppointments: [testAppointment])));
      await tester.pumpAndSettle();

      // Find the cancel IconButton on the appointment card
      final cancelBtn = find.byTooltip('Cancel appointment');
      expect(cancelBtn, findsOneWidget);

      // Tap cancel button
      await tester.tap(cancelBtn);
      await tester.pumpAndSettle();

      // Verify confirmation dialog appears
      expect(find.text('Cancel appointment?'), findsOneWidget);
      expect(find.text('Cancel your COVID-19 mRNA Booster session at National Hospital Colombo?'), findsOneWidget);
      expect(find.text('Keep'), findsOneWidget);
      expect(find.text('Cancel session'), findsOneWidget);

      // Confirm cancellation
      await tester.tap(find.text('Cancel session'));
      await tester.pumpAndSettle();

      // Verify API was called
      expect(cancelApiCalled, isTrue);

      // Verify SnackBar notification
      expect(find.text('Appointment cancelled.'), findsOneWidget);

      // Switch to 'Past' filter tab where cancelled and past appointments reside
      await tester.tap(find.text('Past').last);
      await tester.pumpAndSettle();

      // Verify the card in Past history indicates cancelled status
      expect(find.text('Appointment cancelled'), findsOneWidget);
    });

    // Scenario 10: Cancellation API failure is handled correctly
    testWidgets('10. Cancellation API failure displays error SnackBar and preserves appointment', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final testAppointment = createTestAppointment(
        id: 'apt-fail-cancel-202',
        vaccineName: 'Pfizer BioNTech',
        hospitalName: 'Teaching Hospital Karapitiya',
        status: 'Confirmed',
      );

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/cancel') && method == 'DELETE') {
          return MockHttpResponse(
            statusCode: 400,
            body: jsonEncode({'message': 'Appointments cannot be cancelled within 2 hours of scheduled time.'}),
          );
        }
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {
                'id': 'apt-fail-cancel-202',
                'vaccineName': 'Pfizer BioNTech',
                'hospitalName': 'Teaching Hospital Karapitiya',
                'appointmentDate': '2026-10-30',
                'timeSlot': '10:00 AM - 10:20 AM',
                'status': 'Confirmed',
                'fee': 0.0,
                'isPaid': true,
              },
            ]),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(PatientAppointmentsScreen(initialAppointments: [testAppointment])));
      await tester.pumpAndSettle();

      // Tap cancel button
      await tester.tap(find.byTooltip('Cancel appointment'));
      await tester.pumpAndSettle();

      // Confirm cancel in dialog
      await tester.tap(find.text('Cancel session'));
      await tester.pumpAndSettle();

      // Verify error SnackBar is displayed
      expect(
        find.textContaining('Failed to cancel: Appointments cannot be cancelled within 2 hours of scheduled time.'),
        findsOneWidget,
      );

      // Verify appointment is still active / confirmed, not cancelled
      expect(find.text('Confirmed'), findsWidgets);
      expect(find.text('Appointment cancelled'), findsNothing);
    });

    // Scenario 11: Unauthorized users cannot access protected booking functionality
    testWidgets('11. Unauthorized appointment requests surface the 401 error', (WidgetTester tester) async {
      // Clear token and authentication from storage
      clearMockAuth();

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        return MockHttpResponse(
          statusCode: 401,
          body: jsonEncode({'message': 'Authorization header is missing or expired.'}),
        );
      });

      // Appointment fetches must not turn authorization failures into empty results.
      await expectLater(
        AppointmentRepository.getMyAppointments(),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401)),
      );

      // Attempting to book appointment without credentials throws ApiException with 401
      await expectLater(
        AppointmentRepository.bookAppointment(
          hospitalUserId: 'hosp-1',
          vaccineName: 'COVID-19 mRNA',
          appointmentDate: '2026-10-30',
          timeSlot: '10:00 AM - 10:20 AM',
        ),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401)),
      );

      // Attempting to cancel appointment without credentials throws ApiException with 401
      await expectLater(
        AppointmentRepository.cancelAppointment('apt-999'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401)),
      );

      // Render appointments screen with empty storage
      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      // Since user is unauthenticated, the failure is distinct from an empty list.
      expect(find.textContaining('Unable to load appointments:'), findsOneWidget);
      expect(find.text('No upcoming sessions. Book a slot with AI or the form.'), findsNothing);
    });
  });
}
