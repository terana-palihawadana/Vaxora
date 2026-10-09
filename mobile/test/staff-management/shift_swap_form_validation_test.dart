import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/staff/data/models/shift_model.dart';
import 'package:mobile/features/staff/presentation/widgets/shift_swap_sheet.dart';

import 'test_helpers.dart';

void main() {
  const shift = ShiftModel(
    shiftId: 'shift-1',
    affiliationId: 'aff-1',
    staffUserId: 'doctor-user-1',
    staffName: 'Dr Kasun Silva',
    staffRole: 'DOCTOR',
    shiftDate: '2026-11-20',
    startTime: '09:00:00',
    endTime: '13:00:00',
    boothOrStation: 'Booth A',
  );

  setUp(() {
    mockUserAndToken(
      id: 'doctor-user-1',
      name: 'Dr Kasun Silva',
      role: 'DOCTOR',
      registrationNumber: 'VAX-D-9001',
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  Future<void> pumpSheet(WidgetTester tester) async {
    await tester.pumpWidget(
      createTestApp(
        const Scaffold(
          body: ShiftSwapSheet(
            shift: shift,
            hospitalName: 'Royal Hospitals',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('Staff Management - Cover request form validation', () {
    testWidgets('1. Short-notice cover requires a reason before submit is enabled',
        (tester) async {
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/staff/shift-swaps/quota')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode({
              'usedThisMonth': 0,
              'monthlyLimit': 3,
              'urgentUsedThisMonth': 0,
              'urgentLimit': 1,
              'minNoticeDays': 2,
              'daysUntilShift': 1,
              'isUrgent': true,
              'reasonRequired': true,
              'alreadyPending': false,
              'canRequest': true,
              'summary': 'Short notice — reason required',
            }),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '{}');
      });

      await pumpSheet(tester);

      expect(find.text('Request cover'), findsOneWidget);
      expect(find.textContaining('Required — why this is short notice'), findsOneWidget);

      final disabledButton = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Send short-notice request'),
      );
      expect(disabledButton.onPressed, isNull);

      await tester.enterText(find.byType(TextField), 'Clinic conflict tomorrow morning');
      await tester.pumpAndSettle();

      final enabledButton = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Send short-notice request'),
      );
      expect(enabledButton.onPressed, isNotNull);
    });

    testWidgets('2. Valid cover request posts shiftId + reason', (tester) async {
      String? postedBody;
      HttpOverrides.global = TestMockHttpOverrides((method, uri, body) async {
        if (uri.path.contains('/staff/shift-swaps/quota')) {
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode({
              'usedThisMonth': 0,
              'monthlyLimit': 3,
              'urgentUsedThisMonth': 0,
              'urgentLimit': 1,
              'minNoticeDays': 2,
              'daysUntilShift': 1,
              'isUrgent': true,
              'reasonRequired': true,
              'alreadyPending': false,
              'canRequest': true,
              'summary': 'Short notice — reason required',
            }),
          );
        }
        if (method == 'POST' && uri.path.endsWith('/staff/shift-swaps')) {
          postedBody = body?.toString();
          return MockHttpResponse(
            statusCode: 200,
            body: jsonEncode({
              'requestId': 'swap-1',
              'shiftId': 'shift-1',
              'status': 'Pending',
            }),
          );
        }
        return MockHttpResponse(statusCode: 200, body: '{}');
      });

      await pumpSheet(tester);

      await tester.enterText(find.byType(TextField), 'Family emergency');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send short-notice request'));
      await tester.pumpAndSettle();

      // Confirm dialog before the API post.
      expect(find.text('Request cover?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Send request'));
      await tester.pumpAndSettle();

      expect(postedBody, isNotNull);
      expect(postedBody, contains('shift-1'));
      expect(postedBody, contains('Family emergency'));
      expect(find.text('Done'), findsOneWidget);
    });
  });
}
