import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/patient/presentation/screens/patient_appointments_screen.dart';
import 'package:mobile/features/patient/presentation/widgets/appointment_card.dart';
import 'package:mobile/features/patient/presentation/widgets/book_appointment_sheet.dart';

import 'test_helpers.dart';

/// Dates are relative to today so these tests never expire.
String _isoDate(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String _daysFromToday(int days) => _isoDate(DateTime.now().add(Duration(days: days)));

void _useTallView(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Map<String, dynamic> _schedule({
  required String hospitalUserId,
  required String hospitalName,
  required String vaccineName,
  double price = 0.0,
}) {
  return {
    'id': 'sched-$hospitalUserId',
    'hospitalUserId': hospitalUserId,
    'hospitalName': hospitalName,
    'vaccineName': vaccineName,
    'price': price,
    'formattedPrice': price > 0 ? 'LKR ${price.toStringAsFixed(0)}' : 'Free',
  };
}

Map<String, dynamic> _appointmentJson({
  required String id,
  required String hospitalName,
  String vaccineName = 'COVID-19 mRNA Booster',
  required String date,
  String status = 'Confirmed',
  double fee = 0.0,
  bool isPaid = true,
}) {
  return {
    'id': id,
    'referenceNumber': 'REF-$id',
    'vaccineName': vaccineName,
    'hospitalName': hospitalName,
    'appointmentDate': date,
    'timeSlot': '10:00 AM - 10:20 AM',
    'status': status,
    'fee': fee,
    'isPaid': isPaid,
  };
}

void main() {
  setUp(() {
    mockUserAndToken();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  group('Booking Management - Upcoming / Past classification', () {
    test('future-dated active bookings are upcoming', () {
      for (final status in ['Confirmed', 'Pending', 'PendingPayment', 'Administering']) {
        expect(
          isUpcomingPatientAppointment(createTestAppointment(date: _daysFromToday(5), status: status)),
          isTrue,
          reason: status,
        );
      }
    });

    test('a booking scheduled for today is still upcoming', () {
      expect(
        isUpcomingPatientAppointment(createTestAppointment(date: _daysFromToday(0), status: 'Confirmed')),
        isTrue,
      );
    });

    test('a past-dated Confirmed booking is past', () {
      expect(
        isUpcomingPatientAppointment(createTestAppointment(date: _daysFromToday(-1), status: 'Confirmed')),
        isFalse,
      );
    });

    test('Completed, Cancelled and Rejected are always past, even when future-dated', () {
      for (final status in ['Completed', 'Cancelled', 'Rejected', ' cancelled ']) {
        expect(
          isUpcomingPatientAppointment(createTestAppointment(date: _daysFromToday(10), status: status)),
          isFalse,
          reason: status,
        );
      }
    });

    test('a booking with an unreadable date stays upcoming', () {
      for (final date in ['', 'TBD', '30/10/2026']) {
        expect(
          isUpcomingPatientAppointment(createTestAppointment(date: date, status: 'Pending')),
          isTrue,
          reason: date,
        );
      }
    });

    testWidgets('the screen sorts bookings into the Upcoming and Past tabs', (WidgetTester tester) async {
      _useTallView(tester);

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _appointmentJson(id: 'a1', hospitalName: 'Upcoming Hospital', date: _daysFromToday(4)),
              _appointmentJson(id: 'a2', hospitalName: 'Yesterday Hospital', date: _daysFromToday(-1)),
              _appointmentJson(
                id: 'a3',
                hospitalName: 'Completed Hospital',
                date: _daysFromToday(3),
                status: 'Completed',
              ),
            ]),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      expect(find.text('Upcoming Hospital'), findsOneWidget);
      expect(find.text('Yesterday Hospital'), findsNothing);
      expect(find.text('Completed Hospital'), findsNothing);

      await tester.tap(find.text('Past').last);
      await tester.pumpAndSettle();

      expect(find.text('Past sessions'), findsOneWidget);
      expect(find.text('Upcoming Hospital'), findsNothing);
      expect(find.text('Yesterday Hospital'), findsOneWidget);
      expect(find.text('Completed Hospital'), findsOneWidget);
    });
  });

  group('Booking Management - Booking from the appointments screen', () {
    testWidgets('free booking via the + button adds a card and shows the confirmation message', (
      WidgetTester tester,
    ) async {
      _useTallView(tester);
      final bookedDate = _daysFromToday(6);
      var postCount = 0;

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(statusCode: 200, body: '[]');
        }
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _schedule(
                hospitalUserId: 'hosp-colombo',
                hospitalName: 'National Hospital Colombo',
                vaccineName: 'COVID-19 mRNA Booster',
              ),
            ]),
          );
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
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'slot': '10:00 AM - 10:20 AM'},
            ]),
          );
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          postCount++;
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode(
              _appointmentJson(
                id: 'apt-new-1',
                hospitalName: 'National Hospital Colombo',
                date: bookedDate,
              ),
            ),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(AppointmentCard), findsNothing);

      await tester.tap(find.byTooltip('Manual booking'));
      await tester.pumpAndSettle();
      expect(find.byType(BookAppointmentSheet), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Confirm slot'));
      await tester.pumpAndSettle();

      expect(postCount, 1);
      expect(find.byType(BookAppointmentSheet), findsNothing);
      expect(find.text('Appointment confirmed for COVID-19 mRNA Booster!'), findsOneWidget);

      expect(find.byType(AppointmentCard), findsOneWidget);
      expect(find.text('National Hospital Colombo'), findsOneWidget);
      expect(find.textContaining(bookedDate), findsOneWidget);
    });

    testWidgets('paid booking sends PayHere, shows the LKR fee, and offers Pay Now', (WidgetTester tester) async {
      _useTallView(tester);
      Map<String, dynamic>? capturedPayload;

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(statusCode: 200, body: '[]');
        }
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _schedule(
                hospitalUserId: 'hosp-asiri',
                hospitalName: 'Asiri Central Hospital',
                vaccineName: 'Influenza (Quadrivalent Seasonal)',
                price: 1500,
              ),
            ]),
          );
        }
        if (uri.path.contains('/inventory/vaccines')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'id': 'v1', 'name': 'Influenza (Quadrivalent Seasonal)'},
            ]),
          );
        }
        if (uri.path.contains('/appointments/available-slots')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'slot': '02:00 PM - 02:20 PM'},
            ]),
          );
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          capturedPayload = jsonDecode(body as String) as Map<String, dynamic>;
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode(
              _appointmentJson(
                id: 'apt-paid-1',
                hospitalName: 'Asiri Central Hospital',
                vaccineName: 'Influenza (Quadrivalent Seasonal)',
                date: _daysFromToday(8),
                status: 'PendingPayment',
                fee: 1500,
                isPaid: false,
              ),
            ),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Manual booking'));
      await tester.pumpAndSettle();

      // The fee summary shows the priced amount instead of the free label.
      expect(find.text('LKR 1500.00'), findsOneWidget);
      expect(find.text('Free (gov. immunization)'), findsNothing);

      await tester.tap(find.widgetWithText(FilledButton, 'Confirm slot'));
      await tester.pumpAndSettle();

      expect(capturedPayload, isNotNull);
      expect(capturedPayload!['paymentMethod'], 'PayHere');
      expect(capturedPayload!['hospitalUserId'], 'hosp-asiri');

      expect(find.text('Reserved! Pay LKR 1500 via PayHere.'), findsOneWidget);
      expect(find.widgetWithText(SnackBarAction, 'Pay Now'), findsOneWidget);
      expect(find.textContaining('Appointment confirmed for'), findsNothing);

      // The new unpaid card offers payment too.
      expect(find.widgetWithText(FilledButton, 'Pay LKR 1500'), findsOneWidget);
    });

    testWidgets('free booking sends paymentMethod Free and shows the free fee label', (WidgetTester tester) async {
      _useTallView(tester);
      Map<String, dynamic>? capturedPayload;

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _schedule(hospitalUserId: 'hosp-1', hospitalName: 'Base Hospital', vaccineName: 'AstraZeneca'),
            ]),
          );
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          capturedPayload = jsonDecode(body as String) as Map<String, dynamic>;
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode(
              _appointmentJson(id: 'apt-free', hospitalName: 'Base Hospital', date: _daysFromToday(3)),
            ),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(
        createTestApp(Scaffold(body: BookAppointmentSheet(onAppointmentBooked: (_) {}))),
      );
      await tester.pumpAndSettle();

      expect(find.text('Free (gov. immunization)'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Confirm slot'));
      await tester.pumpAndSettle();

      expect(capturedPayload!['paymentMethod'], 'Free');
    });
  });

  group('Booking Management - Pay Now and Cancel button visibility', () {
    testWidgets('Pay Now shows only for unpaid bookings with a fee that are not confirmed, completed or cancelled', (
      WidgetTester tester,
    ) async {
      _useTallView(tester);
      final future = _daysFromToday(5);

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _appointmentJson(
                id: 'unpaid',
                hospitalName: 'Unpaid Hospital',
                date: future,
                status: 'PendingPayment',
                fee: 2500,
                isPaid: false,
              ),
              _appointmentJson(
                id: 'paid',
                hospitalName: 'Paid Hospital',
                date: future,
                status: 'Pending',
                fee: 2500,
                isPaid: true,
              ),
              _appointmentJson(
                id: 'confirmed',
                hospitalName: 'Confirmed Hospital',
                date: future,
                status: 'Confirmed',
                fee: 2500,
                isPaid: false,
              ),
              _appointmentJson(
                id: 'free',
                hospitalName: 'Free Hospital',
                date: future,
                status: 'Pending',
                fee: 0,
                isPaid: false,
              ),
              _appointmentJson(
                id: 'cancelled',
                hospitalName: 'Cancelled Hospital',
                date: future,
                status: 'Cancelled',
                fee: 2500,
                isPaid: false,
              ),
              _appointmentJson(
                id: 'completed',
                hospitalName: 'Completed Hospital',
                date: _daysFromToday(-3),
                status: 'Completed',
                fee: 2500,
                isPaid: false,
              ),
            ]),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      Finder payButtonIn(String hospital) => find.descendant(
            of: find.widgetWithText(AppointmentCard, hospital),
            matching: find.widgetWithText(FilledButton, 'Pay LKR 2500'),
          );

      expect(payButtonIn('Unpaid Hospital'), findsOneWidget);
      expect(payButtonIn('Paid Hospital'), findsNothing);
      expect(payButtonIn('Confirmed Hospital'), findsNothing);
      expect(find.descendant(
        of: find.widgetWithText(AppointmentCard, 'Free Hospital'),
        matching: find.textContaining('Pay LKR'),
      ), findsNothing);
      expect(find.textContaining('Pay LKR'), findsOneWidget);

      await tester.tap(find.text('Past').last);
      await tester.pumpAndSettle();

      expect(find.text('Cancelled Hospital'), findsOneWidget);
      expect(find.text('Completed Hospital'), findsOneWidget);
      expect(find.textContaining('Pay LKR'), findsNothing);
    });

    testWidgets('cancel button is hidden for Completed, Administering, Observation, Cancelled and Rejected', (
      WidgetTester tester,
    ) async {
      _useTallView(tester);

      for (final status in ['Completed', 'Administering', 'Observation', 'Cancelled', 'Rejected']) {
        await tester.pumpWidget(
          createTestApp(
            Scaffold(
              body: AppointmentCard(
                appointment: createTestAppointment(date: _daysFromToday(4), status: status),
                onViewSlip: () {},
                onCancel: () {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byTooltip('Cancel appointment'), findsNothing, reason: status);
      }
    });

    testWidgets('cancel button is shown for Confirmed, Pending and PendingPayment', (WidgetTester tester) async {
      _useTallView(tester);

      for (final status in ['Confirmed', 'Pending', 'PendingPayment']) {
        await tester.pumpWidget(
          createTestApp(
            Scaffold(
              body: AppointmentCard(
                appointment: createTestAppointment(date: _daysFromToday(4), status: status),
                onViewSlip: () {},
                onCancel: () {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byTooltip('Cancel appointment'), findsOneWidget, reason: status);
      }
    });
  });

  group('Booking Management - Cancel dialog', () {
    testWidgets('tapping Keep closes the dialog without calling the cancel API', (WidgetTester tester) async {
      _useTallView(tester);
      var cancelCalls = 0;
      final future = _daysFromToday(7);

      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.endsWith('/cancel')) {
          cancelCalls++;
          return MockHttpResponse(statusCode: 200, body: jsonEncode({'success': true}));
        }
        if (uri.path == '/api/appointments/my') {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _appointmentJson(
                id: 'apt-keep-1',
                hospitalName: 'National Hospital Colombo',
                date: future,
                status: 'Confirmed',
              ),
            ]),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(createTestApp(const PatientAppointmentsScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Cancel appointment'));
      await tester.pumpAndSettle();
      expect(find.text('Cancel appointment?'), findsOneWidget);

      await tester.tap(find.text('Keep'));
      await tester.pumpAndSettle();

      expect(find.text('Cancel appointment?'), findsNothing);
      expect(cancelCalls, 0);
      expect(find.text('Appointment cancelled.'), findsNothing);
      expect(find.text('Appointment cancelled'), findsNothing);
      expect(find.text('Confirmed'), findsOneWidget);
      expect(find.byTooltip('Cancel appointment'), findsOneWidget);
    });
  });

  group('Booking Management - Slot reloading', () {
    late List<Uri> slotRequests;
    late List<Map<String, dynamic>> postedPayloads;

    void mockTwoHospitals() {
      slotRequests = [];
      postedPayloads = [];
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _schedule(hospitalUserId: 'hosp-a', hospitalName: 'Hospital A', vaccineName: 'Vaccine A'),
              _schedule(hospitalUserId: 'hosp-b', hospitalName: 'Hospital B', vaccineName: 'Vaccine B'),
            ]),
          );
        }
        if (uri.path.contains('/inventory/vaccines')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'id': 'va', 'name': 'Vaccine A'},
              {'id': 'vb', 'name': 'Vaccine B'},
            ]),
          );
        }
        if (uri.path.contains('/appointments/available-slots')) {
          slotRequests.add(uri);
          final hospital = uri.queryParameters['hospitalUserId'];
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              {'slot': hospital == 'hosp-b' ? '02:00 PM - 02:20 PM' : '09:00 AM - 09:20 AM'},
            ]),
          );
        }
        if (uri.path == '/api/appointments' && method == 'POST') {
          postedPayloads.add(jsonDecode(body as String) as Map<String, dynamic>);
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode(_appointmentJson(id: 'apt-x', hospitalName: 'Hospital B', date: _daysFromToday(2))),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });
    }

    Future<void> pumpSheet(WidgetTester tester) async {
      await tester.pumpWidget(
        createTestApp(Scaffold(body: BookAppointmentSheet(onAppointmentBooked: (_) {}))),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('initial slot request uses the first hospital, vaccine and default date', (WidgetTester tester) async {
      _useTallView(tester);
      mockTwoHospitals();
      await pumpSheet(tester);

      expect(slotRequests, hasLength(1));
      expect(slotRequests.last.queryParameters['hospitalUserId'], 'hosp-a');
      expect(slotRequests.last.queryParameters['vaccineName'], 'Vaccine A');
      expect(slotRequests.last.queryParameters['date'], _daysFromToday(2));
    });

    testWidgets('changing hospital reloads slots for that hospital and switches the vaccine to match', (
      WidgetTester tester,
    ) async {
      _useTallView(tester);
      mockTwoHospitals();
      await pumpSheet(tester);

      await tester.tap(find.text('Hospital A · Vaccine A (Free)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hospital B · Vaccine B (Free)').last);
      await tester.pumpAndSettle();

      expect(slotRequests.last.queryParameters['hospitalUserId'], 'hosp-b');
      expect(slotRequests.last.queryParameters['vaccineName'], 'Vaccine B');
      expect(find.widgetWithText(ChoiceChip, '02:00 PM - 02:20 PM'), findsOneWidget);
      expect(find.widgetWithText(ChoiceChip, '09:00 AM - 09:20 AM'), findsNothing);

      // The vaccine field must visibly follow the hospital, not only the request.
      expect(find.widgetWithText(DropdownButtonFormField<String>, 'Vaccine B'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Confirm slot'));
      await tester.pumpAndSettle();

      expect(postedPayloads.single['hospitalUserId'], 'hosp-b');
      expect(postedPayloads.single['vaccineName'], 'Vaccine B');
      expect(postedPayloads.single['timeSlot'], '02:00 PM - 02:20 PM');
    });

    testWidgets('changing vaccine reloads slots for that vaccine', (WidgetTester tester) async {
      _useTallView(tester);
      mockTwoHospitals();
      await pumpSheet(tester);

      await tester.tap(find.widgetWithText(DropdownButtonFormField<String>, 'Vaccine A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Vaccine B').last);
      await tester.pumpAndSettle();

      expect(slotRequests, hasLength(2));
      expect(slotRequests.last.queryParameters['hospitalUserId'], 'hosp-a');
      expect(slotRequests.last.queryParameters['vaccineName'], 'Vaccine B');
    });

    testWidgets('changing date reloads slots for the picked date', (WidgetTester tester) async {
      _useTallView(tester);
      mockTwoHospitals();
      await pumpSheet(tester);

      final picked = DateTime.now().add(const Duration(days: 10));
      final pickedText =
          '${picked.month.toString().padLeft(2, '0')}/${picked.day.toString().padLeft(2, '0')}/${picked.year}';

      await tester.tap(find.byIcon(Icons.calendar_today_outlined));
      await tester.pumpAndSettle();

      // Switch the picker to text input so the test does not depend on the calendar layout.
      await tester.tap(find.byIcon(Icons.edit_outlined));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, pickedText);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(find.text(_isoDate(picked)), findsOneWidget);
      expect(slotRequests, hasLength(2));
      expect(slotRequests.last.queryParameters['date'], _isoDate(picked));
      expect(slotRequests.last.queryParameters['hospitalUserId'], 'hosp-a');
    });
  });

  group('Booking Management - Slot loading failures', () {
    Future<void> runSlotFailure(
      WidgetTester tester,
      Future<MockHttpResponse> Function() slotResponse,
    ) async {
      _useTallView(tester);
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/schedule/available')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode([
              _schedule(hospitalUserId: 'hosp-1', hospitalName: 'Base Hospital', vaccineName: 'AstraZeneca'),
            ]),
          );
        }
        if (uri.path.contains('/appointments/available-slots')) {
          return slotResponse();
        }
        return MockHttpResponse(statusCode: 200, body: '[]');
      });

      await tester.pumpWidget(
        createTestApp(Scaffold(body: BookAppointmentSheet(onAppointmentBooked: (_) {}))),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byType(BookAppointmentSheet), findsOneWidget);
      expect(find.text('Base Hospital · AstraZeneca (Free)'), findsOneWidget);

      final slotSpinner = find.descendant(
        of: find.widgetWithText(Row, '20-MINUTE SLOT'),
        matching: find.byType(CircularProgressIndicator),
      );
      expect(slotSpinner, findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);

      final confirm = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm slot'));
      expect(confirm.onPressed, isNotNull);
    }

    testWidgets('HTTP 500 from the slot endpoint stops loading and keeps the form usable', (
      WidgetTester tester,
    ) async {
      await runSlotFailure(
        tester,
        () async => MockHttpResponse(statusCode: 500, body: jsonEncode({'message': 'Slot service down.'})),
      );
    });

    testWidgets('network error from the slot endpoint stops loading and keeps the form usable', (
      WidgetTester tester,
    ) async {
      await runSlotFailure(
        tester,
        () async => throw const SocketException('Failed host lookup: api.vaxora.lk'),
      );
    });
  });
}
