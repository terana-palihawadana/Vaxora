import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/shift_swap_request_model.dart';
import '../../data/repositories/hospital_staff_repository.dart';
import 'cover_request_card.dart';

/// Hospital inbox for staff cover requests. Opened from the Staff tab header.
class CoverRequestsSheet extends StatefulWidget {
  const CoverRequestsSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const CoverRequestsSheet(),
    );
  }

  @override
  State<CoverRequestsSheet> createState() => _CoverRequestsSheetState();
}

class _CoverRequestsSheetState extends State<CoverRequestsSheet> {
  bool _loading = true;
  String? _error;
  String? _decidingId;
  List<ShiftSwapRequestModel> _requests = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await HospitalStaffRepository.getShiftSwaps();
      if (!mounted) return;
      setState(() {
        _requests = list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Failed to load cover requests.';
        _requests = [];
      });
    }
  }

  List<ShiftSwapRequestModel> get _pending =>
      _requests.where((r) => r.isPending).toList();

  Future<void> _decide(
    ShiftSwapRequestModel request, {
    required bool approved,
    String? replacementAffiliationId,
  }) async {
    if (_decidingId != null) return;
    final ok = await confirmAction(
      context,
      title: approved ? 'Assign cover?' : 'Decline cover request?',
      message: approved
          ? 'Assign a replacement for ${request.requesterName}\'s shift on ${request.shiftDate}? '
              'The original staff member will be covered.'
          : 'Decline cover for ${request.requesterName} on ${request.shiftDate}? '
              'They will stay assigned to this shift.',
      confirmLabel: approved ? 'Assign cover' : 'Decline',
      destructive: !approved,
    );
    if (!ok || !mounted) return;
    setState(() => _decidingId = request.id);
    try {
      final updated = await HospitalStaffRepository.decideShiftSwap(
        requestId: request.id,
        approved: approved,
        replacementAffiliationId: replacementAffiliationId,
      );
      if (!mounted) return;
      setState(() {
        _requests =
            _requests.map((r) => r.id == updated.id ? updated : r).toList();
        _decidingId = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _decidingId = null;
        _error = e is ApiException
            ? e.message
            : 'Could not record that decision.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: StaffSurfaces.appBarBg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.82,
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
              _Header(
                pendingCount: _pending.length,
                onClose: () => Navigator.of(context).pop(),
              ),
              const SizedBox(height: 8),
              Flexible(child: _buildBody()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading && _requests.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: CircularProgressIndicator(color: StaffSurfaces.brandSoft),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: StaffSurfaces.brandSoft,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          if (_error != null) ...[
            StaffErrorBanner(
              message: _error!,
              onDismiss: () => setState(() => _error = null),
            ),
            const SizedBox(height: 12),
          ],
          if (_pending.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 28),
              child: StaffEmptyCard(
                message: 'No cover requests waiting.',
                icon: Icons.swap_horiz,
              ),
            )
          else
            ..._pending.map(
              (r) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: CoverRequestCard(
                  request: r,
                  busy: _decidingId == r.id,
                  onApprove: (affiliationId) => _decide(
                    r,
                    approved: true,
                    replacementAffiliationId: affiliationId,
                  ),
                  onDecline: () => _decide(r, approved: false),
                  onRanked: (ranked) => setState(() {
                    _requests = _requests
                        .map((x) => x.id == ranked.id ? ranked : x)
                        .toList();
                  }),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final int pendingCount;
  final VoidCallback onClose;

  const _Header({required this.pendingCount, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Padding(
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
            child: Icon(Icons.swap_horiz, color: StaffSurfaces.brandSoft),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Cover requests',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  pendingCount == 0
                      ? 'Nothing waiting for review'
                      : pendingCount == 1
                          ? '1 waiting for review'
                          : '$pendingCount waiting for review',
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.close, color: StaffSurfaces.textSecondary),
            onPressed: onClose,
          ),
        ],
      ),
    );
  }
}
