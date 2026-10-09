import 'dart:convert';

import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../inventory/data/models/hospital_schedule_model.dart';
import '../../../inventory/data/repositories/hospital_schedule_repository.dart';
import '../../../staff/data/models/shift_model.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/repositories/hospital_staff_repository.dart';
import 'suggest_week_compare_screen.dart';

class _ChatMsg {
  final String role; // user | assistant
  final String content;
  final bool isError;

  const _ChatMsg({
    required this.role,
    required this.content,
    this.isError = false,
  });
}

/// Mobile port of web StaffSchedulingAgentChat + suggest-week approval.
class StaffSchedulingAgentScreen extends StatefulWidget {
  final String weekStart;
  final String weekEnd;
  final bool autoSuggest;

  const StaffSchedulingAgentScreen({
    super.key,
    required this.weekStart,
    required this.weekEnd,
    this.autoSuggest = false,
  });

  @override
  State<StaffSchedulingAgentScreen> createState() =>
      _StaffSchedulingAgentScreenState();
}

class _StaffSchedulingAgentScreenState
    extends State<StaffSchedulingAgentScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_ChatMsg> _messages = [];
  List<ShiftProposalItem> _proposals = [];
  List<ShiftModel> _existingShifts = [];
  List<HospitalScheduleModel> _schedules = [];
  Map<String, dynamic>? _fairness;
  String? _workflowId;
  bool _busy = false;
  String? _hospitalName;
  String? _logoUrl;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
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
              user['logoUrl']?.toString(),
        );
      });
    }
    setState(() {
      _messages.add(
        _ChatMsg(
          role: 'assistant',
          content:
              'I cover ${_formatRange(widget.weekStart, widget.weekEnd)}. '
              'Ask me to fill gaps, or tap Suggest week.',
        ),
      );
    });
    try {
      final results = await Future.wait([
        HospitalStaffRepository.getShifts(
          from: widget.weekStart,
          to: widget.weekEnd,
        ),
        HospitalScheduleRepository.list(),
      ]);
      if (mounted) {
        setState(() {
          _existingShifts = results[0] as List<ShiftModel>;
          _schedules = (results[1] as List<HospitalScheduleModel>)
              .where((s) => !s.isCancelled)
              .toList();
        });
      }
    } catch (_) {}
    if (widget.autoSuggest) {
      await _suggestWeek();
    }
  }

  String _formatRange(String from, String to) {
    return '${from.length >= 10 ? from.substring(0, 10) : from} → '
        '${to.length >= 10 ? to.substring(0, 10) : to}';
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating),
    );
  }

  List<Map<String, dynamic>> _extractProposals(Map<String, dynamic> res) {
    if (res['proposals'] is List) {
      return (res['proposals'] as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    }
    if (res['proposal'] is Map) {
      return [Map<String, dynamic>.from(res['proposal'] as Map)];
    }
    return [];
  }

  void _applyProposals(
    List<Map<String, dynamic>> list, {
    String? workflowId,
    Map<String, dynamic>? fairness,
    bool openCompare = true,
  }) {
    setState(() {
      _proposals = list.map(ShiftProposalItem.new).toList();
      _fairness = fairness;
      if (workflowId != null && workflowId.isNotEmpty) {
        _workflowId = workflowId;
      }
    });
    if (openCompare && list.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _openCompare();
      });
    }
  }

  Future<void> _openCompare() async {
    if (_proposals.where((p) => p.status == null).isEmpty) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SuggestWeekCompareScreen(
          weekStart: widget.weekStart,
          weekEnd: widget.weekEnd,
          existingShifts: _existingShifts,
          proposals: _proposals,
          schedules: _schedules,
          fairness: _fairness,
          busy: _busy,
          onApproveSelected: _approveSelected,
          onDecline: _decline,
          onReroll: () async {
            Navigator.of(context).pop();
            await _suggestWeek(reroll: true);
          },
        ),
      ),
    );
    if (!mounted) return;
    // Refresh roster after approvals so next compare is accurate.
    try {
      final shifts = await HospitalStaffRepository.getShifts(
        from: widget.weekStart,
        to: widget.weekEnd,
      );
      if (mounted) setState(() => _existingShifts = shifts);
    } catch (_) {}
    setState(() {});
  }

  Map<String, dynamic>? _fairnessFrom(Map<String, dynamic> res) {
    final raw = res['fairnessSummary'] ?? res['fairness_summary'];
    if (raw is Map<String, dynamic>) return raw;
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return null;
  }

  Future<void> _suggestWeek({bool reroll = false}) async {
    setState(() => _busy = true);
    final prompt = reroll
        ? 'Suggest shifts for booked appointments from ${widget.weekStart} to ${widget.weekEnd}. Reroll seed: ${DateTime.now().millisecondsSinceEpoch}.'
        : 'Suggest shifts for booked appointments from ${widget.weekStart} to ${widget.weekEnd}';

    setState(() {
      _messages.add(_ChatMsg(role: 'user', content: reroll ? 'Reroll suggestions' : 'Suggest week coverage'));
    });

    try {
      final res = await HospitalStaffRepository.chatSchedulingAgent(
        messages: [
          {'role': 'user', 'content': prompt},
        ],
      );
      final proposals = _extractProposals(res);
      final content = res['content']?.toString() ?? '';
      if (proposals.isEmpty) {
        // Fallback to rules-based suggest-week
        try {
          final fallback = await HospitalStaffRepository.suggestWeek(
            from: widget.weekStart,
            to: widget.weekEnd,
          );
          final list = (fallback['proposals'] is List)
              ? (fallback['proposals'] as List)
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : <Map<String, dynamic>>[];
          if (list.isEmpty) {
            setState(() {
              _messages.add(
                _ChatMsg(
                  role: 'assistant',
                  content: fallback['message']?.toString() ??
                      content.ifEmpty(
                        'No new shifts to propose — this week looks covered.',
                      ),
                ),
              );
              _proposals = [];
            });
          } else {
            setState(() {
              _messages.add(
                _ChatMsg(
                  role: 'assistant',
                  content:
                      '${list.length} suggested shift${list.length == 1 ? '' : 's'} (rules fallback). Review and approve below.',
                ),
              );
            });
            _applyProposals(list, fairness: _fairnessFrom(fallback));
          }
        } catch (_) {
          setState(() {
            _messages.add(
              _ChatMsg(
                role: 'assistant',
                content: content.ifEmpty(
                  'No new shifts to propose for this week.',
                ),
              ),
            );
          });
        }
      } else {
        setState(() {
          _messages.add(
            _ChatMsg(
              role: 'assistant',
              content: content.ifEmpty(
                '${proposals.length} suggested shift${proposals.length == 1 ? '' : 's'}. Opening comparison…',
              ),
            ),
          );
        });
        _applyProposals(
          proposals,
          workflowId: res['workflowId']?.toString(),
          fairness: _fairnessFrom(res),
        );
      }
    } catch (e) {
      setState(() {
        _messages.add(
          _ChatMsg(
            role: 'assistant',
            content: e is ApiException ? e.message : e.toString(),
            isError: true,
          ),
        );
      });
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollToEnd();
    }
  }

  Future<void> _sendChat() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    _input.clear();
    setState(() {
      _messages.add(_ChatMsg(role: 'user', content: text));
      _busy = true;
    });
    _scrollToEnd();

    final history = _messages
        .where((m) => m.role == 'user' || m.role == 'assistant')
        .where((m) => !m.isError)
        .map((m) => {'role': m.role, 'content': m.content})
        .toList();

    try {
      final res = await HospitalStaffRepository.chatSchedulingAgent(
        messages: history,
      );
      final proposals = _extractProposals(res);
      final content = res['content']?.toString() ?? '';
      setState(() {
        _messages.add(
          _ChatMsg(
            role: 'assistant',
            content: content.ifEmpty(
              proposals.isEmpty
                  ? 'Done — nothing new to propose.'
                  : '${proposals.length} proposal(s) ready below.',
            ),
          ),
        );
      });
      if (proposals.isNotEmpty) {
        _applyProposals(
          proposals,
          workflowId: res['workflowId']?.toString(),
          fairness: _fairnessFrom(res),
        );
      }
    } catch (e) {
      setState(() {
        _messages.add(
          _ChatMsg(
            role: 'assistant',
            content: e is ApiException ? e.message : e.toString(),
            isError: true,
          ),
        );
      });
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollToEnd();
    }
  }

  Future<void> _approveSelected() async {
    if (_busy) return;
    final pending =
        _proposals.where((p) => p.selected && p.status == null).toList();
    if (pending.isEmpty) return;
    setState(() => _busy = true);
    final approved = <String>{};
    final failed = <String>[];
    for (final p in pending) {
      try {
        await HospitalStaffRepository.createShift(
          affiliationId: p.raw['affiliationId']?.toString() ?? '',
          shiftDate: p.date,
          startTime: p.raw['startTime']?.toString() ?? '',
          endTime: p.raw['endTime']?.toString() ?? '',
          boothId: p.raw['boothId']?.toString(),
          boothOrStation: p.raw['boothOrStation']?.toString(),
          notes: p.raw['notes']?.toString() ??
              'Approved via Staff Scheduling Agent',
        );
        approved.add(p.id);
      } catch (_) {
        failed.add(p.staffName);
      }
    }
    setState(() {
      for (final p in _proposals) {
        if (approved.contains(p.id)) {
          p.status = 'approved';
          p.selected = false;
        }
      }
      _busy = false;
    });

    final left = _proposals.where((p) => p.status == null).length;
    if (_workflowId != null && left == 0 && failed.isEmpty) {
      await HospitalStaffRepository.recordAgentDecision(
        workflowId: _workflowId!,
        approved: true,
        note: 'Approved selected shifts from mobile scheduling agent',
      );
      _workflowId = null;
    }

    if (failed.isNotEmpty) {
      _toast('Could not create: ${failed.join(', ')}');
    } else {
      _toast(
        '${approved.length} shift${approved.length == 1 ? '' : 's'} created.',
      );
    }
  }

  Future<void> _decline(ShiftProposalItem p) async {
    setState(() {
      p.status = 'declined';
      p.selected = false;
    });
    try {
      final payload = jsonEncode({
        'affiliationId': p.raw['affiliationId'],
        'gapId': p.raw['gapId'],
        'shiftDate': p.date,
        'startTime': p.raw['startTime'],
        'endTime': p.raw['endTime'],
        'requestAlternative': p.raw['gapId'] != null,
      });
      final res = await HospitalStaffRepository.chatSchedulingAgent(
        messages: [
          {'role': 'user', 'content': '__shift_declined__ $payload'},
        ],
      );
      final alts = _extractProposals(res);
      if (alts.isNotEmpty) {
        setState(() {
          _proposals.addAll(alts.map(ShiftProposalItem.new));
          _messages.add(
            const _ChatMsg(
              role: 'assistant',
              content: 'Suggested an alternative for the declined shift.',
            ),
          );
        });
      }
    } catch (_) {}
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final pending = _proposals.where((p) => p.status == null).toList();
    final selectedCount = pending.where((p) => p.selected).length;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName ?? 'Hospital',
        subtitle: 'Staff scheduling agent',
        photoUrl: _logoUrl,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _suggestWeek(),
                    icon: const Icon(Icons.auto_awesome, size: 18),
                    label: const Text('Suggest week'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy || pending.isEmpty
                        ? null
                        : () => _suggestWeek(reroll: true),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Reroll'),
                  ),
                ),
              ],
            ),
          ),
          if (pending.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: FilledButton.icon(
                onPressed: _busy ? null : _openCompare,
                style: FilledButton.styleFrom(
                  backgroundColor: StaffSurfaces.cta,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                icon: const Icon(Icons.compare_arrows_rounded, size: 20),
                label: Text(
                  'Compare week ($selectedCount selected)',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ),
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              children: [
                ..._messages.map(_bubble),
                if (_busy)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Center(
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.4),
                      ),
                    ),
                  ),
                if (pending.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${pending.length} suggestion${pending.length == 1 ? '' : 's'} ready — open Compare week to review Current vs Suggested by day.',
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: StaffSurfaces.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      enabled: !_busy,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendChat(),
                      decoration: InputDecoration(
                        hintText: 'Ask the scheduling agent…',
                        filled: true,
                        fillColor: StaffSurfaces.softPanel,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: StaffSurfaces.cardBorder,
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: StaffSurfaces.cardBorder,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _busy ? null : _sendChat,
                    style: IconButton.styleFrom(
                      backgroundColor: StaffSurfaces.cta,
                      foregroundColor: Colors.white,
                    ),
                    icon: const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _bubble(_ChatMsg m) {
    final isUser = m.role == 'user';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        decoration: BoxDecoration(
          color: m.isError
              ? AppColors.errorBg
              : isUser
                  ? StaffSurfaces.cta
                  : StaffSurfaces.cardBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: m.isError
                ? AppColors.error.withValues(alpha: 0.35)
                : isUser
                    ? StaffSurfaces.cta
                    : StaffSurfaces.cardBorder,
          ),
        ),
        child: Text(
          m.content,
          style: TextStyle(
            fontSize: 13.5,
            height: 1.35,
            fontWeight: FontWeight.w500,
            color: m.isError
                ? AppColors.error
                : isUser
                    ? Colors.white
                    : StaffSurfaces.textPrimary,
          ),
        ),
      ),
    );
  }

}

extension on String {
  String ifEmpty(String fallback) => trim().isEmpty ? fallback : this;
}
