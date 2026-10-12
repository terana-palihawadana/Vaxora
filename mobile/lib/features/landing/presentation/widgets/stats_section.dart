import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../../core/constants/app_assets.dart';
import '../../../../core/theme/app_colors.dart';

class StatItem {
  final String iconPath;
  final String highlight;
  final String subtext;

  const StatItem({
    required this.iconPath,
    required this.highlight,
    required this.subtext,
  });
}

class StatsSection extends StatelessWidget {
  const StatsSection({super.key});

  static const List<StatItem> stats = [
    StatItem(
      iconPath: AppAssets.badgeExperience,
      highlight: 'Verified staff',
      subtext: 'Ministry approved',
    ),
    StatItem(
      iconPath: AppAssets.networkMembers,
      highlight: 'AI booking',
      subtext: 'Finds your slot',
    ),
    StatItem(
      iconPath: AppAssets.hospitalDoctors,
      highlight: 'Live booth queue',
      subtext: 'Arrival to discharge',
    ),
    StatItem(
      iconPath: AppAssets.chartReviews,
      highlight: 'Digital records',
      subtext: 'Every dose on file',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: stats.length,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.2,
        ),
        itemBuilder: (context, index) {
          final item = stats[index];
          return Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.borderLight, width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDark.withValues(alpha: 0.04),
                  blurRadius: 12,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SvgPicture.asset(item.iconPath, width: 28, height: 28),
                const Spacer(),
                Text(
                  item.highlight,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textTitle,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  item.subtext,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
