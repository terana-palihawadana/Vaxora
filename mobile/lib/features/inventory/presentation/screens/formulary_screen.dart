import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../providers/inventory_provider.dart';

class FormularyScreen extends StatefulWidget {
  const FormularyScreen({super.key});

  @override
  State<FormularyScreen> createState() => _FormularyScreenState();
}

class _FormularyScreenState extends State<FormularyScreen> {
  final _nameController = TextEditingController();
  final _mfrController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _mfrController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;

    setState(() => _submitting = true);
    final provider = context.read<InventoryProvider>();
    final ok = await provider.registerVaccine(name, _mfrController.text.trim());
    if (!mounted) return;
    setState(() => _submitting = false);

    if (ok) {
      _nameController.clear();
      _mfrController.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Registered "$name".'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(provider.errorMessage ?? 'Failed to register.'),
          backgroundColor: AppColors.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _remove(String id, String name) async {
    final confirm = await confirmAction(
      context,
      title: 'Remove product?',
      message: 'Remove "$name" from the hospital formulary?',
      confirmLabel: 'Remove',
      destructive: true,
    );
    if (!confirm || !mounted) return;

    final provider = context.read<InventoryProvider>();
    final ok = await provider.removeVaccine(id);
    if (!mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(provider.errorMessage ?? 'Cannot remove.'),
          backgroundColor: AppColors.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<InventoryProvider>();
    final list = provider.formulary;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: AppBar(
        title: const Text('Vaccine formulary'),
        backgroundColor: StaffSurfaces.cardBg,
        foregroundColor: StaffSurfaces.textPrimary,
        elevation: 0,
      ),
      body: RefreshIndicator(
        color: StaffSurfaces.brandSoft,
        onRefresh: provider.loadFormulary,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 40),
          children: [
            StaffPageIntro(
              eyebrow: 'Registry',
              title: 'Registered products',
              subtitle: 'Products you register here appear in the restock dropdown.',
              stats: [
                StaffIntroStat(
                  label: 'Products',
                  value: '${list.length}',
                  icon: Icons.vaccines_outlined,
                  accent: AppColors.accentTeal,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: StaffSurfaces.cardBg,
                border: Border.all(color: StaffSurfaces.cardBorder),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Add product',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Vaccine product name *',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _mfrController,
                    decoration: const InputDecoration(
                      labelText: 'Manufacturer / supplier',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _submitting ? null : _submit,
                      icon: _submitting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.add),
                      label: Text(_submitting ? 'Registering…' : 'Register product'),
                      style: FilledButton.styleFrom(
                        backgroundColor: StaffSurfaces.brandSoft,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            StaffSectionHeader(title: 'Registered', count: list.length),
            if (list.isEmpty)
              const StaffEmptyCard(
                message: 'No products registered yet.',
                icon: Icons.vaccines_outlined,
              )
            else
              ...list.map(
                (e) => Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: StaffSurfaces.cardBg,
                    border: Border.all(color: StaffSurfaces.cardBorder),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.vaccines, color: AppColors.accentTeal, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              e.vaccineName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                              ),
                            ),
                            if (e.manufacturer.isNotEmpty)
                              Text(
                                e.manufacturer,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: StaffSurfaces.textSecondary,
                                ),
                              ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: AppColors.error),
                        tooltip: 'Remove',
                        onPressed: () => _remove(e.id, e.vaccineName),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}