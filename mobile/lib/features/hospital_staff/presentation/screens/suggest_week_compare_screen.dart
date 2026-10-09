import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../inventory/data/models/hospital_schedule_model.dart';
import '../../../staff/data/models/shift_model.dart';
import '../../../staff/presentation/utils/staff_date_utils.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';

/// Mutable AI shift proposal used by the scheduling agent + compare view.
class ShiftProposalItem {
  final Map<String, dynamic> raw;
  String? status; // approved | declined | null
  bool selected = true;

  ShiftProposalItem(this.raw);

  String get id =>
      '${raw['affiliationId']}|$date|${raw['startTime']}|${raw['endTime']}';

  String get date {
    final d = raw['shiftDate']?.toString() ?? '';
    return d.length >= 10 ? d.substring(0, 10) : d;
  }

  String get staffName => raw['staffName']?.toString() ?? 'Staff';
  String get staffRole => raw['staffRole']?.toString() ?? '';
  String get reason =>
      raw['reason']?.toString() ?? raw['notes']?.toString() ?? '';
  String get booth =>
      raw['boothOrStation']?.toString() ??
      raw['boothLabel']?.toString() ??
      '';

  String get vaccineName {
    final v = raw['vaccineName']?.toString() ??
        raw['vaccine']?.toString() ??
        raw['vaccineType']?.toString() ??
        '';
    return v.trim();
  }

  String get timeLabel {
    String hhmm(dynamic v) {
      final s = v?.toString() ?? '';
      return s.length >= 5 ? s.substring(0, 5) : s;
    }

    return '${hhmm(raw['startTime'])} – ${hhmm(raw['endTime'])}';
  }

  String get startHm {
    final s = raw['startTime']?.toString() ?? '';
    return s.length >= 5 ? s.substring(0, 5) : s;
  }

  String get endHm {
    final s = raw['endTime']?.toString() ?? '';
    return s.length >= 5 ? s.substring(0, 5) : s;
  }

  bool get isDoctor => staffRole.toUpperCase().contains('DOCTOR');
}

/// Side-by-side week compare: current roster vs AI suggestions (web SuggestWeek modal).
class SuggestWeekCompareScreen extends StatefulWidget {
  final String weekStart;
  final String weekEnd;
  final List<ShiftModel> existingShifts;
  final List<ShiftProposalItem> proposals;
  final List<HospitalScheduleModel> schedules;
  final Map<String, dynamic>? fairness;
  final Future<void> Function() onApproveSelected;
  final Future<void> Function(ShiftProposalItem) onDecline;
  final Future<void> Function()? onReroll;
  final bool busy;

  const SuggestWeekCompareScreen({
    super.key,
    required this.weekStart,
    required this.weekEnd,
    required this.existingShifts,
    required this.proposals,
    this.schedules = const [],
    this.fairness,
    required this.onApproveSelected,
    required this.onDecline,
    this.onReroll,
    this.busy = false,
  });

  @override
  State<SuggestWeekCompareScreen> createState() =>
      _SuggestWeekCompareScreenState();
}

class _SuggestWeekCompareScreenState extends State<SuggestWeekCompareScreen> {
  String _roleFilter = 'ALL'; // ALL | DOCTOR | NURSE
  late final PageController _pageController;
  int _pageIndex = 0;
  /// Local lock — parent `busy` is snapshotted at push and won't rebuild here.
  bool _approving = false;

  bool get _locked => widget.busy || _approving;

  static const _weekdays = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  @override
  void initState() {
    super.initState();
    final today = todayIsoDate();
    final start = _days.indexOf(today);
    _pageIndex = start >= 0 ? start : 0;
    _pageController = PageController(initialPage: _pageIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _onApprove() async {
    if (_locked || _selectedCount == 0) return;
    final ok = await confirmAction(
      context,
      title: 'Approve selected shifts?',
      message:
          'Create $_selectedCount shift${_selectedCount == 1 ? '' : 's'} on the hospital roster? '
          'This cannot be undone from here.',
      confirmLabel: 'Approve ($_selectedCount)',
    );
    if (!ok || !mounted) return;
    setState(() => _approving = true);
    final nav = Navigator.of(context);
    try {
      await widget.onApproveSelected();
      if (!mounted) return;
      setState(() {});
      final left =
          widget.proposals.where((p) => p.status == null).length;
      if (left == 0) {
        nav.pop(true);
        return;
      }
    } finally {
      if (mounted) setState(() => _approving = false);
    }
  }

  Future<void> _onDeclineProposal(ShiftProposalItem p) async {
    if (_locked) return;
    final ok = await confirmAction(
      context,
      title: 'Decline suggestion?',
      message:
          'Remove ${p.staffName} · ${p.timeLabel} from this plan? '
          'You can reroll later for new suggestions.',
      confirmLabel: 'Decline',
      destructive: true,
    );
    if (!ok || !mounted) return;
    await widget.onDecline(p);
    if (mounted) setState(() {});
  }

  void _goToPage(int index, int count) {
    if (count <= 0) return;
    final next = index.clamp(0, count - 1);
    _pageController.animateToPage(
      next,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  List<String> get _days {
    final start = DateTime.tryParse(widget.weekStart);
    final end = DateTime.tryParse(widget.weekEnd);
    if (start == null || end == null) return [widget.weekStart];
    final days = <String>[];
    var cursor = DateTime(start.year, start.month, start.day);
    final last = DateTime(end.year, end.month, end.day);
    while (!cursor.isAfter(last)) {
      days.add(formatDateOnly(cursor));
      cursor = cursor.add(const Duration(days: 1));
    }
    return days;
  }

  List<ShiftProposalItem> get _pending => widget.proposals
      .where((p) => p.status == null)
      .where((p) {
        if (_roleFilter == 'ALL') return true;
        final role = p.staffRole.toUpperCase();
        return _roleFilter == 'DOCTOR'
            ? role.contains('DOCTOR')
            : role.contains('NURSE');
      })
      .toList();

  int get _selectedCount => _pending.where((p) => p.selected).length;

  List<ShiftModel> _existingFor(String day) {
    return widget.existingShifts.where((s) {
      final d = s.shiftDate.length >= 10
          ? s.shiftDate.substring(0, 10)
          : s.shiftDate;
      return d == day;
    }).toList()
      ..sort((a, b) => a.startTime.compareTo(b.startTime));
  }

  List<ShiftProposalItem> _proposedFor(String day) {
    return _pending.where((p) => p.date == day).toList()
      ..sort((a, b) => a.timeLabel.compareTo(b.timeLabel));
  }

  String _hhmm(String raw) {
    final s = raw.trim();
    return s.length >= 5 ? s.substring(0, 5) : s;
  }

  bool _timesOverlap(String aStart, String aEnd, String bStart, String bEnd) {
    final as = _hhmm(aStart);
    final ae = _hhmm(aEnd);
    final bs = _hhmm(bStart);
    final be = _hhmm(bEnd);
    if (as.isEmpty || ae.isEmpty || bs.isEmpty || be.isEmpty) return false;
    return as.compareTo(be) < 0 && bs.compareTo(ae) < 0;
  }

  bool _boothMatch(String? a, String? b) {
    final x = (a ?? '').trim().toLowerCase();
    final y = (b ?? '').trim().toLowerCase();
    if (x.isEmpty || y.isEmpty) return false;
    return x == y || x.contains(y) || y.contains(x);
  }

  String _isoDay(String raw) =>
      raw.length >= 10 ? raw.substring(0, 10) : raw;

  /// Whether a posted vaccine session runs on [day] (yyyy-MM-dd).
  bool _scheduleRunsOn(HospitalScheduleModel schedule, String day) {
    if (schedule.isCancelled) return false;
    final type = schedule.scheduleType.toLowerCase();
    if (type != 'weekly') {
      return _isoDay(schedule.specificDate ?? '') == day;
    }
    final start = _isoDay(schedule.startDate ?? '');
    final end = _isoDay(schedule.endDate ?? '');
    if (start.isNotEmpty && day.compareTo(start) < 0) return false;
    if (end.isNotEmpty && day.compareTo(end) > 0) return false;
    final parsed = DateTime.tryParse(day);
    if (parsed == null) return false;
    final weekday = _weekdays[parsed.weekday - 1];
    return schedule.daysOfWeek.any((d) {
      final v = d.trim().toLowerCase();
      return v == weekday.toLowerCase() ||
          v == weekday.substring(0, 3).toLowerCase();
    });
  }

  int _shiftScheduleScore(ShiftModel s, HospitalScheduleModel sch) {
    var score = 0;
    if ((s.boothId ?? '').isNotEmpty && s.boothId == sch.boothId) score += 4;
    if (_boothMatch(s.boothOrStation, sch.boothLabel)) score += 3;
    if (_timesOverlap(s.startTime, s.endTime, sch.startTime, sch.endTime)) {
      score += 2;
    }
    return score;
  }

  int _proposalScheduleScore(ShiftProposalItem p, HospitalScheduleModel sch) {
    var score = 0;
    final boothId = p.raw['boothId']?.toString() ?? '';
    if (boothId.isNotEmpty && boothId == sch.boothId) score += 4;
    if (_boothMatch(p.booth, sch.boothLabel)) score += 3;
    if (p.vaccineName.isNotEmpty &&
        p.vaccineName.toLowerCase() == sch.vaccineName.toLowerCase()) {
      score += 3;
    }
    if (_timesOverlap(p.startHm, p.endHm, sch.startTime, sch.endTime)) {
      score += 2;
    }
    return score;
  }

  int? _bestIndex<T>(
    T item,
    List<HospitalScheduleModel> schedules,
    int Function(T, HospitalScheduleModel) scoreOf,
  ) {
    var best = -1;
    var bestScore = 0;
    for (var i = 0; i < schedules.length; i++) {
      final score = scoreOf(item, schedules[i]);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return bestScore > 0 ? best : null;
  }

  /// Schedules for [day], each with current + suggested staff nested under it.
  List<_DayScheduleBucket> _bucketsForDay(String day) {
    final schedules = widget.schedules
        .where((s) => _scheduleRunsOn(s, day))
        .toList()
      ..sort((a, b) {
        final t = _hhmm(a.startTime).compareTo(_hhmm(b.startTime));
        if (t != 0) return t;
        return a.vaccineName.compareTo(b.vaccineName);
      });

    final buckets = [
      for (final s in schedules) _DayScheduleBucket(schedule: s),
    ];
    final orphanCurrent = <ShiftModel>[];
    final orphanProposed = <ShiftProposalItem>[];

    for (final shift in _existingFor(day)) {
      final idx = _bestIndex(shift, schedules, _shiftScheduleScore);
      if (idx == null) {
        orphanCurrent.add(shift);
      } else {
        buckets[idx].current.add(shift);
      }
    }
    for (final p in _proposedFor(day)) {
      final idx = _bestIndex(p, schedules, _proposalScheduleScore);
      if (idx == null) {
        orphanProposed.add(p);
      } else {
        buckets[idx].proposed.add(p);
      }
    }

    if (orphanCurrent.isNotEmpty || orphanProposed.isNotEmpty) {
      buckets.add(
        _DayScheduleBucket(
          schedule: null,
          current: orphanCurrent,
          proposed: orphanProposed,
        ),
      );
    }
    return buckets;
  }

  @override
  Widget build(BuildContext context) {
    final before = (widget.fairness?['before'] is List)
        ? (widget.fairness!['before'] as List)
        : const [];
    final after = (widget.fairness?['after'] is List)
        ? (widget.fairness!['after'] as List)
        : const [];

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: AppBar(
        backgroundColor: StaffSurfaces.appBarBg,
        foregroundColor: StaffSurfaces.textPrimary,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Compare week',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
            ),
            Text(
              '${widget.weekStart} → ${widget.weekEnd}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: StaffSurfaces.textSecondary,
              ),
            ),
          ],
        ),
        actions: [
          if (widget.onReroll != null)
            TextButton(
              onPressed: _locked ? null : widget.onReroll,
              child: const Text('Reroll'),
            ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _legendDot(StaffSurfaces.textMutedSoft, 'Current'),
                    const SizedBox(width: 14),
                    _legendDot(StaffSurfaces.cta, 'Suggested'),
                    const Spacer(),
                    Text(
                      '${_pending.length} suggestion${_pending.length == 1 ? '' : 's'}',
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: StaffSurfaces.textSecondary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  children: [
                    _filterChip('All', 'ALL'),
                    _filterChip('Doctors', 'DOCTOR'),
                    _filterChip('Nurses', 'NURSE'),
                  ],
                ),
                if (before.isNotEmpty || after.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _FairnessCompare(before: before, after: after),
                ],
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: Builder(
              builder: (context) {
                final count = _days.length;
                if (count == 0) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: StaffEmptyCard(
                      message: 'Nothing to compare for this filter.',
                      icon: Icons.compare_arrows_outlined,
                    ),
                  );
                }
                final safeIndex = _pageIndex.clamp(0, count - 1);
                final day = _days[safeIndex];
                final buckets = _bucketsForDay(day);

                return Column(
                  children: [
                    _ComparePagerBar(
                      title: shiftDayHeading(day),
                      index: safeIndex,
                      count: count,
                      onPrev: safeIndex > 0
                          ? () => _goToPage(safeIndex - 1, count)
                          : null,
                      onNext: safeIndex < count - 1
                          ? () => _goToPage(safeIndex + 1, count)
                          : null,
                    ),
                    Expanded(
                      child: PageView.builder(
                        controller: _pageController,
                        itemCount: count,
                        onPageChanged: (i) =>
                            setState(() => _pageIndex = i),
                        itemBuilder: (context, i) {
                          final d = _days[i];
                          return _DaySchedulesPage(
                            key: ValueKey('day-$d'),
                            buckets: _bucketsForDay(d),
                            onToggle: _locked
                                ? (_) {}
                                : (p) => setState(
                                      () => p.selected = !p.selected,
                                    ),
                            onDecline: _onDeclineProposal,
                            busy: _locked,
                          );
                        },
                      ),
                    ),
                    if (buckets.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          '${buckets.where((b) => b.schedule != null).length} schedule'
                          '${buckets.where((b) => b.schedule != null).length == 1 ? '' : 's'} this day',
                          style: const TextStyle(
                            fontSize: 11.5,
                            color: StaffSurfaces.textMutedSoft,
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              decoration: const BoxDecoration(
                color: StaffSurfaces.cardBg,
                border: Border(
                  top: BorderSide(color: StaffSurfaces.divider),
                ),
              ),
              child: Row(
                children: [
                  TextButton(
                    onPressed: _locked || _pending.isEmpty
                        ? null
                        : () => setState(() {
                              for (final p in _pending) {
                                p.selected = true;
                              }
                            }),
                    child: const Text('Select all'),
                  ),
                  TextButton(
                    onPressed: _locked || _selectedCount == 0
                        ? null
                        : () => setState(() {
                              for (final p in _pending) {
                                p.selected = false;
                              }
                            }),
                    child: const Text('Clear'),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _locked || _selectedCount == 0
                        ? null
                        : _onApprove,
                    style: FilledButton.styleFrom(
                      backgroundColor: StaffSurfaces.cta,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                    ),
                    child: Text(
                      _approving
                          ? 'Saving…'
                          : 'Approve ($_selectedCount)',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: StaffSurfaces.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _filterChip(String label, String value) {
    final selected = _roleFilter == value;
    return FilterChip(
      label: Text(
        label,
        style: TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 12,
          color: selected ? Colors.white : StaffSurfaces.textPrimary,
        ),
      ),
      selected: selected,
      onSelected: (_) => setState(() => _roleFilter = value),
      selectedColor: StaffSurfaces.cta,
      backgroundColor: StaffSurfaces.softPanel,
      showCheckmark: false,
      side: BorderSide(
        color: selected ? StaffSurfaces.cta : StaffSurfaces.cardBorder,
      ),
    );
  }
}

class _FairnessCompare extends StatelessWidget {
  final List before;
  final List after;

  const _FairnessCompare({required this.before, required this.after});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFDBEAFE)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Workload fairness',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 13,
              color: Color(0xFF1D4ED8),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _col('Before', before)),
              const SizedBox(width: 12),
              Expanded(child: _col('After plan', after)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _col(String title, List rows) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 12,
            color: StaffSurfaces.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        if (rows.isEmpty)
          const Text(
            '—',
            style: TextStyle(fontSize: 12, color: StaffSurfaces.textMutedSoft),
          )
        else
          ...rows.take(6).map((row) {
            final m = row is Map ? Map<String, dynamic>.from(row) : <String, dynamic>{};
            final name = m['staffName']?.toString() ?? 'Staff';
            final count = m['shiftCount']?.toString() ?? '0';
            final load = m['load']?.toString();
            return Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                '$name · $count${load != null && load.isNotEmpty ? ' · $load' : ''}',
                style: const TextStyle(
                  fontSize: 11.5,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
            );
          }),
      ],
    );
  }
}

class _DayScheduleBucket {
  final HospitalScheduleModel? schedule;
  final List<ShiftModel> current;
  final List<ShiftProposalItem> proposed;

  _DayScheduleBucket({
    required this.schedule,
    List<ShiftModel>? current,
    List<ShiftProposalItem>? proposed,
  })  : current = current ?? [],
        proposed = proposed ?? [];
}

/// One day page: vaccine schedules stacked, staff under each schedule.
class _DaySchedulesPage extends StatelessWidget {
  final List<_DayScheduleBucket> buckets;
  final ValueChanged<ShiftProposalItem> onToggle;
  final Future<void> Function(ShiftProposalItem) onDecline;
  final bool busy;

  const _DaySchedulesPage({
    super.key,
    required this.buckets,
    required this.onToggle,
    required this.onDecline,
    required this.busy,
  });

  @override
  Widget build(BuildContext context) {
    if (buckets.isEmpty) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: StaffEmptyCard(
          message: 'No vaccine schedules or staff for this day.',
          icon: Icons.event_busy_outlined,
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      itemCount: buckets.length,
      itemBuilder: (context, i) {
        final bucket = buckets[i];
        return _ScheduleStaffCard(
          bucket: bucket,
          onToggle: onToggle,
          onDecline: onDecline,
          busy: busy,
        );
      },
    );
  }
}

class _ScheduleStaffCard extends StatelessWidget {
  final _DayScheduleBucket bucket;
  final ValueChanged<ShiftProposalItem> onToggle;
  final Future<void> Function(ShiftProposalItem) onDecline;
  final bool busy;

  const _ScheduleStaffCard({
    required this.bucket,
    required this.onToggle,
    required this.onDecline,
    required this.busy,
  });

  String _hhmm(String raw) {
    final s = raw.trim();
    return s.length >= 5 ? s.substring(0, 5) : s;
  }

  @override
  Widget build(BuildContext context) {
    final sch = bucket.schedule;
    final title = sch?.vaccineName ?? 'Other coverage';
    final booth = (sch?.boothLabel ?? '').trim();
    final meta = sch == null
        ? 'Shifts not matched to a posted session'
        : '${_hhmm(sch.startTime)}–${_hhmm(sch.endTime)}'
            '${booth.isNotEmpty ? ' · $booth' : ''}';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                sch == null
                    ? Icons.more_horiz
                    : Icons.vaccines_outlined,
                size: 18,
                color: StaffSurfaces.brandSoft,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ),
              if (bucket.proposed.isNotEmpty)
                StaffStatusChip(
                  label: '${bucket.proposed.length} new',
                  tone: StaffChipTone.brand,
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            meta,
            style: const TextStyle(
              fontSize: 12.5,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Column(
                  title: 'Current staff',
                  empty: 'No one rostered',
                  titleColor: StaffSurfaces.textSecondary,
                  children: bucket.current
                      .map(
                        (s) => _Pill(
                          title: s.staffName,
                          meta:
                              '${s.timeRangeLabel}${s.boothOrStation != null && s.boothOrStation!.isNotEmpty ? ' · ${s.boothOrStation}' : ''}',
                          accent: StaffSurfaces.textMutedSoft,
                          bg: StaffSurfaces.softPanel,
                        ),
                      )
                      .toList(),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _Column(
                  title: 'Suggested staff',
                  empty: 'No suggestions',
                  titleColor: StaffSurfaces.cta,
                  children: bucket.proposed
                      .map(
                        (p) => _ProposalPill(
                          proposal: p,
                          busy: busy,
                          onToggle: () => onToggle(p),
                          onDecline: () => onDecline(p),
                        ),
                      )
                      .toList(),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ComparePagerBar extends StatelessWidget {
  final String title;
  final int index;
  final int count;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;

  const _ComparePagerBar({
    required this.title,
    required this.index,
    required this.count,
    required this.onPrev,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Previous',
            onPressed: onPrev,
            icon: Icon(
              Icons.chevron_left,
              color: onPrev == null
                  ? StaffSurfaces.textMutedSoft
                  : StaffSurfaces.brandSoft,
            ),
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  title,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
                Text(
                  '${index + 1} of $count · swipe',
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Next',
            onPressed: onNext,
            icon: Icon(
              Icons.chevron_right,
              color: onNext == null
                  ? StaffSurfaces.textMutedSoft
                  : StaffSurfaces.brandSoft,
            ),
          ),
        ],
      ),
    );
  }
}

class _Column extends StatelessWidget {
  final String title;
  final String empty;
  final Color titleColor;
  final List<Widget> children;

  const _Column({
    required this.title,
    required this.empty,
    required this.titleColor,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title.toUpperCase(),
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.4,
            color: titleColor,
          ),
        ),
        const SizedBox(height: 6),
        if (children.isEmpty)
          Text(
            empty,
            style: const TextStyle(
              fontSize: 12,
              color: StaffSurfaces.textMutedSoft,
            ),
          )
        else
          ...children.map(
            (c) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: c,
            ),
          ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  final String title;
  final String meta;
  final Color accent;
  final Color bg;

  const _Pill({
    required this.title,
    required this.meta,
    required this.accent,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: StaffSurfaces.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
              color: accent,
            ),
          ),
          Text(
            meta,
            style: const TextStyle(
              fontSize: 11,
              color: StaffSurfaces.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProposalPill extends StatelessWidget {
  final ShiftProposalItem proposal;
  final bool busy;
  final VoidCallback onToggle;
  final VoidCallback onDecline;

  const _ProposalPill({
    required this.proposal,
    required this.busy,
    required this.onToggle,
    required this.onDecline,
  });

  @override
  Widget build(BuildContext context) {
    final selected = proposal.selected;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: busy ? null : onToggle,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: selected
                ? StaffSurfaces.cta.withValues(alpha: 0.08)
                : StaffSurfaces.cardBg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected
                  ? StaffSurfaces.cta.withValues(alpha: 0.55)
                  : StaffSurfaces.cardBorder,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    selected ? Icons.check_box : Icons.check_box_outline_blank,
                    size: 16,
                    color: selected
                        ? StaffSurfaces.cta
                        : StaffSurfaces.textMutedSoft,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      proposal.staffName,
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 12.5,
                        color: StaffSurfaces.cta,
                      ),
                    ),
                  ),
                ],
              ),
              Text(
                '${proposal.timeLabel}${proposal.booth.isNotEmpty ? ' · ${proposal.booth}' : ''}',
                style: const TextStyle(
                  fontSize: 11,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
              if (proposal.reason.isNotEmpty)
                Text(
                  proposal.reason,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: StaffSurfaces.textMutedSoft,
                  ),
                ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: busy ? null : onDecline,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.error,
                    padding: EdgeInsets.zero,
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                  ),
                  child: const Text(
                    'Decline',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
