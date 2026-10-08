import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/utils/home_route_utils.dart';
import '../../../hospital_staff/data/models/shift_swap_request_model.dart';
import '../../data/models/affiliation_model.dart';
import '../../data/models/shift_model.dart';
import '../../data/repositories/shift_swap_repository.dart';
import '../../data/repositories/staff_repository.dart';
import '../utils/staff_date_utils.dart';
import '../widgets/staff_common_widgets.dart';

class StaffHomeScreen extends StatefulWidget {
  final ValueChanged<int> onNavigateTab;

  const StaffHomeScreen({super.key, required this.onNavigateTab});

  @override
  State<StaffHomeScreen> createState() => _StaffHomeScreenState();
}

class _StaffHomeScreenState extends State<StaffHomeScreen> {
  String _displayName = 'there';
  String _roleLabel = 'Staff';
  String? _photoUrl;
  List<ShiftModel> _shifts = [];
  List<AffiliationModel> _affiliations = [];
  int _pendingCovers = 0;
  int _pendingInvitations = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    if (mounted && user != null) {
      setState(() {
        _displayName = user['name']?.toString().trim().isNotEmpty == true
            ? user['name'].toString().trim()
            : 'there';
        _roleLabel = staffRoleLabel(user['role']?.toString() ?? '');
        _photoUrl = user['profilePhotoUrl']?.toString() ??
            user['profilePhoto']?.toString() ??
            user['photoUrl']?.toString();
      });
    }
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final range = weekRangeFromToday(days: 7);
    try {
      final results = await Future.wait([
        StaffRepository.getMyShifts(from: range.from, to: range.to),
        StaffRepository.getMyAffiliations(),
        ShiftSwapRepository.listMine(),
        StaffRepository.getMyInvitations(),
      ]);
      if (!mounted) return;
      final swaps = results[2] as List<ShiftSwapRequestModel>;
      setState(() {
        _shifts = results[0] as List<ShiftModel>;
        _affiliations = (results[1] as List<AffiliationModel>)
            .where((affiliation) => affiliation.isActive)
            .toList();
        _pendingCovers = swaps.where((request) => request.isPending).length;
        _pendingInvitations = (results[3] as List<AffiliationModel>)
            .where((invitation) => invitation.isPending)
            .length;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Could not load your overview.';
      });
    }
  }

  List<ShiftModel> get _todayShifts => _shifts
      .where((shift) => shift.shiftDate.startsWith(todayIsoDate()))
      .toList();

  List<ShiftModel> get _upcomingShifts {
    final today = todayIsoDate();
    final shifts = _shifts
        .where((shift) {
          if (shift.shiftDate.compareTo(today) > 0) return true;
          if (!shift.shiftDate.startsWith(today)) return false;
          final parts = shift.startTime.split(':');
          if (parts.length < 2) return true;
          final hour = int.tryParse(parts[0]);
          final minute = int.tryParse(parts[1]);
          if (hour == null || minute == null) return true;
          final start = hour * 60 + minute;
          final now = hospitalNow();
          return start >= now.hour * 60 + now.minute;
        })
        .toList()
      ..sort((a, b) {
        final dateOrder = a.shiftDate.compareTo(b.shiftDate);
        return dateOrder != 0 ? dateOrder : a.startTime.compareTo(b.startTime);
      });
    return shifts;
  }

  String _hospitalNameFor(ShiftModel shift) {
    for (final affiliation in _affiliations) {
      if (affiliation.affiliationId == shift.affiliationId) {
        return affiliation.hospitalName;
      }
    }
    return 'Hospital';
  }

  String get _greeting {
    final hour = hospitalNow().hour;
    final salutation = hour < 12
        ? 'Good morning'
        : hour < 17
        ? 'Good afternoon'
        : 'Good evening';
    return _displayName == 'there' ? salutation : '$salutation, $_displayName';
  }

  @override
  Widget build(BuildContext context) {
    final nextShift = _upcomingShifts.isEmpty ? null : _upcomingShifts.first;
    final actionCount = _pendingCovers + _pendingInvitations;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _displayName,
        subtitle: '$_roleLabel · Home',
        photoUrl: _photoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh overview',
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
              eyebrow: 'Staff home',
              title: _greeting,
              subtitle: _todayLabel(),
              stats: [
                StaffIntroStat(
                  label: 'Today’s shifts',
                  value: _loading ? '—' : '${_todayShifts.length}',
                  icon: Icons.calendar_today_outlined,
                  accent: AppColors.accentTeal,
                ),
                StaffIntroStat(
                  label: 'Hospitals',
                  value: _loading ? '—' : '${_affiliations.length}',
                  icon: Icons.local_hospital_outlined,
                ),
                StaffIntroStat(
                  label: 'To review',
                  value: _loading ? '—' : '$actionCount',
                  icon: Icons.mark_email_unread_outlined,
                  accent: actionCount > 0
                      ? AppColors.warning
                      : AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 18),
            if (_error != null) ...[
              StaffErrorBanner(
                message: _error!,
                onDismiss: () => setState(() => _error = null),
              ),
              const SizedBox(height: 12),
            ],
            if (actionCount > 0) ...[
              const StaffSectionHeader(title: 'Needs your attention'),
              if (_pendingInvitations > 0)
                _HomeNotice(
                  icon: Icons.local_hospital_outlined,
                  title: 'Hospital invitations',
                  detail:
                      '$_pendingInvitations invitation${_pendingInvitations == 1 ? '' : 's'} waiting for your response.',
                  onTap: () => widget.onNavigateTab(3),
                ),
              if (_pendingCovers > 0)
                _HomeNotice(
                  icon: Icons.swap_horiz,
                  title: 'Cover requests',
                  detail:
                      '$_pendingCovers request${_pendingCovers == 1 ? '' : 's'} need${_pendingCovers == 1 ? 's' : ''} a decision.',
                  onTap: () => widget.onNavigateTab(1),
                ),
              const SizedBox(height: 14),
            ],
            StaffSectionHeader(
              title: nextShift == null ? 'Your schedule' : 'Next shift',
              trailing: TextButton(
                onPressed: () => widget.onNavigateTab(1),
                child: const Text('View shifts'),
              ),
            ),
            if (_loading && _shifts.isEmpty)
              const _HomeLoadingCard()
            else if (nextShift == null)
              const StaffEmptyCard(
                compact: true,
                icon: Icons.event_available_outlined,
                message: 'No upcoming shifts this week.',
              )
            else
              _NextShiftCard(
                shift: nextShift,
                hospitalName: _hospitalNameFor(nextShift),
              ),
            const SizedBox(height: 18),
            const StaffSectionHeader(title: 'Quick access'),
            _HomeShortcut(
              icon: Icons.calendar_month_outlined,
              accent: const Color(0xFF315F8A),
              tint: const Color(0xFFE4EEF8),
              title: 'My shifts',
              detail: 'Check your roster and request cover.',
              onTap: () => widget.onNavigateTab(1),
            ),
            _HomeShortcut(
              icon: Icons.event_note_outlined,
              accent: const Color(0xFFAC6818),
              tint: const Color(0xFFFFF1DD),
              title: 'Clinic',
              detail: 'Open today’s patient queue.',
              onTap: () => widget.onNavigateTab(2),
            ),
            _HomeShortcut(
              icon: Icons.local_hospital_outlined,
              accent: const Color(0xFF7658B7),
              tint: const Color(0xFFEEE8FA),
              title: 'Hospitals',
              detail: 'Manage affiliations and invitations.',
              onTap: () => widget.onNavigateTab(3),
            ),
            _HomeShortcut(
              icon: Icons.swap_horiz,
              accent: const Color(0xFF287A70),
              tint: const Color(0xFFE1F2EE),
              title: 'Cover requests',
              detail: 'Review or request shift cover.',
              onTap: () => widget.onNavigateTab(1),
            ),
          ],
        ),
      ),
    );
  }

  String _todayLabel() {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    final now = hospitalNow();
    return '${weekdays[now.weekday - 1]}, ${now.day} ${months[now.month - 1]}';
  }
}

class _NextShiftCard extends StatelessWidget {
  final ShiftModel shift;
  final String hospitalName;

  const _NextShiftCard({required this.shift, required this.hospitalName});

  @override
  Widget build(BuildContext context) {
    final booth = shift.boothOrStation?.trim();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: AppColors.accentTeal.withValues(alpha: 0.28),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.accentTeal.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.calendar_month_outlined,
              color: AppColors.accentTeal,
              size: 21,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  shiftDayHeading(shift.shiftDate),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '$hospitalName · ${shift.timeRangeLabel}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
                if (booth != null && booth.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    booth,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11.5,
                      color: StaffSurfaces.textMutedSoft,
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

class _HomeNotice extends StatelessWidget {
  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback onTap;

  const _HomeNotice({
    required this.icon,
    required this.title,
    required this.detail,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: StaffSurfaces.card(),
          child: Row(
            children: [
              Icon(icon, color: AppColors.warning, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: StaffSurfaces.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      style: const TextStyle(
                        fontSize: 12,
                        color: StaffSurfaces.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: StaffSurfaces.textMutedSoft),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeShortcut extends StatelessWidget {
  final IconData icon;
  final Color accent;
  final Color tint;
  final String title;
  final String detail;
  final VoidCallback onTap;

  const _HomeShortcut({
    required this.icon,
    required this.accent,
    required this.tint,
    required this.title,
    required this.detail,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: StaffSurfaces.card(),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: tint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 19, color: accent),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: StaffSurfaces.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: StaffSurfaces.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: StaffSurfaces.textMutedSoft),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeLoadingCard extends StatelessWidget {
  const _HomeLoadingCard();

  @override
  Widget build(BuildContext context) => Container(
    height: 82,
    decoration: StaffSurfaces.card(),
    child: const Center(
      child: SizedBox(
        width: 22,
        height: 22,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
    ),
  );
}
