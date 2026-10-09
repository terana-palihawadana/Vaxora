import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../inventory/data/models/batch_model.dart';
import '../../../inventory/presentation/screens/qr_scanner_screen.dart';
import '../../data/models/staff_appointment_model.dart';
import 'clinical_context_panel.dart';
import 'staff_common_widgets.dart';

class StaffAdministrationResult {
  final String batchId;
  final String lotNumber;
  final String injectionSite;
  final String route;
  final String notes;
  final bool doseConfirmed;
  final bool consentConfirmed;
  final bool vitalsConfirmed;

  const StaffAdministrationResult({
    required this.batchId,
    required this.lotNumber,
    required this.injectionSite,
    required this.route,
    required this.notes,
    required this.doseConfirmed,
    required this.consentConfirmed,
    required this.vitalsConfirmed,
  });
}

Future<StaffAdministrationResult?> showStaffAdministerSheet({
  required BuildContext context,
  required StaffAppointmentModel patient,
  required List<BatchModel> lots,
}) {
  return showModalBottomSheet<StaffAdministrationResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: StaffSurfaces.cardBg,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) {
      return _StaffAdministerSheet(patient: patient, lots: lots);
    },
  );
}

class _StaffAdministerSheet extends StatefulWidget {
  final StaffAppointmentModel patient;
  final List<BatchModel> lots;

  const _StaffAdministerSheet({
    required this.patient,
    required this.lots,
  });

  @override
  State<_StaffAdministerSheet> createState() => _StaffAdministerSheetState();
}

class _StaffAdministerSheetState extends State<_StaffAdministerSheet> {
  static const _sites = [
    'Left Deltoid',
    'Right Deltoid',
    'Left Anterolateral Thigh',
    'Right Anterolateral Thigh',
  ];
  static const _routes = [
    'Intramuscular (IM)',
    'Subcutaneous (SC)',
    'Intradermal (ID)',
    'Oral (PO)',
  ];

  String? _batchId;
  String _injectionSite = _sites.first;
  String _route = _routes.first;
  final _notesCtrl = TextEditingController();
  bool _dose = false;
  bool _consent = false;
  bool _vitals = false;

  List<BatchModel> get _usableLots {
    final vaccine = widget.patient.vaccineName.trim().toLowerCase();
    return widget.lots.where((lot) {
      if (lot.usableDoses <= 0 && lot.available <= 0) return false;
      if (vaccine.isEmpty) return true;
      final name = lot.name.trim().toLowerCase();
      return name == vaccine || name.contains(vaccine) || vaccine.contains(name);
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    final first = _usableLots.isEmpty ? null : _usableLots.first;
    _batchId = first?.id;
  }

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _scanLot() async {
    final scanned = await Navigator.of(context).push<BatchModel>(
      MaterialPageRoute(
        builder: (_) => QrScannerScreen(pickFromLots: _usableLots),
      ),
    );
    if (scanned != null && mounted) setState(() => _batchId = scanned.id);
  }

  Future<void> _submit() async {
    if (!_dose || !_consent || !_vitals) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Confirm the prescribed dose, consent and vitals before certifying.'),
        ),
      );
      return;
    }
    final selected = _usableLots.cast<BatchModel?>().firstWhere(
          (lot) => lot?.id == _batchId,
          orElse: () => null,
        );
    if (selected == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Select a usable vaccine lot from inventory.'),
        ),
      );
      return;
    }
    final ok = await confirmAction(
      context,
      title: 'Record administration?',
      message:
          'Certify ${widget.patient.patientName} received '
          '${widget.patient.vaccineName} from lot ${selected.lotNumber}? '
          'This writes to the clinical record.',
      confirmLabel: 'Record dose',
    );
    if (!ok || !mounted) return;
    Navigator.of(context).pop(
      StaffAdministrationResult(
        batchId: selected.id,
        lotNumber: selected.lotNumber,
        injectionSite: _injectionSite,
        route: _route,
        notes: _notesCtrl.text.trim(),
        doseConfirmed: _dose,
        consentConfirmed: _consent,
        vitalsConfirmed: _vitals,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    final usable = _usableLots;

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 16 + bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: StaffSurfaces.cardBorder,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Certify administration',
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${widget.patient.token} · ${widget.patient.patientName}',
              style: const TextStyle(
                fontSize: 13,
                color: StaffSurfaces.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${widget.patient.vaccineName}'
              '${widget.patient.hasDosage ? ' · ${widget.patient.prescribedDosage}' : ''}',
              style: TextStyle(
                fontSize: 13,
                color: StaffSurfaces.brandSoft,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 14),
            ClinicalContextPanel(
              patientProfileId: widget.patient.patientProfileId,
            ),
            const SizedBox(height: 14),
            const Text(
              'Vaccine lot',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              key: ValueKey('lot-${_batchId ?? 'none'}-${usable.length}'),
              initialValue: usable.any((l) => l.id == _batchId) ? _batchId : null,
              decoration: _fieldDecoration(),
              items: usable
                  .map(
                    (lot) => DropdownMenuItem(
                      value: lot.id,
                      child: Text(
                        'Lot #${lot.lotNumber} · ${lot.usableDoses} doses · Exp ${lot.expiry}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: usable.isEmpty
                  ? null
                  : (v) => setState(() => _batchId = v),
            ),
            if (usable.isNotEmpty)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _scanLot,
                  icon: const Icon(Icons.qr_code_scanner, size: 18),
                  label: const Text('Scan vial QR to select lot'),
                ),
              ),
            if (usable.isEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'No usable stock for this vaccine. Restock inventory first.',
                style: TextStyle(
                  color: AppColors.error.withValues(alpha: 0.9),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 12),
            const Text(
              'Injection site',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              key: ValueKey('site-$_injectionSite'),
              initialValue: _injectionSite,
              decoration: _fieldDecoration(),
              items: _sites
                  .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                  .toList(),
              onChanged: (v) {
                if (v != null) setState(() => _injectionSite = v);
              },
            ),
            const SizedBox(height: 12),
            const Text(
              'Route',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              key: ValueKey('route-$_route'),
              initialValue: _route,
              decoration: _fieldDecoration(),
              items: _routes
                  .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                  .toList(),
              onChanged: (v) {
                if (v != null) setState(() => _route = v);
              },
            ),
            const SizedBox(height: 12),
            const Text(
              'Clinical notes',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _notesCtrl,
              maxLines: 3,
              decoration: _fieldDecoration(
                hint: 'Observations, advice, site notes…',
              ),
            ),
            const SizedBox(height: 8),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _dose,
              onChanged: (v) => setState(() => _dose = v ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              title: Text(
                "Dose matches doctor's order "
                '(${widget.patient.prescribedDosage ?? 'not set'})',
                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
              ),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: (v) => setState(() => _consent = v ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text(
                'Informed consent confirmed',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
              ),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _vitals,
              onChanged: (v) => setState(() => _vitals = v ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text(
                'Pre-administration vitals verified',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: usable.isEmpty ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: StaffSurfaces.cta,
                    ),
                    child: const Text('Certify'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration({String? hint}) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: StaffSurfaces.softPanel,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    );
  }
}
