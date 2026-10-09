import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import 'network_avatar.dart';

/// Design tokens for every staff screen.
///
/// Surface hierarchy (one job per block):
/// - pageBg           → screen background
/// - card()           → white content blocks (lists, tiles, profile)
/// - softWell()       → tinted controls only (week strip, filters)
/// - softPanelDeep    → chips, small icon backdrops
/// - brandSoft        → icons / loaders / accent text
/// - cta              → primary filled buttons only
/// - AppColors.error  → destructive / warnings
/// - AppColors.success→ success chips / banners
class StaffSurfaces {
  static const Color pageBg = AppColors.background;
  static const Color cardBg = AppColors.surface;
  static const Color cardBorder = AppColors.borderCard;
  static const Color softPanel = Color(0xFFEAF5F2);
  static const Color softPanelDeep = Color(0xFFD9ECE7);
  static const Color accentBar = AppColors.accentTeal;
  static const Color textPrimary = AppColors.textTitle;
  static const Color textSecondary = AppColors.textMuted;
  static const Color textMutedSoft = Color(0xFF84969B);
  static const Color appBarBg = AppColors.surface;
  static const Color divider = AppColors.borderLight;
  static const Color chipNeutralBg = AppColors.surfaceSubtle;
  static const Color chipNeutralBorder = AppColors.borderCard;
  static const Color dangerBorder = AppColors.errorBorder;
  static const double cardRadius = 14;

  /// Slightly-muted brand blue for chrome (icons / loaders / accents).
  static Color get brandSoft => AppColors.brandBlue.withValues(alpha: 0.88);

  /// Full brand blue — primary filled buttons only.
  static const Color cta = AppColors.primary;

  static Color get navSelected => cta;
  static const Color navIdle = textMutedSoft;
  static Color get navSelectedBg => cta.withValues(alpha: 0.1);

  static List<BoxShadow> get cardShadow => [
        BoxShadow(
          color: textPrimary.withValues(alpha: 0.04),
          blurRadius: 10,
          offset: const Offset(0, 3),
        ),
      ];

  static BoxDecoration card({Color? color, Color? borderColor}) {
    return BoxDecoration(
      color: color ?? cardBg,
      borderRadius: BorderRadius.circular(cardRadius),
      border: Border.all(color: borderColor ?? cardBorder),
      boxShadow: cardShadow,
    );
  }

  static BoxDecoration softWell() {
    return BoxDecoration(
      color: softPanel,
      borderRadius: BorderRadius.circular(cardRadius),
      border: Border.all(color: cardBorder),
    );
  }

  /// Plain title app bar (use for Profile screen only — everything else uses
  /// [StaffScreenHeader.appBar] to show the logged-in user in the top bar).
  static PreferredSizeWidget appBar({
    required String title,
    List<Widget>? actions,
  }) {
    return AppBar(
      title: Text(
        title,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: textPrimary,
        ),
      ),
      centerTitle: false,
      backgroundColor: appBarBg,
      elevation: 0,
      scrolledUnderElevation: 0,
      iconTheme: IconThemeData(color: brandSoft),
      actionsIconTheme: IconThemeData(color: brandSoft),
      actions: actions,
      bottom: const PreferredSize(
        preferredSize: Size.fromHeight(1),
        child: Divider(height: 1, thickness: 1, color: divider),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Personalized app bar shared across staff screens.
// ---------------------------------------------------------------------------

/// AppBar for Shifts / Appointments / Affiliations screens.
///
/// Left  → circular avatar (or initials fallback)
/// Middle→ display name + subtitle (screen name / role · screen)
/// Right → action icons (refresh, etc.)
class StaffScreenHeader {
  StaffScreenHeader._();

  static PreferredSizeWidget appBar({
    required String displayName,
    required String subtitle,
    String? photoUrl,
    List<Widget>? actions,
  }) {
    return AppBar(
      titleSpacing: 16,
      title: _HeaderTitle(
        displayName: displayName,
        subtitle: subtitle,
        photoUrl: photoUrl,
      ),
      centerTitle: false,
      backgroundColor: StaffSurfaces.appBarBg,
      elevation: 0,
      scrolledUnderElevation: 0,
      iconTheme: IconThemeData(color: StaffSurfaces.brandSoft),
      actionsIconTheme: IconThemeData(color: StaffSurfaces.brandSoft),
      actions: [
        ...?actions,
        const SizedBox(width: 4),
      ],
      bottom: const PreferredSize(
        preferredSize: Size.fromHeight(1),
        child: Divider(height: 1, thickness: 1, color: StaffSurfaces.divider),
      ),
    );
  }
}

class _HeaderTitle extends StatelessWidget {
  final String displayName;
  final String subtitle;
  final String? photoUrl;

  const _HeaderTitle({
    required this.displayName,
    required this.subtitle,
    this.photoUrl,
  });

  String get _initials {
    final parts = displayName
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty || displayName == 'there') return '?';
    if (parts.length == 1) {
      final w = parts.first;
      return w.substring(0, w.length >= 2 ? 2 : 1).toUpperCase();
    }
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: StaffSurfaces.cardBorder),
          ),
          clipBehavior: Clip.antiAlias,
          child: NetworkAvatar(
            url: photoUrl,
            size: 38,
            fallback: Container(
              color: StaffSurfaces.softPanelDeep,
              alignment: Alignment.center,
              child: Text(
                _initials,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.brandSoft,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                displayName == 'there' ? 'Welcome' : displayName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textPrimary,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w500,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Circle-button style wrapper for app-bar action icons — gives every screen
/// the same tap target + hit color.
class StaffHeaderAction extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final int badgeCount;

  const StaffHeaderAction({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.badgeCount = 0,
  });

  @override
  Widget build(BuildContext context) {
    final button = Material(
      color: StaffSurfaces.softPanel,
      shape: const CircleBorder(),
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        icon: Icon(icon, color: StaffSurfaces.brandSoft, size: 20),
        splashRadius: 22,
      ),
    );

    if (badgeCount <= 0) {
      return Padding(
        padding: const EdgeInsets.only(right: 6),
        child: button,
      );
    }

    final label = badgeCount > 9 ? '9+' : '$badgeCount';
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          button,
          Positioned(
            right: 2,
            top: 2,
            child: IgnorePointer(
              child: Container(
                constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                decoration: const BoxDecoration(
                  color: AppColors.error,
                  borderRadius: BorderRadius.all(Radius.circular(999)),
                ),
                alignment: Alignment.center,
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    height: 1.1,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Screen intro (title + subtitle + optional stat strip).
// ---------------------------------------------------------------------------

class StaffPageIntro extends StatelessWidget {
  final String eyebrow;
  final String title;
  final String subtitle;
  final List<StaffIntroStat> stats;

  const StaffPageIntro({
    super.key,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    this.stats = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            eyebrow.toUpperCase(),
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: StaffSurfaces.brandSoft,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: StaffSurfaces.textPrimary,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12.5,
              color: StaffSurfaces.textSecondary,
              height: 1.35,
            ),
          ),
          if (stats.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                for (var i = 0; i < stats.length; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  Expanded(child: _StatTile(stat: stats[i])),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class StaffIntroStat {
  final String label;
  final String value;
  final IconData? icon;
  final Color? accent;

  const StaffIntroStat({
    required this.label,
    required this.value,
    this.icon,
    this.accent,
  });
}

class _StatTile extends StatelessWidget {
  final StaffIntroStat stat;

  const _StatTile({required this.stat});

  @override
  Widget build(BuildContext context) {
    final accent = stat.accent ?? StaffSurfaces.brandSoft;
    final tinted = stat.accent != null;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
      decoration: BoxDecoration(
        color: tinted ? accent.withValues(alpha: 0.08) : StaffSurfaces.softPanel,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: tinted
              ? accent.withValues(alpha: 0.22)
              : StaffSurfaces.cardBorder,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (stat.icon != null) ...[
                Icon(stat.icon, size: 14, color: accent),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  stat.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: StaffSurfaces.textSecondary,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            stat.value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: accent,
              height: 1.1,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section header for grouped lists.
// ---------------------------------------------------------------------------

class StaffSectionHeader extends StatelessWidget {
  final String title;
  final int? count;
  final Widget? trailing;

  const StaffSectionHeader({
    super.key,
    required this.title,
    this.count,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 4),
      child: Row(
        children: [
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          if (count != null) ...[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: StaffSurfaces.softPanelDeep,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$count',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.brandSoft,
                ),
              ),
            ),
          ],
          const Spacer(),
          ?trailing,
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Banners & empty states.
// ---------------------------------------------------------------------------

class StaffErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback onDismiss;

  const StaffErrorBanner({
    super.key,
    required this.message,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.errorBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.error,
              ),
            ),
          ),
          IconButton(
            onPressed: onDismiss,
            icon: const Icon(Icons.close, size: 18, color: AppColors.error),
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}

class StaffEmptyCard extends StatelessWidget {
  final String message;
  final IconData icon;
  final bool compact;

  const StaffEmptyCard({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: StaffSurfaces.card(),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: StaffSurfaces.softPanelDeep,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: StaffSurfaces.brandSoft, size: 18),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w500,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      decoration: StaffSurfaces.card(),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: StaffSurfaces.softPanelDeep,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: StaffSurfaces.brandSoft, size: 24),
          ),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: StaffSurfaces.textSecondary,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Common building blocks.
// ---------------------------------------------------------------------------

class StaffHospitalAvatar extends StatelessWidget {
  final String? logoUrl;
  final double size;

  const StaffHospitalAvatar({
    super.key,
    this.logoUrl,
    this.size = 44,
  });

  @override
  Widget build(BuildContext context) {
    final url = logoUrl?.trim();
    if (url != null && url.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: NetworkAvatar(
          url: url,
          size: size,
          fallback: _fallback(),
        ),
      );
    }
    return _fallback();
  }

  Widget _fallback() {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: StaffSurfaces.softPanelDeep,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: StaffSurfaces.cardBorder),
      ),
      child: Icon(
        Icons.local_hospital_outlined,
        color: StaffSurfaces.brandSoft,
        size: size * 0.48,
      ),
    );
  }
}

enum StaffChipTone { neutral, brand, success, warning, danger }

class StaffStatusChip extends StatelessWidget {
  final String label;
  final StaffChipTone tone;
  final IconData? icon;

  const StaffStatusChip({
    super.key,
    required this.label,
    this.tone = StaffChipTone.neutral,
    this.icon,
  });

  /// Legacy positional convenience — keeps older call sites working.
  const StaffStatusChip.positive({super.key, required this.label, this.icon})
      : tone = StaffChipTone.brand;

  ({Color bg, Color border, Color fg}) get _palette {
    switch (tone) {
      case StaffChipTone.brand:
        return (
          bg: StaffSurfaces.softPanelDeep,
          border: StaffSurfaces.cardBorder,
          fg: StaffSurfaces.brandSoft,
        );
      case StaffChipTone.success:
        return (
          bg: AppColors.successBg,
          border: AppColors.success.withValues(alpha: 0.3),
          fg: AppColors.success,
        );
      case StaffChipTone.warning:
        return (
          bg: AppColors.warningBg,
          border: AppColors.warningBorder,
          fg: AppColors.warning,
        );
      case StaffChipTone.danger:
        return (
          bg: AppColors.errorBg,
          border: AppColors.error.withValues(alpha: 0.3),
          fg: AppColors.error,
        );
      case StaffChipTone.neutral:
        return (
          bg: StaffSurfaces.chipNeutralBg,
          border: StaffSurfaces.chipNeutralBorder,
          fg: StaffSurfaces.textSecondary,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _palette;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: icon == null ? 10 : 8,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: p.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: p.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: p.fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: p.fg,
            ),
          ),
        ],
      ),
    );
  }
}

/// Chip for a shift that has a pending, assigned, or declined cover request.
class ShiftCoverStatusChip extends StatelessWidget {
  final String status;
  final String? label;

  const ShiftCoverStatusChip({
    super.key,
    required this.status,
    this.label,
  });

  static Widget? maybe({String? status, String? label}) {
    final raw = status?.trim();
    if (raw == null || raw.isEmpty) return null;
    return ShiftCoverStatusChip(status: raw, label: label);
  }

  @override
  Widget build(BuildContext context) {
    final key = status.toLowerCase();
    final (chipLabel, tone, icon) = switch (key) {
      'requested' => (
          label?.trim().isNotEmpty == true ? label!.trim() : 'Cover requested',
          StaffChipTone.warning,
          Icons.hourglass_top_outlined,
        ),
      'covering' => (
          label?.trim().isNotEmpty == true ? label!.trim() : 'Covering',
          StaffChipTone.success,
          Icons.swap_horiz,
        ),
      'declined' => (
          label?.trim().isNotEmpty == true ? label!.trim() : 'Cover declined',
          StaffChipTone.danger,
          Icons.highlight_off,
        ),
      _ => (
          label?.trim().isNotEmpty == true ? label!.trim() : 'Cover',
          StaffChipTone.neutral,
          Icons.swap_horiz,
        ),
    };

    return StaffStatusChip(label: chipLabel, tone: tone, icon: icon);
  }
}

// ---------------------------------------------------------------------------
// Bottom navigation (same chrome as staff main).
// ---------------------------------------------------------------------------

class StaffNavDestination {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final int badgeCount;

  const StaffNavDestination({
    required this.icon,
    required this.activeIcon,
    required this.label,
    this.badgeCount = 0,
  });
}

class StaffBottomNav extends StatelessWidget {
  final int index;
  final ValueChanged<int> onSelect;
  final List<StaffNavDestination> destinations;

  const StaffBottomNav({
    super.key,
    required this.index,
    required this.onSelect,
    required this.destinations,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: StaffSurfaces.appBarBg,
        border: const Border(
          top: BorderSide(color: StaffSurfaces.divider, width: 1),
        ),
        boxShadow: [
          BoxShadow(
            color: StaffSurfaces.textPrimary.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (var i = 0; i < destinations.length; i++)
                _StaffNavItem(
                  destination: destinations[i],
                  selected: index == i,
                  onTap: () => onSelect(i),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StaffNavItem extends StatelessWidget {
  final StaffNavDestination destination;
  final bool selected;
  final VoidCallback onTap;

  const _StaffNavItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color =
        selected ? StaffSurfaces.navSelected : StaffSurfaces.navIdle;

    Widget iconWidget = Icon(
      selected ? destination.activeIcon : destination.icon,
      color: color,
      size: 22,
    );

    if (destination.badgeCount > 0) {
      iconWidget = Badge(
        label: Text(
          destination.badgeCount > 9 ? '9+' : '${destination.badgeCount}',
        ),
        backgroundColor: AppColors.error,
        child: iconWidget,
      );
    }

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? StaffSurfaces.navSelectedBg
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            iconWidget,
            const SizedBox(height: 4),
            Text(
              destination.label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Confirm dialog matching patient Log out? styling.
/// Returns `true` only when the user taps the confirm action.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  String cancelLabel = 'Cancel',
  String confirmLabel = 'Confirm',
  bool destructive = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: StaffSurfaces.cardBg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
      ),
      title: Text(
        title,
        style: TextStyle(
          fontWeight: FontWeight.w700,
          color: destructive ? AppColors.error : StaffSurfaces.textPrimary,
        ),
      ),
      content: Text(
        message,
        style: const TextStyle(
          fontSize: 13.5,
          height: 1.4,
          color: StaffSurfaces.textSecondary,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: Text(
            cancelLabel,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: StaffSurfaces.textSecondary,
            ),
          ),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          style: FilledButton.styleFrom(
            backgroundColor:
                destructive ? AppColors.error : StaffSurfaces.cta,
            elevation: 0,
          ),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return ok == true;
}
