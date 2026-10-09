import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../providers/inventory_provider.dart';
import 'batch_detail_screen.dart';
import 'hospital_ai_screen.dart';
import 'hospital_alerts_screen.dart';
import 'qr_scanner_screen.dart';
import '../widgets/batch_card.dart';
import 'formulary_screen.dart';
import 'restock_screen.dart';

class InventoryHomeScreen extends StatefulWidget {
  const InventoryHomeScreen({super.key});

  @override
  State<InventoryHomeScreen> createState() => _InventoryHomeScreenState();
}

class _InventoryHomeScreenState extends State<InventoryHomeScreen> {
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

  Future<void> _openAlerts() async {
    final provider = context.read<InventoryProvider>();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChangeNotifierProvider.value(
          value: provider,
          child: const HospitalAlertsScreen(),
        ),
      ),
    );
    if (mounted) await provider.refresh();
  }

  Future<void> _openAi() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const HospitalAiScreen()),
    );
  }

  Future<void> _openScanner() async {
    final provider = context.read<InventoryProvider>();
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const QrScannerScreen()),
    );
    if (mounted) await provider.refresh();
  }

  Future<void> _openFormulary() async {
    final provider = context.read<InventoryProvider>();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChangeNotifierProvider.value(
          value: provider,
          child: const FormularyScreen(),
        ),
      ),
    );
    if (mounted) await provider.refresh();
  }

  Future<void> _openRestock() async {
    final provider = context.read<InventoryProvider>();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChangeNotifierProvider.value(
          value: provider,
          child: const RestockScreen(),
        ),
      ),
    );
    if (mounted) await provider.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<InventoryProvider>();
    final alertCount = provider.lowStockCount + provider.expiringCount;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Inventory',
        photoUrl: _logoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.vaccines_outlined,
            tooltip: 'Vaccine formulary',
            onPressed: _openFormulary,
          ),
          StaffHeaderAction(
            icon: Icons.add_box_outlined,
            tooltip: 'Log restock',
            onPressed: _openRestock,
          ),
          StaffHeaderAction(
            icon: Icons.notifications_outlined,
            tooltip: 'Stock alerts',
            badgeCount: alertCount,
            onPressed: provider.isLoading ? null : _openAlerts,
          ),
          StaffHeaderAction(
            icon: Icons.auto_awesome,
            tooltip: 'Inventory AI',
            onPressed: _openAi,
          ),
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: provider.isLoading ? null : provider.refresh,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'inventory-home-scan-qr',
        onPressed: _openScanner,
        backgroundColor: StaffSurfaces.cta,
        foregroundColor: Colors.white,
        elevation: 2,
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text(
          'Scan QR',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: provider.refresh,
        color: StaffSurfaces.brandSoft,
        child: provider.isLoading && provider.batches.isEmpty
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 80),
                    child: Center(
                      child: CircularProgressIndicator(
                        color: StaffSurfaces.brandSoft,
                      ),
                    ),
                  ),
                ],
              )
            : ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 88),
                children: [
                  StaffPageIntro(
                    eyebrow: 'Cold chain',
                    title: 'Vaccine stock',
                    subtitle: 'Search lots, filter by risk, and scan incoming QR.',
                    stats: [
                      StaffIntroStat(
                        label: 'Vials',
                        value: '${provider.totalVials}',
                        icon: Icons.inventory_2_outlined,
                        accent: AppColors.accentTeal,
                      ),
                      StaffIntroStat(
                        label: 'Low',
                        value: '${provider.lowStockCount}',
                        icon: Icons.trending_down,
                        accent: provider.lowStockCount > 0
                            ? AppColors.error
                            : AppColors.success,
                      ),
                      StaffIntroStat(
                        label: 'Expiring',
                        value: '${provider.expiringCount}',
                        icon: Icons.hourglass_bottom,
                        accent: provider.expiringCount > 0
                            ? AppColors.warning
                            : AppColors.success,
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    onChanged: provider.setSearchQuery,
                    decoration: InputDecoration(
                      hintText: 'Search name, lot, manufacturer…',
                      hintStyle: const TextStyle(
                        color: StaffSurfaces.textMutedSoft,
                        fontSize: 13,
                      ),
                      prefixIcon: Icon(
                        Icons.search,
                        color: StaffSurfaces.brandSoft,
                      ),
                      filled: true,
                      fillColor: StaffSurfaces.cardBg,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
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
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: StaffSurfaces.brandSoft),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: StaffSurfaces.softWell(),
                    child: Row(
                      children: [
                        _InvFilter(
                          label: 'All',
                          selected: provider.statusFilter == 'all',
                          onTap: () => provider.setStatusFilter('all'),
                        ),
                        _InvFilter(
                          label: 'Low',
                          selected: provider.statusFilter == 'low',
                          accent: AppColors.error,
                          onTap: () => provider.setStatusFilter('low'),
                        ),
                        _InvFilter(
                          label: 'Expiring',
                          selected: provider.statusFilter == 'expiring',
                          accent: AppColors.warning,
                          onTap: () => provider.setStatusFilter('expiring'),
                        ),
                        _InvFilter(
                          label: 'Healthy',
                          selected: provider.statusFilter == 'sufficient',
                          accent: AppColors.success,
                          onTap: () => provider.setStatusFilter('sufficient'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  StaffSectionHeader(
                    title: 'Batches',
                    count: provider.batches.length,
                  ),
                  if (provider.errorMessage != null) ...[
                    StaffErrorBanner(
                      message: provider.errorMessage!,
                      onDismiss: () {},
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (provider.batches.isEmpty)
                    StaffEmptyCard(
                      message: provider.searchQuery.isNotEmpty ||
                              provider.statusFilter != 'all'
                          ? 'No batches match that filter.'
                          : 'Restock shipments will appear here once recorded.',
                      icon: Icons.inventory_2_outlined,
                    )
                  else
                    ...provider.batches.map(
                      (b) => BatchCard(
                        batch: b,
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => BatchDetailScreen(batch: b),
                            ),
                          ).then((_) => provider.refresh());
                        },
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _InvFilter extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? accent;

  const _InvFilter({
    required this.label,
    required this.selected,
    required this.onTap,
    this.accent,
  });

  @override
  Widget build(BuildContext context) {
    final color = accent ?? StaffSurfaces.brandSoft;
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: selected ? StaffSurfaces.cardBg : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected
                  ? color.withValues(alpha: 0.35)
                  : Colors.transparent,
            ),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: selected ? color : StaffSurfaces.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}