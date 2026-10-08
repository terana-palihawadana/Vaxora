import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';

class ImmunizationTimelineItem extends StatelessWidget {
  final IconData icon;
  final String name;
  final String target;
  final String status;
  final String date;

  const ImmunizationTimelineItem({
    super.key,
    required this.icon,
    required this.name,
    required this.target,
    required this.status,
    required this.date,
  });

  StaffChipTone get _tone {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'confirmed':
        return StaffChipTone.success;
      case 'cancelled':
        return StaffChipTone.danger;
      case 'due soon':
      case 'pending':
        return StaffChipTone.warning;
      default:
        return StaffChipTone.brand;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: switch (_tone) {
                StaffChipTone.success => AppColors.successBg,
                StaffChipTone.warning => AppColors.warningBg,
                StaffChipTone.danger => AppColors.errorBg,
                _ => StaffSurfaces.softPanelDeep,
              },
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Icon(
              icon,
              size: 18,
              color: switch (_tone) {
                StaffChipTone.success => AppColors.success,
                StaffChipTone.warning => AppColors.warning,
                StaffChipTone.danger => AppColors.error,
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
                  name,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  target,
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              StaffStatusChip(label: status, tone: _tone),
              const SizedBox(height: 4),
              Text(
                date,
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  color: StaffSurfaces.textMutedSoft,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
