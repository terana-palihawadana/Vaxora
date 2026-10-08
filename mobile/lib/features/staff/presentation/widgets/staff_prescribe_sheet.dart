import 'package:flutter/material.dart';
import '../../data/models/staff_appointment_model.dart';
import 'staff_common_widgets.dart';

Future<String?> showStaffPrescribeSheet({
  required BuildContext context,
  required StaffAppointmentModel patient,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: StaffSurfaces.cardBg,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) => _StaffPrescribeSheet(patient: patient),
  );
}

class _StaffPrescribeSheet extends StatefulWidget {
  final StaffAppointmentModel patient;

  const _StaffPrescribeSheet({required this.patient});

  @override
  State<_StaffPrescribeSheet> createState() => _StaffPrescribeSheetState();
}

class _StaffPrescribeSheetState extends State<_StaffPrescribeSheet> {
  late final TextEditingController _ctrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: widget.patient.prescribedDosage ?? '');
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _ctrl.text.trim();
    if (value.isEmpty) {
      setState(() => _error = 'Enter the dose to prescribe.');
      return;
    }
    if (value.length > 100) {
      setState(() => _error = 'Dose must be 100 characters or fewer.');
      return;
    }
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Prescribe dose',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            '${widget.patient.patientName} · ${widget.patient.vaccineName}',
            style: const TextStyle(color: StaffSurfaces.textSecondary),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            maxLength: 100,
            autofocus: true,
            decoration: InputDecoration(
              labelText: 'Dose (e.g. 0.5 ml)',
              errorText: _error,
              border: const OutlineInputBorder(),
            ),
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _submit,
              child: const Text('Save prescription'),
            ),
          ),
        ],
      ),
    );
  }
}
