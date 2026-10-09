import 'package:flutter/material.dart';

import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/inventory_agent_models.dart';
import '../../data/repositories/inventory_agent_repository.dart';

class HospitalAiScreen extends StatefulWidget {
  const HospitalAiScreen({super.key});
  @override
  State<HospitalAiScreen> createState() => _HospitalAiScreenState();
}

class _HospitalAiScreenState extends State<HospitalAiScreen> {
  bool _busy = false;
  InventoryAgentRun? _run;
  String? _error;
  String? _success;
  String _hospitalName = 'Hospital';
  String? _logoUrl;

  @override
  void initState() {
    super.initState();
    _loadHeader();
  }

  Future<void> _loadHeader() async {
    final user = await StorageService.getUser();
    if (!mounted || user == null) return;
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

  Future<void> _runAgent(String targetAgent, String prompt) async {
    setState(() {
      _busy = true;
      _error = null;
      _success = null;
      _run = null;
    });
    try {
      final run = await InventoryAgentRepository.run(
        targetAgent: targetAgent,
        prompt: prompt,
      );
      if (!mounted) return;
      setState(() => _run = run);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approve() async {
    final run = _run;
    if (run == null) return;

    // Build line_items from proposal.proposals (Python side returns them there)
    final lineItems = run.proposals
        .map(
          (p) => {
            'vaccine_id': p['vaccine_id'],
            'vaccine_name': p['vaccine_name'] ?? '',
            'quantity': (p['recommended_quantity'] as num?)?.toInt() ?? 0,
            'unit_price_lkr': 0,
            'total_lkr': 0,
          },
        )
        .toList();

    if (lineItems.isEmpty) {
      setState(() => _error = 'No proposals to approve.');
      return;
    }

    final ok = await confirmAction(
      context,
      title: 'Approve AI purchase draft?',
      message:
          'Execute this draft with ${lineItems.length} line item'
          '${lineItems.length == 1 ? '' : 's'}? Stock changes will be applied.',
      confirmLabel: 'Approve',
    );
    if (!ok || !mounted) return;

    final poNumber = 'AI-PO-${DateTime.now().millisecondsSinceEpoch}';

    final payload = {
      'po_number': poNumber,
      'line_items': lineItems,
      'total_lkr': 0,
    };

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final res = await InventoryAgentRepository.approveDraft(
        run.workflowId,
        draft: InventoryAgentDraft(
          type: 'purchase_order',
          documentNumber: poNumber,
          summary: '',
          payload: payload,
        ),
      );
      if (!mounted) return;
      setState(() {
        _success = res.message.isEmpty ? 'Draft executed.' : res.message;
        _run = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject() async {
    final ok = await confirmAction(
      context,
      title: 'Discard AI draft?',
      message: 'Clear this proposal without executing it?',
      confirmLabel: 'Discard',
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() {
      _run = null;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Inventory AI',
        photoUrl: _logoUrl,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
        children: [
          _header(),
          const SizedBox(height: 20),
          _actionCard(
            icon: Icons.trending_down,
            title: 'Suggest Restocks',
            description:
                'Analyze stock levels and generate a draft purchase order',
            color: AppColors.brandBlue,
            onTap: _busy
                ? null
                : () => _runAgent(
                    'RestockAgent',
                    'Analyze current inventory and suggest restocks for anything at or below its minimum threshold.',
                  ),
          ),
          const SizedBox(height: 12),
          _actionCard(
            icon: Icons.hourglass_bottom,
            title: 'Scan Expiring Batches',
            description:
                'Find batches nearing expiry and generate a rescue memo',
            color: const Color(0xFFD97706),
            onTap: _busy
                ? null
                : () => _runAgent(
                    'ExpiryAgent',
                    'Scan batches expiring within 60 days and propose priority actions.',
                  ),
          ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            _banner(
              _error!,
              const Color(0xFFDC2626),
              const Color(0xFFFEF2F2),
              Icons.error_outline,
            ),
          if (_success != null)
            _banner(
              _success!,
              const Color(0xFF16A34A),
              const Color(0xFFF0FDF4),
              Icons.check_circle_outline,
            ),
          if (_run != null) _runResult(_run!),
        ],
      ),
    );
  }

  Widget _header() => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: const Color(0xFFEDE9F8),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xFFDCD4F0)),
    ),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.smart_toy, color: Color(0xFF6D5BAE), size: 26),
            SizedBox(width: 10),
            Text(
              'Inventory AI Assistant',
              style: TextStyle(
                color: Color(0xFF3F356E),
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        SizedBox(height: 8),
        Text(
          'Run an agent to draft purchase orders or rescue plans for expiring batches. All drafts require your approval before anything changes.',
          style: TextStyle(color: Color(0xFF685D86), fontSize: 13, height: 1.4),
        ),
      ],
    ),
  );

  Widget _actionCard({
    required IconData icon,
    required String title,
    required String description,
    required Color color,
    required VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppTextStyles.bodyBold),
                  const SizedBox(height: 2),
                  Text(description, style: AppTextStyles.caption),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_ios,
              size: 14,
              color: AppColors.textMuted,
            ),
          ],
        ),
      ),
    );
  }

  Widget _banner(String msg, Color fg, Color bg, IconData icon) => Container(
    margin: const EdgeInsets.only(top: 12),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: fg.withValues(alpha: 0.4)),
    ),
    child: Row(
      children: [
        Icon(icon, color: fg, size: 20),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            msg,
            style: TextStyle(
              color: fg,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _runResult(InventoryAgentRun run) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Assistant reply
        Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.smart_toy_outlined,
                    color: Color(0xFF7C3AED),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Text(run.agentName, style: AppTextStyles.bodyBold),
                ],
              ),
              if (run.content.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  run.content,
                  style: const TextStyle(fontSize: 13, height: 1.45),
                ),
              ],
            ],
          ),
        ),

        // Draft approval card
        if (run.hasDraft) ...[
          const SizedBox(height: 12),
          _draftCard(run),
        ] else ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFF5F8F7),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.borderLight),
            ),
            child: const Row(
              children: [
                Icon(
                  Icons.check_circle_outline,
                  color: Color(0xFF16A34A),
                  size: 20,
                ),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'No action needed right now.',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _draftCard(InventoryAgentRun run) {
    final isPo =
        run.proposals.isNotEmpty || (run.draft?.isPurchaseOrder ?? false);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: (isPo ? AppColors.brandBlue : const Color(0xFFD97706))
              .withValues(alpha: 0.35),
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isPo ? Icons.shopping_cart_outlined : Icons.event_note_outlined,
                color: isPo ? AppColors.brandBlue : const Color(0xFFD97706),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  isPo ? 'Draft Purchase Order' : 'Draft Expiry Memo',
                  style: AppTextStyles.bodyBold,
                ),
              ),
            ],
          ),

          // Reference line
          if (run.draft?.documentNumber.isNotEmpty == true) ...[
            const SizedBox(height: 6),
            Text(
              'Ref: ${run.draft!.documentNumber}',
              style: AppTextStyles.caption,
            ),
          ] else if (run.proposals.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              'Ref: AI purchase order — ${run.proposals.length} item(s)',
              style: AppTextStyles.caption,
            ),
          ],

          // Summary or proposal list
          if (run.draft?.summary.isNotEmpty == true) ...[
            const SizedBox(height: 10),
            Text(
              run.draft!.summary,
              style: const TextStyle(fontSize: 13, height: 1.4),
            ),
          ] else if (run.proposals.isNotEmpty) ...[
            const SizedBox(height: 10),
            ...run.proposals.map(
              (p) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '• ${p['vaccine_name']} — ${p['recommended_quantity']} vials',
                  style: const TextStyle(fontSize: 13, height: 1.4),
                ),
              ),
            ),
          ],

          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : _reject,
                  child: const Text('Reject'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _busy ? null : _approve,
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Approve'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isPo
                        ? AppColors.brandBlue
                        : const Color(0xFFD97706),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
