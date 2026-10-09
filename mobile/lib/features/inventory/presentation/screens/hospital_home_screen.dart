import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../hospital_staff/data/models/hospital_staff_member_model.dart';
import '../../../hospital_staff/data/models/shift_swap_request_model.dart';
import '../../../hospital_staff/data/repositories/hospital_staff_repository.dart';
import '../../../hospital_staff/presentation/screens/hospital_shifts_screen.dart';
import '../../../hospital_staff/presentation/screens/staff_scheduling_agent_screen.dart';
import '../../../staff/presentation/utils/staff_date_utils.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../providers/inventory_provider.dart';
import 'hospital_alerts_screen.dart';
import 'hospital_ai_screen.dart';

class HospitalHomeScreen extends StatefulWidget {
  final ValueChanged<int> onNavigateTab;

  const HospitalHomeScreen({super.key, required this.onNavigateTab});

  @override
  State<HospitalHomeScreen> createState() => _HospitalHomeScreenState();
}

class _HospitalHomeScreenState extends State<HospitalHomeScreen> {
  String _hospitalName = 'Hospital';
  String? _logoUrl;
  List<HospitalStaffMemberModel> _staff = [];
  List<ShiftSwapRequestModel> _covers = [];
  bool _staffLoading = true;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    if (mounted && user != null) {
      setState(() {
        _hospitalName = user['name']?.toString().trim().isNotEmpty == true
            ? user['name'].toString().trim()
            : 'Hospital';
        _logoUrl = resolveMediaUrl(
          user['profilePhotoUrl']?.toString() ??
              user['logoUrl']?.toString() ??
              user['photoUrl']?.toString(),
        );
      });
    }
    await _loadStaff();
  }

  Future<void> _loadStaff() async {
    setState(() => _staffLoading = true);
    try {
      final staff = await HospitalStaffRepository.getStaff();
      List<ShiftSwapRequestModel> covers = [];
      try {
        covers = await HospitalStaffRepository.getShiftSwaps();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _staff = staff;
        _covers = covers;
        _staffLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _staff = [];
        _covers = [];
        _staffLoading = false;
      });
    }
  }

  Future<void> _refresh() async {
    await Future.wait([
      _loadStaff(),
      context.read<InventoryProvider>().refresh(),
    ]);
  }

  int get _onDuty => _staff.where((s) => s.isOnDutyNow).length;
  int get _pendingCover => _covers.where((r) => r.isPending).length;

  Future<void> _openAlerts() async {
    final provider = context.read<InventoryProvider>();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChangeNotifierProvider.value(
          value: provider,
          child: const HospitalAlertsScreen(),
        ),
      ),
    );
    if (mounted) await provider.refresh();
  }

  Future<void> _openAi() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const HospitalAiScreen()),
    );
  }

  Future<void> _openShifts() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const HospitalShiftsScreen()),
    );
  }

  Future<void> _openSchedulingAgent() async {
    final range = weekRangeFromToday(days: 7);
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StaffSchedulingAgentScreen(
          weekStart: range.from,
          weekEnd: range.to,
          autoSuggest: true,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inventory = context.watch<InventoryProvider>();
    final alertCount = inventory.lowStockCount + inventory.expiringCount;
    final vials = inventory.totalVials;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Home',
        photoUrl: _logoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.notifications_outlined,
            tooltip: 'Stock alerts',
            badgeCount: alertCount,
            onPressed: inventory.isLoading ? null : _openAlerts,
          ),
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: inventory.isLoading || _staffLoading ? null : _refresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Operations',
              title: 'Hospital overview',
              subtitle: alertCount > 0
                  ? '$alertCount stock issue${alertCount == 1 ? '' : 's'} need attention.'
                  : 'Stock and roster are in good shape.',
              stats: [
                StaffIntroStat(
                  label: 'Vials',
                  value: '$vials',
                  icon: Icons.inventory_2_outlined,
                  accent: AppColors.accentTeal,
                ),
                StaffIntroStat(
                  label: 'Alerts',
                  value: '$alertCount',
                  icon: Icons.warning_amber_outlined,
                  accent: alertCount > 0
                      ? AppColors.warning
                      : AppColors.success,
                ),
                StaffIntroStat(
                  label: 'On duty',
                  value: _staffLoading ? '—' : '$_onDuty',
                  icon: Icons.medical_services_outlined,
                  accent: AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 18),
            StaffSectionHeader(
              title: 'Attention',
              count: alertCount + _pendingCover,
            ),
            if (alertCount == 0 && _pendingCover == 0)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                decoration: StaffSurfaces.card(
                  color: AppColors.successBg,
                  borderColor: AppColors.success.withValues(alpha: 0.28),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.check_circle_outline, color: AppColors.success, size: 18),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'No stock alerts or pending cover requests.',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w500,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              )
            else ...[
              if (inventory.lowStockCount > 0)
                _AttentionTile(
                  icon: Icons.trending_down,
                  title: 'Low stock',
                  subtitle:
                      '${inventory.lowStockCount} batch${inventory.lowStockCount == 1 ? '' : 'es'} below threshold.',
                  tone: StaffChipTone.danger,
                  onTap: _openAlerts,
                ),
              if (inventory.expiringCount > 0)
                _AttentionTile(
                  icon: Icons.hourglass_bottom,
                  title: 'Expiring soon',
                  subtitle:
                      '${inventory.expiringCount} batch${inventory.expiringCount == 1 ? '' : 'es'} nearing expiry.',
                  tone: StaffChipTone.warning,
                  onTap: _openAlerts,
                ),
              if (_pendingCover > 0)
                _AttentionTile(
                  icon: Icons.swap_horiz,
                  title: 'Cover requests',
                  subtitle:
                      '$_pendingCover pending. Review them in Staff.',
                  tone: StaffChipTone.warning,
                  onTap: () => widget.onNavigateTab(2),
                ),
            ],
            const SizedBox(height: 18),
            const StaffSectionHeader(title: 'Shortcuts'),
            _ShortcutTile(
              icon: Icons.event_note_outlined,
              title: 'Desk & schedules',
              subtitle: 'Walk-ins, check-in, mark paid, post sessions',
              accent: AppColors.accentTeal,
              well: const Color(0xFFE6F7F5),
              onTap: () => widget.onNavigateTab(1),
            ),
            _ShortcutTile(
              icon: Icons.groups_outlined,
              title: 'Staff roster',
              subtitle: '${_staff.length} active · $_onDuty on duty',
              accent: AppColors.accentTeal,
              well: const Color(0xFFE6F7F5),
              onTap: () => widget.onNavigateTab(2),
            ),
            _ShortcutTile(
              icon: Icons.meeting_room_outlined,
              title: 'Booths',
              subtitle: 'Stations and vaccines they offer',
              accent: StaffSurfaces.brandSoft,
              onTap: () => widget.onNavigateTab(3),
            ),
            _ShortcutTile(
              icon: Icons.inventory_2_outlined,
              title: 'Inventory',
              subtitle: 'Batches, scan QR, issue and wastage',
              accent: StaffSurfaces.brandSoft,
              onTap: () => widget.onNavigateTab(4),
            ),
            _ShortcutTile(
              icon: Icons.notifications_outlined,
              title: 'Stock alerts',
              subtitle: 'Low stock, expiry, and expired lots',
              accent: AppColors.warning,
              well: AppColors.warningBg,
              onTap: _openAlerts,
            ),
            _ShortcutTile(
              icon: Icons.auto_awesome,
              title: 'Inventory AI',
              subtitle: 'Restock and expiry rescue drafts',
              accent: AppColors.ai,
              well: AppColors.aiBg,
              onTap: _openAi,
            ),
            _ShortcutTile(
              icon: Icons.calendar_month_outlined,
              title: 'Weekly shifts',
              subtitle: 'Roster view + AI suggest week',
              accent: StaffSurfaces.brandSoft,
              onTap: _openShifts,
            ),
            _ShortcutTile(
              icon: Icons.auto_awesome,
              title: 'Scheduling agent',
              subtitle: 'Chat and approve AI shift proposals',
              accent: const Color(0xFF6D5BAE),
              well: const Color(0xFFEDE9F8),
              onTap: _openSchedulingAgent,
            ),
            _ShortcutTile(
              icon: Icons.person_outline,
              title: 'Profile',
              subtitle: 'Hospital account and settings',
              accent: StaffSurfaces.brandSoft,
              onTap: () => widget.onNavigateTab(5),
            ),
          ],
        ),
      ),
    );
  }
}

class _AttentionTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final StaffChipTone tone;
  final VoidCallback onTap;

  const _AttentionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.tone,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: StaffSurfaces.card(
              borderColor: switch (tone) {
                StaffChipTone.danger =>
                  AppColors.error.withValues(alpha: 0.28),
                StaffChipTone.warning => AppColors.warningBorder,
                _ => StaffSurfaces.cardBorder,
              },
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: switch (tone) {
                      StaffChipTone.danger => AppColors.errorBg,
                      StaffChipTone.warning => AppColors.warningBg,
                      StaffChipTone.success => AppColors.successBg,
                      _ => StaffSurfaces.softPanelDeep,
                    },
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    icon,
                    size: 18,
                    color: switch (tone) {
                      StaffChipTone.danger => AppColors.error,
                      StaffChipTone.warning => AppColors.warning,
                      StaffChipTone.success => AppColors.success,
                      _ => StaffSurfaces.brandSoft,
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
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
                          fontSize: 12.5,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  color: StaffSurfaces.textMutedSoft,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ShortcutTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Color? accent;
  final Color? well;

  const _ShortcutTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.accent,
    this.well,
  });

  @override
  Widget build(BuildContext context) {
    final color = accent ?? StaffSurfaces.brandSoft;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: StaffSurfaces.card(),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: well ?? StaffSurfaces.softPanelDeep,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 18, color: color),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
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
                          fontSize: 12.5,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  color: StaffSurfaces.textMutedSoft,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
