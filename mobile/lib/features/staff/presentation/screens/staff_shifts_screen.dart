import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/utils/home_route_utils.dart';
import '../../data/models/affiliation_model.dart';
import '../../data/models/shift_model.dart';
import '../../data/repositories/shift_swap_repository.dart';
import '../../data/repositories/staff_repository.dart';
import '../../../hospital_staff/data/models/shift_swap_request_model.dart';
import '../utils/staff_calendar_sync.dart';
import '../utils/staff_date_utils.dart';
import '../widgets/network_avatar.dart';
import '../widgets/shift_swap_sheet.dart';
import '../widgets/staff_common_widgets.dart';
import '../widgets/staff_cover_sheet.dart';

class StaffShiftsScreen extends StatefulWidget {
  const StaffShiftsScreen({super.key});

  @override
  State<StaffShiftsScreen> createState() => _StaffShiftsScreenState();
}

class _StaffShiftsScreenState extends State<StaffShiftsScreen> {
  List<ShiftModel> _shifts = [];
  List<ShiftSwapRequestModel> _covers = [];
  Set<String> _seenIncoming = {};
  Map<String, AffiliationModel> _affiliationsById = {};
  Set<String> _syncedIds = {};
  Set<String> _selectedIds = {};
  bool _selectMode = false;
  bool _loading = true;
  bool _syncing = false;
  String? _error;
  late String _from;
  late String _to;
  String _displayName = 'there';
  String _roleLabel = 'Staff';
  String? _photoUrl;
  int _weekOffset = 0;

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
        _displayName = user['name']?.toString().trim().isNotEmpty == true
            ? user['name'].toString().trim()
            : 'there';
        _roleLabel = staffRoleLabel(user['role']?.toString() ?? '');
        _photoUrl = resolveMediaUrl(
          user['profilePhotoUrl']?.toString() ??
              user['profilePhoto']?.toString() ??
              user['photoUrl']?.toString(),
        );
      });
    }
    await Future.wait([_loadSynced(), _load()]);
  }

  Future<void> _loadSynced() async {
    final ids = await StaffCalendarSync.syncedIds();
    if (!mounted) return;
    setState(() => _syncedIds = ids);
  }

  Future<void> _shiftWeek(int delta) async {
    setState(() {
      _weekOffset += delta;
      _applyRange();
      _selectedIds = {};
      _selectMode = false;
    });
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final results = await Future.wait([
        StaffRepository.getMyShifts(from: _from, to: _to),
        StaffRepository.getMyAffiliations(),
        ShiftSwapRepository.listMine(),
        ShiftSwapRepository.seenIncomingIds(),
      ]);

      if (!mounted) return;

      final shifts = results[0] as List<ShiftModel>;
      final affiliations = results[1] as List<AffiliationModel>;
      final covers = results[2] as List<ShiftSwapRequestModel>;
      final seen = results[3] as Set<String>;
      final byId = <String, AffiliationModel>{
        for (final a in affiliations) a.affiliationId: a,
      };

      setState(() {
        _shifts = shifts;
        _covers = covers;
        _seenIncoming = seen;
        _affiliationsById = byId;
        _loading = false;
        _selectedIds.removeWhere(
          (id) => shifts.every((s) => s.shiftId != id),
        );
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Failed to load shifts.';
        _shifts = [];
        _covers = [];
        _seenIncoming = {};
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

  String get _primaryHospital {
    if (_affiliationsById.isEmpty) return 'No active hospital yet';
    return _affiliationsById.values.first.hospitalName;
  }

  String _hospitalFor(ShiftModel shift) {
    return _affiliationsById[shift.affiliationId]?.hospitalName ??
        'Hospital roster';
  }

  int get _syncedCount =>
      _shifts.where((s) => _syncedIds.contains(s.shiftId)).length;

  int get _coverBadgeCount {
    return _covers
        .where((r) =>
            r.isIncoming &&
            r.isUpcoming &&
            !_seenIncoming.contains(r.id))
        .length;
  }

  Future<void> _openCoverSheet() async {
    await StaffCoverSheet.show(context);
    if (mounted) await _load();
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _addMany(List<ShiftModel> shifts) async {
    if (kIsWeb) {
      _toast('Calendar sync works on Android / iOS devices.');
      return;
    }
    if (shifts.isEmpty || _syncing) return;
    setState(() => _syncing = true);
    try {
      final added = await StaffCalendarSync.addShifts(
        shifts: shifts,
        hospitalNameFor: _hospitalFor,
      );
      await _loadSynced();
      if (!mounted) return;
      setState(() {
        _selectMode = false;
        _selectedIds = {};
      });
      _toast(added == 0 ? 'Nothing added.' : 'Added $added shifts.');
    } catch (e) {
      _toast('Calendar error: $e');
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  Future<void> _addAllVisible() async {
    final confirm = await showDialog<bool>(
      context: context,
      barrierColor: StaffSurfaces.textPrimary.withValues(alpha: 0.35),
      builder: (ctx) => Dialog(
        backgroundColor: StaffSurfaces.appBarBg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: StaffSurfaces.cardBorder),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Add week to calendar?',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '${_shifts.length} shifts · $_from → $_to',
                style: const TextStyle(
                  color: StaffSurfaces.textSecondary,
                  height: 1.4,
                  fontSize: 13.5,
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text(
                        'Cancel',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      style: FilledButton.styleFrom(
                        backgroundColor: StaffSurfaces.cta,
                        elevation: 0,
                      ),
                      child: const Text(
                        'Add all',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (confirm == true) await _addMany(_shifts);
  }

  Future<void> _addSelected() async {
    final selected =
        _shifts.where((s) => _selectedIds.contains(s.shiftId)).toList();
    if (selected.isEmpty) {
      _toast('Select at least one shift.');
      return;
    }
    await _addMany(selected);
  }

  void _toggleSelectMode() {
    setState(() {
      _selectMode = !_selectMode;
      if (!_selectMode) _selectedIds = {};
    });
  }

  void _toggleSelected(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  String get _weekLabel {
    if (_weekOffset == 0) return 'This week';
    if (_weekOffset == -1) return 'Last week';
    if (_weekOffset == 1) return 'Next week';
    return _weekOffset < 0 ? '${-_weekOffset} weeks ago' : 'In $_weekOffset weeks';
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
        displayName: _displayName,
        subtitle: '$_roleLabel · My Shifts',
        photoUrl: _photoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.swap_horiz,
            tooltip: 'Cover',
            badgeCount: _coverBadgeCount,
            onPressed: _loading || _syncing ? null : _openCoverSheet,
          ),
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _loading || _syncing ? null : _load,
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
              eyebrow: 'Clinical roster',
              title: _weekLabel,
              subtitle: '$_from → $_to · $_primaryHospital',
              stats: [
                StaffIntroStat(
                  label: 'Shifts',
                  value: '${_shifts.length}',
                  icon: Icons.event_note_outlined,
                  accent: StaffSurfaces.brandSoft,
                ),
                StaffIntroStat(
                  label: 'In calendar',
                  value: '$_syncedCount',
                  icon: Icons.event_available_outlined,
                  accent: AppColors.info,
                ),
                StaffIntroStat(
                  label: 'Hospitals',
                  value: '${_affiliationsById.length}',
                  icon: Icons.local_hospital_outlined,
                  accent: AppColors.accentTeal,
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
              onPrev: _loading || _syncing ? null : () => _shiftWeek(-1),
              onNext: _loading || _syncing ? null : () => _shiftWeek(1),
            ),
            if (_shifts.isNotEmpty && _selectMode) ...[
              const SizedBox(height: 12),
              _SelectionBar(
                selectedCount: _selectedIds.length,
                total: _shifts.length,
                syncing: _syncing,
                onSelectAll: _syncing
                    ? null
                    : () => setState(
                          () => _selectedIds =
                              _shifts.map((s) => s.shiftId).toSet(),
                        ),
                onClear:
                    _syncing ? null : () => setState(() => _selectedIds = {}),
                onCancel: _syncing ? null : _toggleSelectMode,
                onAdd:
                    _syncing || _selectedIds.isEmpty ? null : _addSelected,
              ),
            ],
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
                message: 'No shifts assigned in this week.',
                icon: Icons.calendar_month_outlined,
              )
            else ...[
              StaffSectionHeader(
                title: 'Shifts',
                count: _shifts.length,
                trailing: _selectMode
                    ? null
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _SectionIconButton(
                            icon: Icons.checklist_rtl,
                            tooltip: 'Select shifts',
                            onPressed: _loading || _syncing
                                ? null
                                : _toggleSelectMode,
                          ),
                          const SizedBox(width: 6),
                          _SectionIconButton(
                            icon: Icons.event_available_outlined,
                            tooltip: 'Add week to calendar',
                            onPressed: _loading || _syncing
                                ? null
                                : _addAllVisible,
                          ),
                        ],
                      ),
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
                      child: _ShiftCard(
                        shift: shift,
                        hospitalName: _hospitalFor(shift),
                        synced: _syncedIds.contains(shift.shiftId),
                        selectMode: _selectMode,
                        selected: _selectedIds.contains(shift.shiftId),
                        onToggleSelect: () => _toggleSelected(shift.shiftId),
                        onCoverChanged: _load,
                      ),
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

/// Compact pill icon button used inside section headers.
class _SectionIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  const _SectionIconButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: StaffSurfaces.softPanel,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: const BorderSide(color: StaffSurfaces.cardBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Icon(
              icon,
              size: 18,
              color: enabled
                  ? StaffSurfaces.brandSoft
                  : StaffSurfaces.textMutedSoft,
            ),
          ),
        ),
      ),
    );
  }
}

class _SelectionBar extends StatelessWidget {
  final int selectedCount;
  final int total;
  final bool syncing;
  final VoidCallback? onSelectAll;
  final VoidCallback? onClear;
  final VoidCallback? onCancel;
  final VoidCallback? onAdd;

  const _SelectionBar({
    required this.selectedCount,
    required this.total,
    required this.syncing,
    required this.onSelectAll,
    required this.onClear,
    required this.onCancel,
    required this.onAdd,
  });

  @override
  Widget build(BuildContext context) {
    final hasSelection = selectedCount > 0;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 12),
      decoration: BoxDecoration(
        color: StaffSurfaces.softPanel,
        borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
        border: Border.all(color: StaffSurfaces.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  hasSelection
                      ? '$selectedCount of $total selected'
                      : 'Select shifts to add',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                    fontSize: 13.5,
                  ),
                ),
              ),
              TextButton(
                onPressed: hasSelection ? onClear : onSelectAll,
                style: TextButton.styleFrom(
                  foregroundColor: StaffSurfaces.brandSoft,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                  visualDensity: VisualDensity.compact,
                ),
                child: Text(
                  hasSelection ? 'Clear' : 'Select all',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 12.5,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Cancel',
                onPressed: onCancel,
                icon: Icon(Icons.close, color: StaffSurfaces.textSecondary),
                visualDensity: VisualDensity.compact,
                iconSize: 20,
              ),
            ],
          ),
          const SizedBox(height: 4),
          FilledButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.event_available, size: 18),
            label: Text(
              syncing
                  ? 'Adding…'
                  : (hasSelection
                      ? 'Add $selectedCount to calendar'
                      : 'Add to calendar'),
            ),
            style: FilledButton.styleFrom(
              backgroundColor: hasSelection
                  ? StaffSurfaces.cta
                  : StaffSurfaces.softPanelDeep,
              foregroundColor:
                  hasSelection ? Colors.white : StaffSurfaces.textMutedSoft,
              disabledBackgroundColor: StaffSurfaces.softPanelDeep,
              disabledForegroundColor: StaffSurfaces.textMutedSoft,
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              textStyle:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _ShiftCard extends StatelessWidget {
  final ShiftModel shift;
  final String hospitalName;
  final bool synced;
  final bool selectMode;
  final bool selected;
  final VoidCallback onToggleSelect;
  final Future<void> Function()? onCoverChanged;

  const _ShiftCard({
    required this.shift,
    required this.hospitalName,
    required this.synced,
    required this.selectMode,
    required this.selected,
    required this.onToggleSelect,
    this.onCoverChanged,
  });

  Future<void> _openMenu(BuildContext context) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _ShiftActionSheet(
        shift: shift,
        hospitalName: hospitalName,
      ),
    );
    if (action == 'swap' && context.mounted) {
      final sent = await ShiftSwapSheet.show(
        context,
        shift: shift,
        hospitalName: hospitalName,
      );
      if (sent == true) await onCoverChanged?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final booth = (shift.boothOrStation?.trim().isNotEmpty ?? false)
        ? shift.boothOrStation!
        : 'Unassigned booth';
    final cover = shift.coverStatus?.toLowerCase();
    final barColor = switch (cover) {
      'requested' => const Color(0xFFB2660A),
      'declined' => AppColors.error,
      'covering' => AppColors.success,
      _ => StaffSurfaces.accentBar,
    };
    final borderColor = selected
        ? StaffSurfaces.cta
        : switch (cover) {
            'requested' => const Color(0xFFF5B168),
            'declined' => AppColors.error.withValues(alpha: 0.28),
            'covering' => AppColors.success.withValues(alpha: 0.28),
            _ => StaffSurfaces.cardBorder,
          };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: selectMode ? onToggleSelect : null,
        onLongPress: selectMode ? null : () => _openMenu(context),
        borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: StaffSurfaces.card(
            borderColor: borderColor,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (selectMode) ...[
                Padding(
                  padding: const EdgeInsets.only(right: 12, top: 2),
                  child: Icon(
                    selected
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    color: selected
                        ? StaffSurfaces.cta
                        : StaffSurfaces.textMutedSoft,
                    size: 22,
                  ),
                ),
              ] else ...[
                Container(
                  width: 4,
                  height: 58,
                  decoration: BoxDecoration(
                    color: barColor,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            shift.timeRangeLabel,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: StaffSurfaces.textPrimary,
                            ),
                          ),
                        ),
                        ShiftCoverStatusChip.maybe(status: shift.coverStatus) ??
                            (synced
                                ? const StaffStatusChip(
                                    label: 'In calendar',
                                    tone: StaffChipTone.brand,
                                    icon: Icons.event_available,
                                  )
                                : const SizedBox.shrink()),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      hospitalName,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: StaffSurfaces.brandSoft,
                      ),
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
                    if (synced && shift.coverStatus != null) ...[
                      const SizedBox(height: 4),
                      const StaffStatusChip(
                        label: 'In calendar',
                        tone: StaffChipTone.brand,
                        icon: Icons.event_available,
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
        ),
      ),
    );
  }
}

/// Bottom-sheet action menu for a shift (long-press).
class _ShiftActionSheet extends StatelessWidget {
  final ShiftModel shift;
  final String hospitalName;

  const _ShiftActionSheet({
    required this.shift,
    required this.hospitalName,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: StaffSurfaces.appBarBg,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: StaffSurfaces.chipNeutralBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: StaffSurfaces.softPanelDeep,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      Icons.event_note,
                      color: StaffSurfaces.brandSoft,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          shift.timeRangeLabel,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: StaffSurfaces.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$hospitalName · ${shift.shiftDate}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: StaffSurfaces.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            const Divider(color: StaffSurfaces.divider, height: 1),
            if (!shift.isCoverRequested &&
                hasShiftStarted(shift.shiftDate, shift.startTime))
              _MenuTile(
                icon: Icons.schedule,
                label: 'Shift already started',
                subtitle: 'Cover can no longer be requested — tell the hospital desk directly',
                onTap: () => Navigator.of(context).pop(),
              )
            else if (shift.isCoverRequested)
              _MenuTile(
                icon: Icons.hourglass_top_outlined,
                label: 'Cover requested',
                subtitle: 'Hospital is reviewing this shift',
                onTap: () => Navigator.of(context).pop(),
              )
            else
              _MenuTile(
                icon: Icons.swap_horiz,
                label: 'Request cover',
                subtitle: 'Ask the hospital to find someone for this shift',
                onTap: () => Navigator.of(context).pop('swap'),
              ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  const _MenuTile({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(icon, color: StaffSurfaces.brandSoft, size: 20),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: StaffSurfaces.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      fontSize: 12,
                      color: StaffSurfaces.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 20,
              color: StaffSurfaces.textMutedSoft,
            ),
          ],
        ),
      ),
    );
  }
}
