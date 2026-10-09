import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/utils/home_route_utils.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/hospital_staff_member_model.dart';
import '../../data/models/shift_swap_request_model.dart';
import '../../data/repositories/hospital_staff_repository.dart';
import '../widgets/cover_requests_sheet.dart';
import '../widgets/invite_staff_sheet.dart';
import '../../../staff/presentation/utils/staff_date_utils.dart';
import 'hospital_shifts_screen.dart';
import 'staff_scheduling_agent_screen.dart';

/// Hospital-side "Staff" tab: on-duty roster and full active staff list.
class HospitalStaffScreen extends StatefulWidget {
  const HospitalStaffScreen({super.key});

  @override
  State<HospitalStaffScreen> createState() => _HospitalStaffScreenState();
}

class _HospitalStaffScreenState extends State<HospitalStaffScreen> {
  List<HospitalStaffMemberModel> _staff = [];
  List<HospitalStaffMemberModel> _pending = [];
  List<ShiftSwapRequestModel> _coverRequests = [];
  bool _loading = true;
  String? _error;

  String _hospitalName = 'Hospital';
  String? _hospitalLogoUrl;

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
        _hospitalLogoUrl = resolveMediaUrl(
          user['profilePhotoUrl']?.toString() ??
              user['profilePhoto']?.toString() ??
              user['logoUrl']?.toString(),
        );
      });
    }
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final staffFuture = HospitalStaffRepository.getStaff();
      final pendingFuture = HospitalStaffRepository.getStaff(status: 'Pending');
      final swapFuture = HospitalStaffRepository.getShiftSwaps();
      final staff = await staffFuture;
      final pending = await pendingFuture;
      List<ShiftSwapRequestModel> swaps = [];
      try {
        swaps = await swapFuture;
      } on ApiException {
        swaps = [];
      }
      if (!mounted) return;
      setState(() {
        _staff = staff;
        _pending = pending;
        _coverRequests = swaps;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Failed to load staff.';
        _staff = [];
        _pending = [];
        _coverRequests = [];
      });
    }
  }

  List<ShiftSwapRequestModel> get _pendingCover =>
      _coverRequests.where((r) => r.isPending).toList();

  Future<void> _openCoverInbox() async {
    await CoverRequestsSheet.show(context);
    if (mounted) await _load();
  }

  Future<void> _openInviteSheet() async {
    final sent = await InviteStaffSheet.show(context);
    if (sent == true) await _load();
  }

  Future<void> _openShifts() async {
    await Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const HospitalShiftsScreen()));
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

  int get _onDutyCount => _staff.where((s) => s.isOnDutyNow).length;

  List<HospitalStaffMemberModel> get _onDuty =>
      _staff.where((s) => s.isOnDutyNow).toList();
  List<HospitalStaffMemberModel> get _offDuty =>
      _staff.where((s) => !s.isOnDutyNow).toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Staff',
        photoUrl: _hospitalLogoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.event_note_outlined,
            tooltip: 'Weekly shifts',
            onPressed: _loading ? null : _openShifts,
          ),
          StaffHeaderAction(
            icon: Icons.auto_awesome,
            tooltip: 'Scheduling agent',
            onPressed: _loading ? null : _openSchedulingAgent,
          ),
          StaffHeaderAction(
            icon: Icons.swap_horiz,
            tooltip: 'Cover requests',
            badgeCount: _pendingCover.length,
            onPressed: _loading ? null : _openCoverInbox,
          ),
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _openInviteSheet,
        backgroundColor: StaffSurfaces.cta,
        foregroundColor: Colors.white,
        elevation: 2,
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text(
          'Invite staff',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Hospital roster',
              title: 'Your staff',
              subtitle:
                  'Active doctors and nurses affiliated with your hospital.',
              stats: [
                StaffIntroStat(
                  label: 'Active',
                  value: '${_staff.length}',
                  icon: Icons.groups_outlined,
                  accent: AppColors.success,
                ),
                StaffIntroStat(
                  label: 'On duty',
                  value: '$_onDutyCount',
                  icon: Icons.medical_services_outlined,
                  accent: AppColors.success,
                ),
                StaffIntroStat(
                  label: 'Pending',
                  value: '${_pending.length}',
                  icon: Icons.mark_email_unread_outlined,
                  accent: _pending.isNotEmpty
                      ? const Color(0xFFB2660A)
                      : AppColors.success,
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
            if (_loading &&
                _staff.isEmpty &&
                _pending.isEmpty &&
                _coverRequests.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              )
            else ...[
              if (_pending.isNotEmpty) ...[
                StaffSectionHeader(
                  title: 'Pending invitations',
                  count: _pending.length,
                ),
                ..._pending.map(
                  (m) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _StaffMemberCard(member: m),
                  ),
                ),
                const SizedBox(height: 6),
              ],
              if (_staff.isEmpty && _pending.isEmpty)
                const StaffEmptyCard(
                  message: 'No affiliated staff yet. Invitations you send will appear here once accepted.',
                  icon: Icons.groups_outlined,
                )
              else ...[
                if (_onDuty.isNotEmpty) ...[
                  StaffSectionHeader(
                    title: 'On duty now',
                    count: _onDuty.length,
                  ),
                  ..._onDuty.map(
                    (m) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _StaffMemberCard(member: m),
                    ),
                  ),
                  const SizedBox(height: 6),
                ],
                if (_offDuty.isNotEmpty || _onDuty.isEmpty) ...[
                  StaffSectionHeader(
                    title: _onDuty.isEmpty ? 'Staff' : 'Off duty',
                    count: _offDuty.length,
                  ),
                  if (_offDuty.isEmpty)
                    const StaffEmptyCard(
                      message: 'Everyone is currently on duty.',
                      icon: Icons.check_circle_outline,
                      compact: true,
                    )
                  else
                    ..._offDuty.map(
                      (m) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _StaffMemberCard(member: m),
                      ),
                    ),
                ],
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _StaffMemberCard extends StatelessWidget {
  final HospitalStaffMemberModel member;

  const _StaffMemberCard({required this.member});

  String get _initials {
    final parts = member.staffName
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

  Widget _avatarFallback() {
    return Container(
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
    );
  }

  String get _roleLine {
    final role = staffRoleLabel(member.staffRole);
    final spec = member.specialization?.trim();
    if (spec != null && spec.isNotEmpty) return '$role · $spec';
    return role;
  }

  String get _contactLine {
    final parts = <String>[];
    if (member.staffRegistrationNumber.isNotEmpty) {
      parts.add(member.staffRegistrationNumber);
    }
    final phone = member.phoneNumber?.trim();
    if (phone != null && phone.isNotEmpty) parts.add(phone);
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: member.isPending
            ? const Color(0xFFF5B168)
            : (member.isOnDutyNow
                  ? AppColors.success.withValues(alpha: 0.28)
                  : StaffSurfaces.cardBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: StaffSurfaces.cardBorder),
            ),
            clipBehavior: Clip.antiAlias,
            child: NetworkAvatar(
              url: member.staffPhotoUrl,
              size: 46,
              fallback: _avatarFallback(),
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
                        member.staffName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ),
                    if (member.isPending)
                      const StaffStatusChip(
                        label: 'Pending',
                        tone: StaffChipTone.warning,
                        icon: Icons.mark_email_unread_outlined,
                      )
                    else
                      StaffStatusChip(
                        label: member.isOnDutyNow
                            ? 'On duty'
                            : 'No active shift',
                        tone: member.isOnDutyNow
                            ? StaffChipTone.success
                            : StaffChipTone.neutral,
                        icon: member.isOnDutyNow
                            ? Icons.circle
                            : Icons.circle_outlined,
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  _roleLine,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
                if (_contactLine.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    _contactLine,
                    style: const TextStyle(
                      fontSize: 12,
                      color: StaffSurfaces.textSecondary,
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
