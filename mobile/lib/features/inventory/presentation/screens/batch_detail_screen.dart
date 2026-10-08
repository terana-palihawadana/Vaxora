import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/batch_model.dart';
import '../../data/repositories/inventory_repository.dart';
import '../../data/models/audit_entry_model.dart';
import 'issue_stock_screen.dart';
import 'wastage_screen.dart';

class BatchDetailScreen extends StatefulWidget {
  final BatchModel batch;
  const BatchDetailScreen({super.key, required this.batch});

  @override
  State<BatchDetailScreen> createState() => _BatchDetailScreenState();
}

class _BatchDetailScreenState extends State<BatchDetailScreen> {
  BatchModel get batch => widget.batch;
  List<AuditEntryModel> _auditEntries = [];
  bool _loadingAudit = true;

  @override
  void initState() {
    super.initState();
    _loadAudit();
  }

  Future<void> _loadAudit() async {
    final audit = await InventoryRepository.getBatchAudit(batch.id);
    if (mounted) {
      setState(() {
        _auditEntries = audit?.entries ?? [];
        _loadingAudit = false;
      });
    }
  }

  Color get _statusColor {
    if (batch.isExpired || batch.isLowStock) return AppColors.error;
    if (batch.isExpiringSoon) return AppColors.warning;
    return AppColors.success;
  }

  StaffChipTone get _tone {
    if (batch.isExpired || batch.isLowStock) return StaffChipTone.danger;
    if (batch.isExpiringSoon) return StaffChipTone.warning;
    return StaffChipTone.success;
  }

  String get _statusLabel {
    if (batch.isExpired) return 'Expired';
    if (batch.isLowStock) return 'Low stock';
    if (batch.isExpiringSoon) return 'Expiring';
    return 'Healthy';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffSurfaces.appBar(title: 'Batch details'),
      body: RefreshIndicator(
        onRefresh: _loadAudit,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 40),
          children: [
            StaffPageIntro(
              eyebrow: 'Lot ${batch.lotNumber}',
              title: batch.name,
              subtitle: batch.manufacturer,
              stats: [
                StaffIntroStat(
                  label: 'Available',
                  value: '${batch.available}',
                  icon: Icons.inventory_2_outlined,
                  accent: _statusColor,
                ),
                StaffIntroStat(
                  label: 'Received',
                  value: '${batch.capacity}',
                  icon: Icons.move_to_inbox_outlined,
                ),
                StaffIntroStat(
                  label: 'Threshold',
                  value: '${batch.minThreshold}',
                  icon: Icons.flag_outlined,
                  accent: batch.isLowStock
                      ? AppColors.error
                      : StaffSurfaces.brandSoft,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: StaffStatusChip(label: _statusLabel, tone: _tone),
            ),
            const SizedBox(height: 18),
            const StaffSectionHeader(title: 'Lot details'),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: StaffSurfaces.card(),
              child: Column(
                children: [
                  _infoRow(Icons.qr_code_2, 'Lot number', batch.lotNumber),
                  const Divider(color: StaffSurfaces.divider, height: 16),
                  _infoRow(Icons.calendar_today_outlined, 'Expiry', batch.expiry),
                  const Divider(color: StaffSurfaces.divider, height: 16),
                  _infoRow(
                    Icons.thermostat_outlined,
                    'Storage',
                    '${batch.storageUnit} · ${batch.temp}',
                  ),
                  const Divider(color: StaffSurfaces.divider, height: 16),
                  _infoRow(
                    Icons.vaccines_outlined,
                    'Doses per vial',
                    '${batch.dosesPerVial}',
                  ),
                  if (batch.lastRestocked.isNotEmpty) ...[
                    const Divider(color: StaffSurfaces.divider, height: 16),
                    _infoRow(
                      Icons.history,
                      'Last restocked',
                      batch.lastRestocked,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: batch.available == 0
                        ? null
                        : () async {
                            final nav = Navigator.of(context);
                            final result = await nav.push(
                              MaterialPageRoute(
                                builder: (_) => IssueStockScreen(batch: batch),
                              ),
                            );
                            if (result == true && mounted) {
                              nav.pop(true);
                            }
                          },
                    icon: const Icon(Icons.arrow_forward, size: 18),
                    label: const Text('Issue'),
                    style: FilledButton.styleFrom(
                      backgroundColor: StaffSurfaces.cta,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: batch.available == 0
                        ? null
                        : () async {
                            final nav = Navigator.of(context);
                            final result = await nav.push(
                              MaterialPageRoute(
                                builder: (_) => WastageScreen(batch: batch),
                              ),
                            );
                            if (result == true && mounted) {
                              nav.pop(true);
                            }
                          },
                    icon: const Icon(Icons.warning_amber_rounded, size: 18),
                    label: const Text('Wastage'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.error,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            StaffSectionHeader(
              title: 'Audit trail',
              count: _auditEntries.isEmpty ? null : _auditEntries.length,
            ),
            if (_loadingAudit)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: CircularProgressIndicator(
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              )
            else if (_auditEntries.isEmpty)
              const StaffEmptyCard(
                message: 'No transactions recorded for this lot yet.',
                icon: Icons.history,
              )
            else
              ..._auditEntries.map(_buildAuditEntry),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(icon, size: 18, color: StaffSurfaces.brandSoft),
        const SizedBox(width: 12),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12.5,
            color: StaffSurfaces.textSecondary,
          ),
        ),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: StaffSurfaces.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAuditEntry(AuditEntryModel entry) {
    final color = _colorForType(entry.type);
    final well = _wellForType(entry.type);
    final icon = _iconForType(entry.type);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: well,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: color, size: 16),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.event,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${entry.timestamp}  ·  ${entry.actor}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Color _colorForType(String type) {
    switch (type) {
      case 'restock':
        return StaffSurfaces.brandSoft;
      case 'dispense':
        return AppColors.ai;
      case 'sensor':
        return AppColors.success;
      case 'qa':
      default:
        return AppColors.info;
    }
  }

  Color _wellForType(String type) {
    switch (type) {
      case 'restock':
        return StaffSurfaces.softPanelDeep;
      case 'dispense':
        return AppColors.aiBg;
      case 'sensor':
        return AppColors.successBg;
      case 'qa':
      default:
        return AppColors.infoBg;
    }
  }

  IconData _iconForType(String type) {
    switch (type) {
      case 'restock':
        return Icons.add_box_outlined;
      case 'dispense':
        return Icons.outbox_outlined;
      case 'sensor':
        return Icons.tune;
      case 'qa':
      default:
        return Icons.assignment_turned_in_outlined;
    }
  }
}
