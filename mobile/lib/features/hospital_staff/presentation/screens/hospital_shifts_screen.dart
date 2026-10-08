import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/utils/home_route_utils.dart';
import '../../../staff/data/models/shift_model.dart';
import '../../../staff/presentation/utils/staff_date_utils.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/repositories/hospital_staff_repository.dart';

/// Hospital-side view: every staff shift at this hospital for the selected week.
class HospitalShiftsScreen extends StatefulWidget {
  const HospitalShiftsScreen({super.key});

  @override
  State<HospitalShiftsScreen> createState() => _HospitalShiftsScreenState();
}

class _HospitalShiftsScreenState extends State<HospitalShiftsScreen> {
  List<ShiftModel> _shifts = [];
  bool _loading = true;
  String? _error;
  late String _from;
  late String _to;
  int _weekOffset = 0;

  String _hospitalName = 'Hospital';
  String? _hospitalLogoUrl;

  @override
  void initState() {
    super.initState();
    _applyRange();
    _bootstrap();
  }

  void _applyRange() {
    final range = weekRangeOffset(_weekOffset, days: 7);
    _from = range.from;
    _to = range.to;
  }

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    if (mounted && user != null) {
      setState(() {
        _hospitalName = user['name']?.toString().trim().isNotEmpty == true
            ? user['name'].toString().trim()
            : 'Hospital';
        _hospitalLogoUrl = resolveMediaUrl(
          user['profilePhotoUrl']?.toString() ??
              user['profilePhoto']?.toString() ??
              user['logoUrl']?.toString(),
        );
      });
    }
    await _load();
  }

  Future<void> _shiftWeek(int delta) async {
    setState(() {
      _weekOffset += delta;
      _applyRange();
    });
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await HospitalStaffRepository.getShifts(
        from: _from,
        to: _to,
      );
      if (!mounted) return;
      setState(() {
        _shifts = list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Failed to load shifts.';
        _shifts = [];
      });
    }
  }

  Map<String, List<ShiftModel>> get _grouped {
    final map = <String, List<ShiftModel>>{};
    for (final s in _shifts) {
      final key = s.shiftDate.isEmpty ? 'Unknown' : s.shiftDate;
      map.putIfAbsent(key, () => []).add(s);
    }
    return map;
  }

  int get _doctorShifts => _shifts
      .where((s) => s.staffRole.toUpperCase().contains('DOCTOR'))
      .length;
  int get _nurseShifts =>
      _shifts.where((s) => s.staffRole.toUpperCase().contains('NURSE')).length;

  String get _weekLabel {
    if (_weekOffset == 0) return 'This week';
    if (_weekOffset == -1) return 'Last week';
    if (_weekOffset == 1) return 'Next week';
    return _weekOffset < 0
        ? '${-_weekOffset} weeks ago'
        : 'In $_weekOffset weeks';
  }

  @override
  Widget build(BuildContext context) {
    final grouped = _grouped;
    final dayKeys = grouped.keys.toList()
      ..sort((a, b) {
        final da = DateTime.tryParse(a);
        final db = DateTime.tryParse(b);
        if (da != null && db != null) return da.compareTo(db);
        return a.compareTo(b);
      });

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Shifts',
        photoUrl: _hospitalLogoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Clinic schedule',
              title: _weekLabel,
              subtitle: '$_from → $_to',
              stats: [
                StaffIntroStat(
                  label: 'Shifts',
                  value: '${_shifts.length}',
                  icon: Icons.event_note_outlined,
                ),
                StaffIntroStat(
                  label: 'Doctor',
                  value: '$_doctorShifts',
                  icon: Icons.medical_services_outlined,
                ),
                StaffIntroStat(
                  label: 'Nurse',
                  value: '$_nurseShifts',
                  icon: Icons.health_and_safety_outlined,
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (_error != null) ...[
              StaffErrorBanner(
                message: _error!,
                onDismiss: () => setState(() => _error = null),
              ),
              const SizedBox(height: 12),
            ],
            _WeekPicker(
              label: _weekLabel,
              from: _from,
              to: _to,
              onPrev: _loading ? null : () => _shiftWeek(-1),
              onNext: _loading ? null : () => _shiftWeek(1),
            ),
            const SizedBox(height: 18),
            if (_loading && _shifts.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(
                      color: StaffSurfaces.brandSoft),
                ),
              )
            else if (dayKeys.isEmpty)
              const StaffEmptyCard(
                message: 'No shifts scheduled for this week.',
                icon: Icons.calendar_month_outlined,
              )
            else ...[
              StaffSectionHeader(
                title: 'Shifts',
                count: _shifts.length,
              ),
              ...dayKeys.expand((day) {
                final items = grouped[day]!;
                return [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8, top: 6),
                    child: Text(
                      shiftDayHeading(day),
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.02,
                        color: StaffSurfaces.textSecondary,
                      ),
                    ),
                  ),
                  ...items.map(
                    (shift) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _HospitalShiftCard(shift: shift),
                    ),
                  ),
                ];
              }),
            ],
          ],
        ),
      ),
    );
  }
}

class _WeekPicker extends StatelessWidget {
  final String label;
  final String from;
  final String to;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;

  const _WeekPicker({
    required this.label,
    required this.from,
    required this.to,
    required this.onPrev,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      decoration: StaffSurfaces.softWell(),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Previous week',
            onPressed: onPrev,
            icon: Icon(Icons.chevron_left, color: StaffSurfaces.brandSoft),
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
                Text(
                  '$from → $to',
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Next week',
            onPressed: onNext,
            icon: Icon(Icons.chevron_right, color: StaffSurfaces.brandSoft),
          ),
        ],
      ),
    );
  }
}

class _HospitalShiftCard extends StatelessWidget {
  final ShiftModel shift;

  const _HospitalShiftCard({required this.shift});

  String get _initials {
    final parts = shift.staffName
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      final w = parts.first;
      return w.substring(0, w.length >= 2 ? 2 : 1).toUpperCase();
    }
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final booth = (shift.boothOrStation?.trim().isNotEmpty ?? false)
        ? shift.boothOrStation!
        : 'Unassigned booth';
    final cover = shift.coverStatus?.toLowerCase();
    final role = staffRoleLabel(shift.staffRole);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: switch (cover) {
          'requested' => AppColors.warningBorder,
          'declined' => AppColors.error.withValues(alpha: 0.28),
          'covering' => AppColors.success.withValues(alpha: 0.28),
          _ => StaffSurfaces.cardBorder,
        },
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: StaffSurfaces.cardBorder),
            ),
            clipBehavior: Clip.antiAlias,
            child: NetworkAvatar(
              url: shift.staffPhotoUrl,
              size: 44,
              fallback: Container(
                color: StaffSurfaces.softPanelDeep,
                alignment: Alignment.center,
                child: Text(
                  _initials,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        shift.staffName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ),
                    StaffStatusChip(
                      label: role,
                      tone: StaffChipTone.brand,
                    ),
                  ],
                ),
                Builder(
                  builder: (_) {
                    final chip = ShiftCoverStatusChip.maybe(
                      status: shift.coverStatus,
                    );
                    if (chip == null) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: chip,
                      ),
                    );
                  },
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(
                      Icons.schedule,
                      size: 13,
                      color: StaffSurfaces.textMutedSoft,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      shift.timeRangeLabel,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: StaffSurfaces.brandSoft,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  booth,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
                if (shift.isCovering &&
                    (shift.coverForName?.trim().isNotEmpty ?? false)) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Covering for ${shift.coverForName!.trim()}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: StaffSurfaces.brandSoft,
                    ),
                  ),
                ],
                if (shift.notes != null &&
                    shift.notes!.trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    shift.notes!,
                    style: const TextStyle(
                      fontSize: 12,
                      color: StaffSurfaces.textMutedSoft,
                      height: 1.35,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
