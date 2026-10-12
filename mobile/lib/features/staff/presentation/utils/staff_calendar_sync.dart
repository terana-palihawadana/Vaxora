import 'dart:convert';
import 'dart:io' show Platform;

import 'package:device_calendar/device_calendar.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/timezone.dart' as tz;
import '../../../../core/services/storage_service.dart';
import '../../data/models/shift_model.dart';

enum CalendarSyncStatus { ok, denied, noCalendar }

class CalendarSyncResult {
  final CalendarSyncStatus status;
  final int added;
  final int updated;
  final int unchanged;
  final int failed;

  const CalendarSyncResult({
    this.status = CalendarSyncStatus.ok,
    this.added = 0,
    this.updated = 0,
    this.unchanged = 0,
    this.failed = 0,
  });
}

/// A shift that has a matching event in the device calendar.
class _SyncedShift {
  final String eventId;
  final String calendarId;
  final String date;
  final String signature;

  const _SyncedShift({
    required this.eventId,
    required this.calendarId,
    required this.date,
    required this.signature,
  });

  factory _SyncedShift.fromJson(Map<String, dynamic> json) => _SyncedShift(
        eventId: json['eventId']?.toString() ?? '',
        calendarId: json['calendarId']?.toString() ?? '',
        date: json['date']?.toString() ?? '',
        signature: json['signature']?.toString() ?? '',
      );

  Map<String, dynamic> toJson() => {
        'eventId': eventId,
        'calendarId': calendarId,
        'date': date,
        'signature': signature,
      };
}

/// Writes shifts straight into the device calendar and keeps those events in
/// step with the roster (moved shifts are updated, removed shifts are deleted).
class StaffCalendarSync {
  static const _prefsPrefix = 'staff_calendar_events_';
  static const _legacyPrefsKey = 'staff_calendar_synced_shift_ids';
  static const _hospitalZone = 'Asia/Colombo';
  static const _ownCalendarName = 'Vaxora shifts';

  static DeviceCalendarPlugin get _plugin => DeviceCalendarPlugin();

  // ---- Pure helpers ----

  static String _day(String shiftDate) {
    final t = shiftDate.trim();
    return t.length >= 10 ? t.substring(0, 10) : t;
  }

  static DateTime? _combine(String date, String time) {
    final d = DateTime.tryParse(_day(date));
    if (d == null) return null;
    final match = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(time.trim());
    if (match == null) return null;
    final h = int.parse(match.group(1)!);
    final m = int.parse(match.group(2)!);
    if (h > 23 || m > 59) return null;
    return DateTime(d.year, d.month, d.day, h, m);
  }

  /// Hospital wall-clock start and end of a shift. An end at or before the
  /// start means the shift runs past midnight. Null when the API values do
  /// not parse.
  static ({DateTime start, DateTime end})? shiftWindow(ShiftModel shift) {
    final start = _combine(shift.shiftDate, shift.startTime);
    var end = _combine(shift.shiftDate, shift.endTime);
    if (start == null || end == null) return null;
    if (!end.isAfter(start)) end = end.add(const Duration(days: 1));
    return (start: start, end: end);
  }

  static String _booth(ShiftModel shift) =>
      (shift.boothOrStation?.trim().isNotEmpty ?? false)
          ? shift.boothOrStation!.trim()
          : 'Unassigned booth';

  /// Everything the calendar event shows; a change here means the event is stale.
  static String signatureFor(ShiftModel shift, String hospitalName) => [
        _day(shift.shiftDate),
        shift.startTime.trim(),
        shift.endTime.trim(),
        _booth(shift),
        hospitalName,
        shift.notes?.trim() ?? '',
      ].join('|');

  // ---- Local record of synced shifts (per signed-in user) ----

  static Future<String> _prefsKey() async {
    final user = await StorageService.getUser();
    final id = user?['userId'] ?? user?['id'] ?? user?['email'] ?? 'anon';
    return '$_prefsPrefix$id';
  }

  static Future<Map<String, _SyncedShift>> _loadStore() async {
    final prefs = await SharedPreferences.getInstance();
    // Old builds ticked shifts as synced without knowing they were saved.
    if (prefs.containsKey(_legacyPrefsKey)) await prefs.remove(_legacyPrefsKey);
    final raw = prefs.getString(await _prefsKey());
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return {
        for (final e in decoded.entries)
          e.key: _SyncedShift.fromJson(e.value as Map<String, dynamic>),
      };
    } catch (_) {
      return {};
    }
  }

  static Future<void> _saveStore(Map<String, _SyncedShift> store) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      await _prefsKey(),
      jsonEncode({for (final e in store.entries) e.key: e.value.toJson()}),
    );
  }

  /// Shift ids that have an event in the device calendar.
  static Future<Set<String>> syncedIds() async =>
      (await _loadStore()).keys.toSet();

  // ---- Device calendar ----

  static Future<bool> _hasPermission() async =>
      (await _plugin.hasPermissions()).data ?? false;

  static Future<bool> _ensurePermission() async {
    if (await _hasPermission()) return true;
    if (Platform.isIOS) {
      // The plugin's own request call uses an API iOS 17 rejects; reading the
      // calendars goes through its full-access prompt instead.
      await _plugin.retrieveCalendars();
    } else {
      await _plugin.requestPermissions();
    }
    return _hasPermission();
  }

  static Future<String?> _targetCalendarId() async {
    final calendars = (await _plugin.retrieveCalendars()).data ?? const [];
    final writable = calendars
        .where((c) => c.isReadOnly != true && (c.id?.isNotEmpty ?? false))
        .toList();
    if (writable.isNotEmpty) {
      final preferred = writable.firstWhere(
        (c) => c.isDefault == true,
        orElse: () => writable.first,
      );
      return preferred.id;
    }
    final created = await _plugin.createCalendar(
      _ownCalendarName,
      calendarColor: const Color(0xFF0077B6),
      localAccountName: 'Vaxora',
    );
    return created.isSuccess ? created.data : null;
  }

  static Future<String?> _write({
    required ShiftModel shift,
    required String hospitalName,
    required String calendarId,
    String? eventId,
  }) async {
    final window = shiftWindow(shift);
    if (window == null) return null;
    final zone = tz.getLocation(_hospitalZone);
    tz.TZDateTime at(DateTime d) =>
        tz.TZDateTime(zone, d.year, d.month, d.day, d.hour, d.minute);

    final booth = _booth(shift);
    final notes = shift.notes?.trim() ?? '';
    final result = await _plugin.createOrUpdateEvent(
      Event(
        calendarId,
        eventId: eventId,
        title: 'Vaxora shift · $booth',
        description: 'Hospital: $hospitalName\nBooth: $booth'
            '${notes.isEmpty ? '' : '\n$notes'}\n\nManaged in Vaxora.',
        location: hospitalName,
        start: at(window.start),
        end: at(window.end),
        reminders: [Reminder(minutes: 60)],
      ),
    );
    return (result?.isSuccess ?? false) ? result!.data : null;
  }

  /// Drops records whose event the user deleted in their calendar app.
  static Future<bool> _pruneMissing(
    Map<String, _SyncedShift> store,
    Iterable<String> shiftIds,
  ) async {
    final byCalendar = <String, List<String>>{};
    for (final id in shiftIds) {
      final entry = store[id];
      if (entry != null) byCalendar.putIfAbsent(entry.calendarId, () => []).add(id);
    }

    var changed = false;
    for (final group in byCalendar.entries) {
      final days = group.value
          .map((id) => DateTime.tryParse(store[id]!.date))
          .whereType<DateTime>()
          .toList()
        ..sort();
      if (days.isEmpty) continue;
      final found = await _plugin.retrieveEvents(
        group.key,
        RetrieveEventsParams(
          eventIds: group.value.map((id) => store[id]!.eventId).toList(),
          startDate: days.first.subtract(const Duration(days: 2)),
          endDate: days.last.add(const Duration(days: 3)),
        ),
      );
      // A failed lookup says nothing about the events, so keep the records.
      if (!found.isSuccess) continue;
      final present = found.data!.map((e) => e.eventId).toSet();
      for (final id in group.value) {
        if (!present.contains(store[id]!.eventId)) {
          store.remove(id);
          changed = true;
        }
      }
    }
    return changed;
  }

  /// Adds [shifts] to the device calendar, asking for calendar access if needed.
  /// Shifts already there are updated in place, never duplicated.
  static Future<CalendarSyncResult> addShifts({
    required List<ShiftModel> shifts,
    required String Function(ShiftModel shift) hospitalNameFor,
  }) async {
    if (kIsWeb) {
      throw UnsupportedError('Calendar sync needs Android or iOS.');
    }
    if (shifts.isEmpty) return const CalendarSyncResult();
    if (!await _ensurePermission()) {
      return const CalendarSyncResult(status: CalendarSyncStatus.denied);
    }

    final store = await _loadStore();
    await _pruneMissing(store, shifts.map((s) => s.shiftId));

    String? newEventsCalendar;
    var added = 0, updated = 0, unchanged = 0, failed = 0;
    for (final shift in shifts) {
      if (shift.shiftId.isEmpty) {
        failed++;
        continue;
      }
      final hospital = hospitalNameFor(shift);
      final signature = signatureFor(shift, hospital);
      final existing = store[shift.shiftId];
      if (existing != null && existing.signature == signature) {
        unchanged++;
        continue;
      }

      final calendarId =
          existing?.calendarId ?? (newEventsCalendar ??= await _targetCalendarId());
      if (calendarId == null) {
        await _saveStore(store);
        return const CalendarSyncResult(status: CalendarSyncStatus.noCalendar);
      }

      final eventId = await _write(
        shift: shift,
        hospitalName: hospital,
        calendarId: calendarId,
        eventId: existing?.eventId,
      );
      if (eventId == null) {
        failed++;
        continue;
      }
      existing == null ? added++ : updated++;
      store[shift.shiftId] = _SyncedShift(
        eventId: eventId,
        calendarId: calendarId,
        date: _day(shift.shiftDate),
        signature: signature,
      );
    }

    await _saveStore(store);
    return CalendarSyncResult(
      added: added,
      updated: updated,
      unchanged: unchanged,
      failed: failed,
    );
  }

  /// Brings already-synced events in line with a freshly loaded roster for
  /// [from]..[to] (yyyy-MM-dd, inclusive): changed shifts are rewritten, shifts
  /// no longer on the roster lose their event. Never prompts for access.
  /// Only call with a roster that loaded successfully.
  /// Returns true when the set of synced shifts changed.
  static Future<bool> reconcile({
    required List<ShiftModel> shifts,
    required String from,
    required String to,
    required String Function(ShiftModel shift) hospitalNameFor,
  }) async {
    if (kIsWeb) return false;
    final store = await _loadStore();
    final byId = {for (final s in shifts) s.shiftId: s};
    final relevant = store.entries
        .where((e) =>
            byId.containsKey(e.key) ||
            (e.value.date.compareTo(from) >= 0 &&
                e.value.date.compareTo(to) <= 0))
        .map((e) => e.key)
        .toList();
    if (relevant.isEmpty || !await _hasPermission()) return false;

    var changed = await _pruneMissing(store, relevant);
    for (final id in relevant) {
      final entry = store[id];
      if (entry == null) continue;
      final shift = byId[id];
      if (shift == null) {
        await _plugin.deleteEvent(entry.calendarId, entry.eventId);
        store.remove(id);
        changed = true;
        continue;
      }
      final hospital = hospitalNameFor(shift);
      final signature = signatureFor(shift, hospital);
      if (entry.signature == signature) continue;
      final eventId = await _write(
        shift: shift,
        hospitalName: hospital,
        calendarId: entry.calendarId,
        eventId: entry.eventId,
      );
      if (eventId == null) continue;
      store[id] = _SyncedShift(
        eventId: eventId,
        calendarId: entry.calendarId,
        date: _day(shift.shiftDate),
        signature: signature,
      );
      changed = true;
    }

    if (changed) await _saveStore(store);
    return changed;
  }
}
