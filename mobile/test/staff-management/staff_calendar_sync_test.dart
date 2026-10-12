import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/staff/data/models/shift_model.dart';
import 'package:mobile/features/staff/presentation/utils/staff_calendar_sync.dart';

ShiftModel _shift({
  String date = '2026-10-13',
  String start = '08:00:00',
  String end = '12:00:00',
  String? booth = 'Booth 2',
  String? notes,
}) {
  return ShiftModel(
    shiftId: 's1',
    affiliationId: 'a1',
    staffUserId: 'u1',
    staffName: 'Nurse',
    staffRole: 'Nurse',
    shiftDate: date,
    startTime: start,
    endTime: end,
    boothOrStation: booth,
    notes: notes,
  );
}

/// Rules behind the calendar events written for staff shifts.
void main() {
  group('Staff Management - StaffCalendarSync.shiftWindow', () {
    test('same-day shift keeps its date and times (normal)', () {
      final window = StaffCalendarSync.shiftWindow(_shift())!;
      expect(window.start, DateTime(2026, 10, 13, 8, 0));
      expect(window.end, DateTime(2026, 10, 13, 12, 0));
    });

    test('accepts times without seconds and dates with a time part', () {
      final window = StaffCalendarSync.shiftWindow(
        _shift(date: '2026-10-13T00:00:00', start: '9:30', end: '13:00'),
      )!;
      expect(window.start, DateTime(2026, 10, 13, 9, 30));
      expect(window.end, DateTime(2026, 10, 13, 13, 0));
    });

    test('overnight shift ends the next day (edge)', () {
      final window = StaffCalendarSync.shiftWindow(
        _shift(start: '22:00:00', end: '06:00:00'),
      )!;
      expect(window.start, DateTime(2026, 10, 13, 22, 0));
      expect(window.end, DateTime(2026, 10, 14, 6, 0));
    });

    test('unparseable date or time gives no window (invalid)', () {
      expect(StaffCalendarSync.shiftWindow(_shift(date: '')), isNull);
      expect(StaffCalendarSync.shiftWindow(_shift(start: 'soon')), isNull);
      expect(StaffCalendarSync.shiftWindow(_shift(end: '25:00')), isNull);
    });
  });

  group('Staff Management - StaffCalendarSync.signatureFor', () {
    test('same shift and hospital give the same signature', () {
      expect(
        StaffCalendarSync.signatureFor(_shift(), 'City Hospital'),
        StaffCalendarSync.signatureFor(_shift(), 'City Hospital'),
      );
    });

    test('a moved time, booth, note or hospital changes it', () {
      final base = StaffCalendarSync.signatureFor(_shift(), 'City Hospital');
      expect(
        StaffCalendarSync.signatureFor(_shift(start: '09:00:00'), 'City Hospital'),
        isNot(base),
      );
      expect(
        StaffCalendarSync.signatureFor(_shift(date: '2026-10-14'), 'City Hospital'),
        isNot(base),
      );
      expect(
        StaffCalendarSync.signatureFor(_shift(booth: 'Booth 5'), 'City Hospital'),
        isNot(base),
      );
      expect(
        StaffCalendarSync.signatureFor(_shift(notes: 'Bring ID'), 'City Hospital'),
        isNot(base),
      );
      expect(StaffCalendarSync.signatureFor(_shift(), 'Lake Hospital'), isNot(base));
    });
  });
}
