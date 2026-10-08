import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/presentation/screens/login_screen.dart';
import 'package:mobile/features/patient/presentation/screens/patient_appointments_screen.dart';
import 'package:mobile/features/patient/presentation/widgets/appointment_card.dart';
import 'package:mobile/features/patient/presentation/widgets/book_appointment_sheet.dart';
import 'test_helpers.dart';

void main() {
  setUp(() {
    mockUserAndToken();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  group('Booking Management - Additional Coverage Scenarios', () {
    // Scenario 1: Booking screen authentication/navigation protection
    testWidgets('1. Unauthenticated user is blocked by login flow and cannot access protected booking screen', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      clearMockAuth();

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/auth/login')) {
          return MockHttpResponse(
            statusCode: 401,
            body: jsonEncode({'message': 'Invalid credentials provided.'}),
          );
        }
        return MockHttpResponse(statusCode: 401, body: '{"message": "Unauthorized"}');
      });

      await tester.pumpWidget(createTestApp(const LoginScreen()));
      await tester.pumpAndSettle();

      // Attempt to log in with invalid/unauthenticated credentials
      final emailField = find.byType(TextFormField).at(0);
      final passwordField = find.byType(TextFormField).at(1);
      await tester.enterText(emailField, 'unauthorized@vaxora.lk');
      await tester.enterText(passwordField, 'wrongpassword');

      await tester.tap(find.widgetWithText(ElevatedButton, 'Sign In'));
      await tester.pumpAndSettle();

      // Verify the user remains on LoginScreen and is blocked from entering PatientMainScreen/AppointmentsScreen
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(PatientAppointmentsScreen), findsNothing);
      expect(find.text('Invalid credentials provided.'), findsOneWidget);

      // Verify directly mounted AppointmentsScreen without credentials masks identity and leaks no bookings
      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      // The unauthenticated request stays on the guest profile and shows the
      // authorization error instead of presenting the failure as an empty list.
      expect(find.text('Citizen'), findsOneWidget);
      expect(find.byType(AppointmentCard), findsNothing);
      expect(find.textContaining('Unable to load appointments: Unauthorized'), findsOneWidget);
      expect(find.text('No upcoming sessions. Book a slot with AI or the form.'), findsNothing);
    });

    // Scenario 2: Booking list server error
    testWidgets('2. Booking list API failure (HTTP 500) displays error state and dismisses loading indicator', (WidgetTester tester) async {
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path == '/api/appointments/my') {
          await Future.delayed(const Duration(milliseconds: 300));
          return MockHttpResponse(
            statusCode: 500,
            body: jsonEncode({'message': 'Internal database connection failed.'}),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));

      // Initial pump renders loading state while request is in-flight
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Wait for server error response to complete
      await tester.pumpAndSettle();

      // Verify loading indicator is removed
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // Verify the server failure is shown as an error rather than an empty list.
      expect(find.byIcon(Icons.cloud_off_outlined), findsOneWidget);
      expect(
        find.textContaining('Unable to load appointments: Internal database connection failed.'),
        findsOneWidget,
      );
      expect(find.text('No upcoming sessions. Book a slot with AI or the form.'), findsNothing);
      expect(find.byType(AppointmentCard), findsNothing);
    });

    // Scenario 3: No available booking slots
    testWidgets('3. Handles empty slot response by completing slot loading without error crash', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final mockSchedules = [
        {
          'id': 'sched-full-1',
          'hospitalUserId': 'hosp-user-full',
          'hospitalName': 'General Hospital Kandy',
          'vaccineName': 'Sinopharm BIBP',
          'price': 0.0,
          'formattedPrice': 'Free',
        }
      ];

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(statusCode: 200, body: jsonEncode(mockSchedules));
        }
        if (uri.path.contains('/inventory/vaccines')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'id': 'v2', 'name': 'Sinopharm BIBP'},
            ]),
          );
        }
        // Backend responds successfully but with an empty slot array
        if (uri.path.contains('/appointments/available-slots')) {
          return MockHttpResponse(statusCode: 200, body: '[]');
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(
        createTestApp(
          Scaffold(
            body: BookAppointmentSheet(onAppointmentBooked: (_) {}),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Verify the sheet rendered and slot loading completed without crash
      expect(find.byType(BookAppointmentSheet), findsOneWidget);
      expect(find.text('Book a slot'), findsOneWidget);

      // Ensure no active slot loading indicator is spinning
      final slotLoadingSpinner = find.descendant(
        of: find.widgetWithText(Row, '20-MINUTE SLOT'),
        matching: find.byType(CircularProgressIndicator),
      );
      expect(slotLoadingSpinner, findsNothing);
    });

    // Scenario 4: Expired/invalid authentication handling
    testWidgets('4. Expired authentication (HTTP 401) during booking displays session error banner', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final mockSchedules = [
        {
          'id': 'sched-1',
          'hospitalUserId': 'hosp-user-1',
          'hospitalName': 'National Hospital Colombo',
          'vaccineName': 'COVID-19 mRNA Booster',
          'price': 0.0,
          'formattedPrice': 'Free',
        }
      ];

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(statusCode: 200, body: jsonEncode(mockSchedules));
        }
        if (uri.path.contains('/inventory/vaccines')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'id': 'v1', 'name': 'COVID-19 mRNA Booster'},
            ]),
          );
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          // Token is expired or rejected by backend auth guard
          return MockHttpResponse(
            statusCode: 401,
            body: jsonEncode({'message': 'Session expired. Please log in again to continue.'}),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(
        createTestApp(
          Scaffold(
            body: BookAppointmentSheet(onAppointmentBooked: (_) {}),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Submit booking
      await tester.tap(find.widgetWithText(FilledButton, 'Confirm slot'));
      await tester.pumpAndSettle();

      // Error banner renders the session expiration message from server
      expect(
        find.text('Session expired. Please log in again to continue.'),
        findsOneWidget,
      );

      // Verify form remains mounted so user does not lose unsaved input
      expect(find.byType(BookAppointmentSheet), findsOneWidget);
    });

    // Scenario 5: Booking request payload verification
    testWidgets('5. Successful booking dispatches exact request payload with hospitalId, vaccine, date, and slot', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final mockSchedules = [
        {
          'id': 'sched-payload-99',
          'hospitalUserId': 'hosp-national-colombo-id',
          'hospitalName': 'National Hospital Colombo',
          'vaccineName': 'COVID-19 mRNA Booster',
          'price': 0.0,
          'formattedPrice': 'Free',
        }
      ];

      final mockSlots = [
        {'slot': '09:00 AM - 09:20 AM', 'availableCapacity': 15},
        {'slot': '09:20 AM - 09:40 AM', 'availableCapacity': 10},
      ];

      Map<String, dynamic>? capturedPayload;

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(statusCode: 200, body: jsonEncode(mockSchedules));
        }
        if (uri.path.contains('/inventory/vaccines')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'id': 'v1', 'name': 'COVID-19 mRNA Booster'},
            ]),
          );
        }
        if (uri.path.contains('/appointments/available-slots')) {
          return MockHttpResponse(statusCode: 200, body: jsonEncode(mockSlots));
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          if (body != null && body.isNotEmpty) {
            capturedPayload = jsonDecode(body) as Map<String, dynamic>;
          }
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode({
              'id': 'apt-payload-verified-1',
              'referenceNumber': 'VAX-2026-PAYLOAD',
              'vaccineName': 'COVID-19 mRNA Booster',
              'hospitalName': 'National Hospital Colombo',
              'appointmentDate': '2026-10-30',
              'timeSlot': '09:20 AM - 09:40 AM',
              'status': 'Confirmed',
              'fee': 0.0,
              'isPaid': true,
            }),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(
        createTestApp(
          Scaffold(
            body: BookAppointmentSheet(onAppointmentBooked: (_) {}),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Select the second slot chip
      await tester.tap(find.text('09:20 AM - 09:40 AM'));
      await tester.pumpAndSettle();

      // Enter optional notes
      final notesField = find.byType(TextField);
      expect(notesField, findsOneWidget);
      await tester.enterText(notesField, 'Allergic to penicillin - please record');
      await tester.pumpAndSettle();

      // Submit booking
      await tester.tap(find.widgetWithText(FilledButton, 'Confirm slot'));
      await tester.pumpAndSettle();

      // Verify captured payload matches selected data
      expect(capturedPayload, isNotNull);
      expect(capturedPayload!['hospitalUserId'], 'hosp-national-colombo-id');
      expect(capturedPayload!['vaccineName'], 'COVID-19 mRNA Booster');
      expect(capturedPayload!['timeSlot'], '09:20 AM - 09:40 AM');
      expect(capturedPayload!['notes'], 'Allergic to penicillin - please record');
      expect(capturedPayload!['doseNumber'], 'Dose 1');
      expect(capturedPayload!['appointmentDate'], isNotNull);
    });

    // Scenario 6: Booking API timeout/network failure
    testWidgets('6. Booking API network exception (SocketException) is caught safely and form remains usable', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final mockSchedules = [
        {
          'id': 'sched-1',
          'hospitalUserId': 'hosp-user-1',
          'hospitalName': 'National Hospital Colombo',
          'vaccineName': 'COVID-19 mRNA Booster',
          'price': 0.0,
          'formattedPrice': 'Free',
        }
      ];

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(statusCode: 200, body: jsonEncode(mockSchedules));
        }
        if (uri.path.contains('/inventory/vaccines')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'id': 'v1', 'name': 'COVID-19 mRNA Booster'},
            ]),
          );
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          // Simulate low-level network failure (offline, DNS lookup failed, socket reset)
          throw const SocketException('Failed host lookup: api.vaxora.lk');
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(
        createTestApp(
          Scaffold(
            body: BookAppointmentSheet(onAppointmentBooked: (_) {}),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Confirm booking slot
      final confirmBtn = find.widgetWithText(FilledButton, 'Confirm slot');
      await tester.tap(confirmBtn);
      await tester.pumpAndSettle();

      // App should not crash; StaffErrorBanner should display network error message
      expect(
        find.textContaining('Unable to connect to Vaxora server'),
        findsOneWidget,
      );

      // Verify the form remains open and CTA button is re-enabled for retry
      expect(find.byType(BookAppointmentSheet), findsOneWidget);
      final buttonWidget = tester.widget<FilledButton>(confirmBtn);
      expect(buttonWidget.onPressed, isNotNull);
    });
  });
}
