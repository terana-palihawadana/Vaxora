import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/patient/presentation/screens/patient_appointments_screen.dart';
import 'package:mobile/features/patient/presentation/widgets/appointment_card.dart';

import 'test_helpers.dart';

void main() {
  setUp(() {
    mockUserAndToken();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  group('Booking Management - Screen Rendering & List Display', () {
    // Scenario 1: Booking screen renders correctly
    testWidgets('1. Booking screen renders header, stats, filters, and action buttons', (WidgetTester tester) async {
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      // Screen title and subtitle
      expect(find.text('VACCINATION BOOKINGS'), findsOneWidget);
      expect(find.text('Upcoming sessions'), findsOneWidget);
      expect(find.text('Confirmed and pending slots you can still manage.'), findsOneWidget);

      // Intro stats and filter chips
      expect(find.text('Upcoming'), findsNWidgets(2)); // Stat and filter chip
      expect(find.text('Past'), findsNWidgets(2)); // Stat and filter chip

      // Action buttons in header (Book with AI, Manual booking)
      expect(find.byIcon(Icons.auto_awesome), findsOneWidget);
      expect(find.byIcon(Icons.add), findsOneWidget);
    });

    // Scenario 2: Booking list displays existing bookings
    testWidgets('2. Booking list displays existing bookings with details and badges', (WidgetTester tester) async {
      final mockAppointmentsJson = [
        {
          'id': 'apt-uuid-12345',
          'referenceNumber': 'VAX-2026-9901',
          'vaccineName': 'COVID-19 mRNA Booster (Moderna / Pfizer)',
          'hospitalName': 'National Hospital Colombo',
          'appointmentDate': '2026-10-20',
          'timeSlot': '10:00 AM - 10:20 AM',
          'status': 'Confirmed',
          'fee': 0.0,
          'isPaid': true,
        },
        {
          'id': 'apt-uuid-67890',
          'referenceNumber': 'VAX-2026-9902',
          'vaccineName': 'Influenza (Quadrivalent Seasonal)',
          'hospitalName': 'Asiri Central Hospital',
          'appointmentDate': '2026-10-25',
          'timeSlot': '02:00 PM - 02:20 PM',
          'status': 'Pending',
          'fee': 1500.0,
          'isPaid': false,
        },
      ];

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/appointments/my')) {
          return MockHttpResponse(statusCode: 200, body: jsonEncode(mockAppointmentsJson));
        }
        return MockHttpResponse(statusCode: 200, body: '{}');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      // Verify Appointment Cards are rendered
      expect(find.byType(AppointmentCard), findsNWidgets(2));

      // Verify details of first appointment
      expect(find.text('COVID-19 mRNA Booster (Moderna / Pfizer)'), findsOneWidget);
      expect(find.text('National Hospital Colombo'), findsOneWidget);
      expect(find.textContaining('2026-10-20'), findsOneWidget);
      expect(find.textContaining('10:00 AM - 10:20 AM'), findsOneWidget);
      expect(find.text('Confirmed'), findsOneWidget);

      // Verify details of second appointment
      expect(find.text('Influenza (Quadrivalent Seasonal)'), findsOneWidget);
      expect(find.text('Asiri Central Hospital'), findsOneWidget);
      expect(find.textContaining('2026-10-25'), findsOneWidget);
      expect(find.textContaining('02:00 PM - 02:20 PM'), findsOneWidget);
    });

    // Scenario 3: Empty booking state is displayed correctly
    testWidgets('3. Empty booking state is displayed when there are no appointments', (WidgetTester tester) async {
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      // Empty state for Upcoming filter
      expect(find.text('No upcoming sessions. Book a slot with AI or the form.'), findsOneWidget);

      // Switch to Past filter chip
      await tester.tap(find.text('Past').last);
      await tester.pumpAndSettle();

      // Empty state for Past filter
      expect(find.text('No past appointments on record.'), findsOneWidget);
    });

    testWidgets('appointment load failures show an error and can be retried', (WidgetTester tester) async {
      var failFirstRequest = true;
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/appointments/my') && failFirstRequest) {
          failFirstRequest = false;
          return MockHttpResponse(
            statusCode: 503,
            body: jsonEncode({'message': 'Appointments are temporarily unavailable.'}),
          );
        }
        if (uri.path.contains('/appointments/my')) {
          return MockHttpResponse(statusCode: 200, body: '[]');
        }
        return MockHttpResponse(statusCode: 200, body: '{}');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Unable to load appointments: Appointments are temporarily unavailable.'),
        findsOneWidget,
      );
      expect(find.text('No upcoming sessions. Book a slot with AI or the form.'), findsNothing);

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(find.text('No upcoming sessions. Book a slot with AI or the form.'), findsOneWidget);
      expect(find.textContaining('Unable to load appointments:'), findsNothing);
    });

    // Scenario 8a: Loading state is displayed while fetching appointments
    testWidgets('8a. Displays CircularProgressIndicator while fetching appointments from backend', (
      WidgetTester tester,
    ) async {
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        // Delay response to inspect loading spinner
        await Future.delayed(const Duration(milliseconds: 500));
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      // Initial pump renders loading state
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Finish pending async timer
      await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });
}
