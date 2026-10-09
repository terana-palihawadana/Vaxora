import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../services/care_plan_storage_service.dart';
import 'care_plan_sheet.dart';

/// Shows the locally-stored care plan history (last 10 generated plans).
class CarePlanHistorySheet {
  static Future<void> show(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      isDismissible: true,
      builder: (_) => const _CarePlanHistorySheet(),
    );
  }
}

class _CarePlanHistorySheet extends StatefulWidget {
  const _CarePlanHistorySheet();

  @override
  State<_CarePlanHistorySheet> createState() => _CarePlanHistorySheetState();
}

class _CarePlanHistorySheetState extends State<_CarePlanHistorySheet> {
  List<SavedCarePlan> _history = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final list = await CarePlanStorageService.getHistory();
    if (!mounted) return;
    setState(() {
      _history = list;
      _isLoading = false;
    });
  }

  Future<void> _openPlan(SavedCarePlan saved) async {
    // Do NOT pop first — we want the user to be able to come back to the
    // history sheet after closing the plan. Instead, push the plan sheet
    // on top, await its dismissal, then reload (in case of deletion).
    await CarePlanSheet.show(
      context,
      loader: () async => saved.result,
      saveToHistory: false, // critical — prevents duplicates
    );
    // Reload in case anything changed while the plan sheet was open
    await _load();
  }

  Future<void> _deleteAt(int index) async {
    await CarePlanStorageService.removeAt(index);
    await _load();
  }

  Future<void> _clearAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Clear Care Plan History?',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        content: const Text(
          'This will delete all locally-saved care plans on this device. '
          'The plans on the server (if any) are not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text(
              'Clear All',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await CarePlanStorageService.clear();
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.of(context).size.height * 0.85;

    return Container(
      height: height,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 6),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.borderCard,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 6, 12, 10),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: const Text('📚', style: TextStyle(fontSize: 20)),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Care Plan History',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textTitle,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Your last 10 generated plans, stored on this device',
                        style: TextStyle(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_history.isNotEmpty)
                  IconButton(
                    tooltip: 'Clear all',
                    icon: const Icon(
                      Icons.delete_sweep_outlined,
                      color: AppColors.textMuted,
                    ),
                    onPressed: _clearAll,
                  ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppColors.textMuted),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.borderLight),
          Expanded(
            child: _isLoading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: AppColors.brandBlue,
                    ),
                  )
                : _history.isEmpty
                ? _buildEmpty()
                : _buildList(),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history, size: 56, color: AppColors.textMuted),
            SizedBox(height: 14),
            Text(
              'No saved care plans yet',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textTitle,
              ),
            ),
            SizedBox(height: 6),
            Text(
              'Generate your first AI Care Plan from the dashboard — it will be saved here automatically.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: _history.length,
      itemBuilder: (context, i) {
        final saved = _history[i];
        final plan = saved.result.carePlan;
        final summary = saved.result.patientSummary;
        final name = summary?.demographics['name']?.toString() ?? 'Patient';
        final warningCount = plan?.warnings.length ?? 0;
        final actionCount = plan?.immediateActions.length ?? 0;
        final hasCritical =
            plan?.warnings.any((w) => w.severity.toLowerCase() == 'critical') ??
            false;

        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => _openPlan(saved),
              onLongPress: () => _confirmDelete(i),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.borderLight, width: 1.5),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            name,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textTitle,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (hasCritical)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.errorBg,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Text(
                              '⚠ CRITICAL',
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w800,
                                color: AppColors.error,
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Generated ${_formatDate(saved.savedAt)}',
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.textMuted,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _chip('$actionCount actions', AppColors.brandBlue),
                        const SizedBox(width: 6),
                        _chip(
                          '$warningCount warnings',
                          AppColors.warning,
                        ),
                        const Spacer(),
                        const Icon(
                          Icons.chevron_right,
                          size: 18,
                          color: AppColors.textMuted,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmDelete(int index) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Delete this plan?',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        content: const Text('Remove this care plan from your local history?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text(
              'Delete',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true) await _deleteAt(index);
  }

  Widget _chip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
  }
}
