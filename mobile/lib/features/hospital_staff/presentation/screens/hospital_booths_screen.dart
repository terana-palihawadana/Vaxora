import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../inventory/data/models/formulary_entry_model.dart';
import '../../../inventory/data/repositories/inventory_repository.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/hospital_booth_model.dart';
import '../../data/repositories/hospital_staff_repository.dart';

/// Hospital booth CRUD — mirrors web HospitalBoothsPanel.
class HospitalBoothsScreen extends StatefulWidget {
  const HospitalBoothsScreen({super.key});

  @override
  State<HospitalBoothsScreen> createState() => _HospitalBoothsScreenState();
}

class _HospitalBoothsScreenState extends State<HospitalBoothsScreen> {
  String _hospitalName = 'Hospital';
  String? _logoUrl;
  List<HospitalBoothModel> _booths = [];
  List<FormularyEntryModel> _formulary = [];
  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _editingId;

  final _code = TextEditingController();
  final _name = TextEditingController();
  final Set<String> _selectedVaccineIds = {};

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    if (mounted && user != null) {
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
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        HospitalStaffRepository.getBooths(),
        InventoryRepository.getFormulary(),
      ]);
      if (!mounted) return;
      setState(() {
        _booths = results[0] as List<HospitalBoothModel>;
        _formulary = results[1] as List<FormularyEntryModel>;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Failed to load booths.';
        _booths = [];
      });
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating),
    );
  }

  void _resetForm() {
    _code.clear();
    _name.clear();
    _selectedVaccineIds.clear();
    setState(() => _editingId = null);
  }

  void _beginEdit(HospitalBoothModel booth) {
    _code.text = booth.code;
    _name.text = booth.name;
    _selectedVaccineIds
      ..clear()
      ..addAll(booth.vaccineIds);
    setState(() => _editingId = booth.boothId);
  }

  Future<void> _save() async {
    final code = _code.text.trim();
    final name = _name.text.trim();
    if (code.isEmpty || name.isEmpty) {
      setState(() => _error = 'Code and name are required.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      if (_editingId != null) {
        final current = _booths.firstWhere((b) => b.boothId == _editingId);
        await HospitalStaffRepository.updateBooth(
          boothId: _editingId!,
          code: code,
          name: name,
          isActive: current.isActive,
          sortOrder: current.sortOrder,
          vaccineIds: _selectedVaccineIds.toList(),
        );
        _toast('Booth updated.');
      } else {
        await HospitalStaffRepository.createBooth(
          code: code,
          name: name,
          vaccineIds: _selectedVaccineIds.toList(),
        );
        _toast('Booth created.');
      }
      _resetForm();
      await _load();
    } catch (e) {
      setState(() {
        _error = e is ApiException ? e.message : 'Failed to save booth.';
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _toggleActive(HospitalBoothModel booth) async {
    if (booth.isActive) {
      final ok = await confirmAction(
        context,
        title: 'Deactivate booth?',
        message:
            'Deactivate ${booth.code}${booth.name.trim().isNotEmpty ? ' · ${booth.name}' : ''}? '
            'It will stop appearing for new schedules until reactivated.',
        confirmLabel: 'Deactivate',
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    try {
      if (booth.isActive) {
        await HospitalStaffRepository.deactivateBooth(booth.boothId);
        _toast('Booth deactivated.');
      } else {
        await HospitalStaffRepository.updateBooth(
          boothId: booth.boothId,
          code: booth.code,
          name: booth.name,
          isActive: true,
          sortOrder: booth.sortOrder,
          vaccineIds: booth.vaccineIds,
        );
        _toast('Booth reactivated.');
      }
      await _load();
    } catch (e) {
      _toast(e is ApiException ? e.message : e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = _booths.where((b) => b.isActive).length;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Booths',
        photoUrl: _logoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _loading || _saving ? null : _load,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Stations',
              title: 'Vaccination booths',
              subtitle:
                  'Each booth lists the vaccines it gives. Bookings for those vaccines open that booth.',
              stats: [
                StaffIntroStat(
                  label: 'Booths',
                  value: '${_booths.length}',
                  icon: Icons.meeting_room_outlined,
                  accent: StaffSurfaces.brandSoft,
                ),
                StaffIntroStat(
                  label: 'Active',
                  value: '$active',
                  icon: Icons.check_circle_outline,
                  accent: AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: StaffSurfaces.card(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _editingId == null ? 'Add booth' : 'Edit booth',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: StaffSurfaces.textPrimary,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _error!,
                      style: const TextStyle(
                        color: AppColors.error,
                        fontWeight: FontWeight.w600,
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    controller: _code,
                    maxLength: 20,
                    decoration: _fieldDec('Code *', hint: 'B01'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _name,
                    maxLength: 100,
                    decoration: _fieldDec('Name *', hint: 'Booth 1'),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Vaccines offered',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 12.5,
                      color: StaffSurfaces.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  if (_formulary.isEmpty)
                    const Text(
                      'No formulary vaccines yet — add them under Inventory first.',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: StaffSurfaces.textMutedSoft,
                      ),
                    )
                  else
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _formulary.map((f) {
                        final id = f.vaccineId;
                        final selected = _selectedVaccineIds.contains(id);
                        return FilterChip(
                          label: Text(f.vaccineName),
                          selected: selected,
                          onSelected: (v) {
                            setState(() {
                              if (v) {
                                _selectedVaccineIds.add(id);
                              } else {
                                _selectedVaccineIds.remove(id);
                              }
                            });
                          },
                          selectedColor: StaffSurfaces.cta.withValues(alpha: 0.15),
                          checkmarkColor: StaffSurfaces.cta,
                          labelStyle: TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                            color: selected
                                ? StaffSurfaces.cta
                                : StaffSurfaces.textPrimary,
                          ),
                          side: BorderSide(
                            color: selected
                                ? StaffSurfaces.cta
                                : StaffSurfaces.cardBorder,
                          ),
                        );
                      }).toList(),
                    ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      if (_editingId != null)
                        TextButton(
                          onPressed: _saving ? null : _resetForm,
                          child: const Text('Cancel'),
                        ),
                      const Spacer(),
                      FilledButton(
                        onPressed: _saving ? null : _save,
                        style: FilledButton.styleFrom(
                          backgroundColor: StaffSurfaces.cta,
                        ),
                        child: Text(_editingId == null ? 'Create' : 'Save'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            StaffSectionHeader(title: 'All booths', count: _booths.length),
            if (_loading)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: CircularProgressIndicator(
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              )
            else if (_booths.isEmpty)
              const StaffEmptyCard(
                message: 'No booths yet. Create your first station above.',
                icon: Icons.meeting_room_outlined,
              )
            else
              ..._booths.map(
                (b) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _BoothCard(
                    booth: b,
                    onEdit: () => _beginEdit(b),
                    onToggle: () => _toggleActive(b),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  InputDecoration _fieldDec(String label, {String? hint}) => InputDecoration(
        labelText: label,
        hintText: hint,
        counterText: '',
        filled: true,
        fillColor: AppColors.inputBg,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: StaffSurfaces.cta, width: 1.4),
        ),
      );
}

class _BoothCard extends StatelessWidget {
  final HospitalBoothModel booth;
  final VoidCallback onEdit;
  final VoidCallback onToggle;

  const _BoothCard({
    required this.booth,
    required this.onEdit,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: booth.isActive
            ? StaffSurfaces.cardBorder
            : AppColors.error.withValues(alpha: 0.28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: StaffSurfaces.softPanelDeep,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  booth.code,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  booth.name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 14.5,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ),
              StaffStatusChip(
                label: booth.isActive ? 'Active' : 'Inactive',
                tone: booth.isActive
                    ? StaffChipTone.success
                    : StaffChipTone.danger,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            booth.vaccineNames.isEmpty
                ? 'No vaccines assigned'
                : booth.vaccineNames.join(' · '),
            style: const TextStyle(
              fontSize: 12.5,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton(
                onPressed: onEdit,
                style: TextButton.styleFrom(
                  foregroundColor: StaffSurfaces.brandSoft,
                  padding: EdgeInsets.zero,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                ),
                child: const Text(
                  'Edit',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              TextButton(
                onPressed: onToggle,
                style: TextButton.styleFrom(
                  foregroundColor:
                      booth.isActive ? AppColors.error : AppColors.success,
                  padding: EdgeInsets.zero,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                ),
                child: Text(
                  booth.isActive ? 'Deactivate' : 'Reactivate',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
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
