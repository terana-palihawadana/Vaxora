import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/batch_model.dart';
import '../providers/inventory_provider.dart';
import 'batch_detail_screen.dart';

class HospitalAlertsScreen extends StatelessWidget {
  const HospitalAlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const _AlertsBody();
  }
}

class _AlertsBody extends StatefulWidget {
  const _AlertsBody();

  @override
  State<_AlertsBody> createState() => _AlertsBodyState();
}

class _AlertsBodyState extends State<_AlertsBody> {
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
            user['logoUrl']?.toString(),
      );
    });
  }

  StaffChipTone _toneFor(String type) {
    switch (type) {
      case 'expired':
      case 'low':
        return StaffChipTone.danger;
      default:
        return StaffChipTone.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<InventoryProvider>();
    final expired = provider.batches.where((b) => b.isExpired).toList();
    final expiring = provider.batches.where((b) => b.isExpiringSoon).toList();
    final lowStock =
        provider.batches.where((b) => b.isLowStock && !b.isExpired).toList();
    final total = expired.length + expiring.length + lowStock.length;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Inventory · Alerts',
        photoUrl: _logoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: provider.isLoading ? null : provider.refresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: provider.refresh,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Cold chain',
              title: total == 0 ? 'All clear' : 'Stock alerts',
              subtitle: total == 0
                  ? 'No expired, expiring, or low-stock batches.'
                  : '$total batch${total == 1 ? '' : 'es'} need a decision.',
              stats: [
                StaffIntroStat(
                  label: 'Expired',
                  value: '${expired.length}',
                  icon: Icons.dangerous_outlined,
                  accent: expired.isNotEmpty
                      ? AppColors.error
                      : AppColors.success,
                ),
                StaffIntroStat(
                  label: 'Expiring',
                  value: '${expiring.length}',
                  icon: Icons.hourglass_bottom,
                  accent: expiring.isNotEmpty
                      ? AppColors.warning
                      : AppColors.success,
                ),
                StaffIntroStat(
                  label: 'Low',
                  value: '${lowStock.length}',
                  icon: Icons.trending_down,
                  accent: lowStock.isNotEmpty
                      ? AppColors.error
                      : AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 18),
            if (provider.isLoading && provider.batches.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              )
            else if (total == 0)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
                decoration: StaffSurfaces.card(
                  color: AppColors.successBg,
                  borderColor: AppColors.success.withValues(alpha: 0.28),
                ),
                child: const Column(
                  children: [
                    Icon(Icons.check_circle_outline, color: AppColors.success, size: 28),
                    SizedBox(height: 12),
                    Text(
                      'Inventory alerts will show here when lots need action.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: StaffSurfaces.textSecondary,
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              )
            else ...[
              if (expired.isNotEmpty) ...[
                StaffSectionHeader(title: 'Expired', count: expired.length),
                ...expired.map((b) => _alertTile(context, b, 'expired')),
              ],
              if (expiring.isNotEmpty) ...[
                StaffSectionHeader(title: 'Expiring soon', count: expiring.length),
                ...expiring.map((b) => _alertTile(context, b, 'expiring')),
              ],
              if (lowStock.isNotEmpty) ...[
                StaffSectionHeader(title: 'Low stock', count: lowStock.length),
                ...lowStock.map((b) => _alertTile(context, b, 'low')),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _alertTile(BuildContext context, BatchModel batch, String type) {
    final message = type == 'expired'
        ? 'Expired on ${batch.expiry}'
        : type == 'expiring'
            ? 'Expires on ${batch.expiry}'
            : 'Below threshold (${batch.minThreshold} min)';

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => BatchDetailScreen(batch: batch)),
            );
          },
          borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: StaffSurfaces.card(
              borderColor: type == 'expiring'
                  ? AppColors.warningBorder
                  : AppColors.error.withValues(alpha: 0.3),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: type == 'expiring'
                        ? AppColors.warningBg
                        : AppColors.errorBg,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    type == 'expired'
                        ? Icons.dangerous_outlined
                        : type == 'expiring'
                            ? Icons.hourglass_bottom
                            : Icons.trending_down,
                    size: 18,
                    color: type == 'expiring'
                        ? AppColors.warning
                        : AppColors.error,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        batch.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Lot ${batch.lotNumber}  ·  ${batch.available} vials',
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        message,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                StaffStatusChip(
                  label: type == 'expired'
                      ? 'Expired'
                      : type == 'expiring'
                          ? 'Expiring'
                          : 'Low stock',
                  tone: _toneFor(type),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
