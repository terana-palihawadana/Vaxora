import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/formulary_entry_model.dart';

class WalkInFormResult {
  final String patientName;
  final String patientNic;
  final String patientEmail;
  final String patientPhone;
  final String vaccineName;
  final String dose;
  final String gender;
  final int? age;

  const WalkInFormResult({
    required this.patientName,
    required this.patientNic,
    required this.patientEmail,
    required this.patientPhone,
    required this.vaccineName,
    required this.dose,
    required this.gender,
    this.age,
  });
}

const _doseOptions = [
  'Dose 1 (Primary)',
  'Dose 2 (Primary)',
  'Booster Dose (3)',
  'Annual Booster',
];

const _fallbackVaccines = [
  'Pfizer-BioNTech Bivalent',
  'Moderna Spikevax',
  'Influenza Quadrivalent',
  'Hepatitis B Recombinant',
  'MMR (Measles, Mumps, Rubella)',
  'Tdap (Tetanus, Diphtheria, Pertussis)',
];

Future<WalkInFormResult?> showWalkInRegistrationSheet({
  required BuildContext context,
  required List<FormularyEntryModel> formulary,
}) {
  return showModalBottomSheet<WalkInFormResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: StaffSurfaces.cardBg,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) => _WalkInSheet(formulary: formulary),
  );
}

class _WalkInSheet extends StatefulWidget {
  final List<FormularyEntryModel> formulary;

  const _WalkInSheet({required this.formulary});

  @override
  State<_WalkInSheet> createState() => _WalkInSheetState();
}

class _WalkInSheetState extends State<_WalkInSheet> {
  final _name = TextEditingController();
  final _nic = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _age = TextEditingController();
  late String _vaccine;
  String _dose = _doseOptions.first;
  String _gender = 'Male';
  String? _error;

  List<String> get _vaccines {
    final fromFormulary = widget.formulary
        .map((e) => e.vaccineName.trim())
        .where((n) => n.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
    return fromFormulary.isNotEmpty ? fromFormulary : _fallbackVaccines;
  }

  @override
  void initState() {
    super.initState();
    _vaccine = _vaccines.first;
  }

  @override
  void dispose() {
    _name.dispose();
    _nic.dispose();
    _email.dispose();
    _phone.dispose();
    _age.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _name.text.trim();
    final nic = _nic.text.trim();
    final email = _email.text.trim();
    final phone = _phone.text.trim();
    if (name.isEmpty || nic.isEmpty || email.isEmpty || phone.isEmpty) {
      setState(() => _error = 'Name, NIC, email and phone are required.');
      return;
    }
    final ageRaw = _age.text.trim();
    final age = ageRaw.isEmpty ? null : int.tryParse(ageRaw);
    if (ageRaw.isNotEmpty && (age == null || age < 0 || age > 120)) {
      setState(() => _error = 'Enter a valid age, or leave it blank.');
      return;
    }
    Navigator.of(context).pop(
      WalkInFormResult(
        patientName: name,
        patientNic: nic,
        patientEmail: email,
        patientPhone: phone,
        vaccineName: _vaccine,
        dose: _dose,
        gender: _gender,
        age: age,
      ),
    );
  }

  InputDecoration _dec(String label) => InputDecoration(
        labelText: label,
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

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 12, 20, 20 + bottom),
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
            const Text(
              'Register walk-in',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Links an existing account by NIC, or creates one (password = NIC).',
              style: TextStyle(
                fontSize: 12.5,
                color: StaffSurfaces.textSecondary,
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.errorBg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppColors.error.withValues(alpha: 0.35),
                  ),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    color: AppColors.error,
                    fontWeight: FontWeight.w600,
                    fontSize: 12.5,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 14),
            TextField(controller: _name, decoration: _dec('Full name *')),
            const SizedBox(height: 10),
            TextField(controller: _nic, decoration: _dec('NIC / National ID *')),
            const SizedBox(height: 10),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: _dec('Email *'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: _dec('Phone *'),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _gender,
                    decoration: _dec('Gender'),
                    items: const [
                      DropdownMenuItem(value: 'Male', child: Text('Male')),
                      DropdownMenuItem(value: 'Female', child: Text('Female')),
                      DropdownMenuItem(value: 'Other', child: Text('Other')),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _gender = v);
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _age,
                    keyboardType: TextInputType.number,
                    decoration: _dec('Age'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _vaccines.contains(_vaccine) ? _vaccine : null,
              decoration: _dec('Vaccine *'),
              items: _vaccines
                  .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                  .toList(),
              onChanged: (v) {
                if (v != null) setState(() => _vaccine = v);
              },
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _dose,
              decoration: _dec('Dose'),
              items: _doseOptions
                  .map((d) => DropdownMenuItem(value: d, child: Text(d)))
                  .toList(),
              onChanged: (v) {
                if (v != null) setState(() => _dose = v);
              },
            ),
            const SizedBox(height: 8),
            Text(
              'Booth is auto-assigned to the shortest staffed queue for this vaccine.',
              style: TextStyle(
                fontSize: 11.5,
                color: StaffSurfaces.textMutedSoft,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _submit,
              style: FilledButton.styleFrom(
                backgroundColor: StaffSurfaces.cta,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: const Text(
                'Register walk-in',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
