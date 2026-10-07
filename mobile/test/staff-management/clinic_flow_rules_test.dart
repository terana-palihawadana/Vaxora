import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/hospital_staff/data/models/shift_swap_request_model.dart';
import 'package:mobile/features/staff/data/models/affiliation_model.dart';
import 'package:mobile/features/staff/data/models/staff_appointment_model.dart';
import 'package:mobile/features/staff/presentation/utils/staff_date_utils.dart';

/// Rules behind the staff app's clinic and cover flows:
/// shift-start cut-off, duty labels, check-in queue state and cover statuses.
void main() {
  // Fixed hospital clock: 7 Oct 2026, 10:00.
  final now = DateTime(2026, 10, 7, 10, 0);

  group('Staff Management - hasShiftStarted', () {
    test('shift later today has not started (normal)', () {
      expect(hasShiftStarted('2026-10-07', '13:00', now: now), isFalse);
    });

    test('shift starting exactly now counts as started (boundary)', () {
      expect(hasShiftStarted('2026-10-07', '10:00', now: now), isTrue);
    });

    test('one minute before start is still open for cover (boundary)', () {
      expect(hasShiftStarted('2026-10-07', '10:01', now: now), isFalse);
    });

    test('accepts API time format with seconds', () {
      expect(hasShiftStarted('2026-10-07', '09:30:00', now: now), isTrue);
    });

    test('yesterday has started and tomorrow has not (edge)', () {
      expect(hasShiftStarted('2026-10-06', '23:00', now: now), isTrue);
      expect(hasShiftStarted('2026-10-08', '00:00', now: now), isFalse);
    });

    test('reads the start from a cover window like "09:00–12:00"', () {
      expect(hasShiftStarted('2026-10-07', '09:00–12:00', now: now), isTrue);
    });

    test('missing or malformed values never block cover (invalid)', () {
      expect(hasShiftStarted('', '09:00', now: now), isFalse);
      expect(hasShiftStarted('2026-10-07', null, now: now), isFalse);
      expect(hasShiftStarted('2026-10-07', 'morning', now: now), isFalse);
    });
  });

  group('Staff Management - duty label', () {
    AffiliationModel affiliation({
      required String dutyStatus,
      required bool onDuty,
      bool clockedIn = false,
    }) {
      return AffiliationModel.fromJson({
        'affiliationId': 'a1',
        'hospitalUserId': 'h1',
        'hospitalName': 'NHSL',
        'staffUserId': 's1',
        'staffName': 'Nurse Amaya',
        'staffRole': 'NURSE',
        'status': 'Active',
        'dutyStatus': dutyStatus,
        'isOnDutyNow': onDuty,
        'isClockedIn': clockedIn,
      });
    }

    test('live rostered shift shows On shift', () {
      expect(affiliation(dutyStatus: 'Off', onDuty: true).dutyLabel, 'On shift');
    });

    test('walk-in clock-in shows Clocked in', () {
      expect(
        affiliation(dutyStatus: 'OnDuty', onDuty: true, clockedIn: true).dutyLabel,
        'Clocked in',
      );
    });

    test('break wins over a live shift', () {
      final onBreak = affiliation(dutyStatus: 'OnBreak', onDuty: false);
      expect(onBreak.isOnBreak, isTrue);
      expect(onBreak.dutyLabel, 'On break');
    });

    test('no shift and no clock-in shows Not on duty', () {
      expect(affiliation(dutyStatus: 'Off', onDuty: false).dutyLabel, 'Not on duty');
    });
  });

  group('Staff Management - clinic queue check-in', () {
    StaffAppointmentModel appointment({String status = 'Confirmed', String? checkedInAt}) {
      return StaffAppointmentModel.fromJson({
        'id': 'appt-1',
        'patientName': 'Kamal',
        'status': status,
        'paymentStatus': 'Paid',
        'checkedInAt': ?checkedInAt,
      });
    }

    test('booked patient who has not arrived shows Not arrived', () {
      final waiting = appointment();
      expect(waiting.isCheckedIn, isFalse);
      expect(waiting.statusLabel, 'Not arrived');
    });

    test('checked-in patient joins the queue', () {
      final arrived = appointment(checkedInAt: '2026-10-07T04:30:00Z');
      expect(arrived.isCheckedIn, isTrue);
      expect(arrived.statusLabel, 'In queue');
    });

    test('empty check-in timestamp is treated as not arrived (invalid)', () {
      expect(appointment(checkedInAt: '').isCheckedIn, isFalse);
    });

    test('patients in session keep their clinical label', () {
      expect(appointment(status: 'Administering').statusLabel, 'In session');
    });
  });

  group('Staff Management - cover request status', () {
    ShiftSwapRequestModel cover(Map<String, dynamic> extra) {
      return ShiftSwapRequestModel.fromJson({
        'id': 'req-1',
        'shiftId': 'shift-1',
        'requesterName': 'Dr. Silva',
        'shiftDate': '2026-10-09',
        'createdAt': '2026-10-07T04:30:00Z',
        ...extra,
      });
    }

    test('cancelled request is not pending or declined', () {
      final cancelled = cover({'status': 'Cancelled', 'decisionNote': 'Shift removed by hospital'});
      expect(cancelled.isCancelled, isTrue);
      expect(cancelled.isPending, isFalse);
      expect(cancelled.isDeclined, isFalse);
      expect(cancelled.decisionNote, 'Shift removed by hospital');
    });

    test('AI ranking flag is read only when explicitly true', () {
      expect(cover({'status': 'Pending', 'aiRanked': true}).aiRanked, isTrue);
      expect(cover({'status': 'Pending', 'aiRanked': 'yes'}).aiRanked, isFalse);
      expect(cover({'status': 'Pending'}).aiRanked, isFalse);
    });
  });
}
