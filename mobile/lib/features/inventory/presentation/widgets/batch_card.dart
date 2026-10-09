import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/batch_model.dart';

class BatchCard extends StatelessWidget {
  final BatchModel batch;
  final VoidCallback onTap;

  const BatchCard({super.key, required this.batch, required this.onTap});

  StaffChipTone get _tone {
    if (batch.isExpired || batch.isLowStock) return StaffChipTone.danger;
    if (batch.isExpiringSoon) return StaffChipTone.warning;
    return StaffChipTone.success;
  }

  String get _label {
    if (batch.isExpired) return 'Expired';
    if (batch.isLowStock) return 'Low stock';
    if (batch.isExpiringSoon) return 'Expiring';
    return 'Healthy';
  }

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
              borderColor: switch (_tone) {
                StaffChipTone.danger => AppColors.error.withValues(alpha: 0.28),
                StaffChipTone.warning => AppColors.warningBorder,
                _ => AppColors.success.withValues(alpha: 0.28),
              },
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        batch.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ),
                    StaffStatusChip(label: _label, tone: _tone),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Lot ${batch.lotNumber}  ·  Expiry ${batch.expiry}',
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: batch.stockPercent.clamp(0.0, 1.0),
                    minHeight: 6,
                    backgroundColor: StaffSurfaces.softPanelDeep,
                    color: _tone == StaffChipTone.danger
                        ? AppColors.error
                        : (_tone == StaffChipTone.warning
                            ? AppColors.warning
                            : AppColors.success),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '${batch.available} / ${batch.capacity} vials',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
