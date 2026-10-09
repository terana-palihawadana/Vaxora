import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/repositories/staff_repository.dart';
import 'staff_common_widgets.dart';

/// Medical history, allergies and prior AEFI shown beside the dose decision.
/// Mirrors web [ClinicalContextPanel].
class ClinicalContextPanel extends StatefulWidget {
  final String? patientProfileId;

  const ClinicalContextPanel({super.key, required this.patientProfileId});

  @override
  State<ClinicalContextPanel> createState() => _ClinicalContextPanelState();
}

class _ClinicalContextPanelState extends State<ClinicalContextPanel> {
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _history = const [];
  List<Map<String, dynamic>> _vaccinations = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ClinicalContextPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.patientProfileId != widget.patientProfileId) {
      _load();
    }
  }

  Future<void> _load() async {
    final id = widget.patientProfileId?.trim();
    if (id == null || id.isEmpty) {
      setState(() {
        _loading = false;
        _error = null;
        _history = const [];
        _vaccinations = const [];
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final results = await Future.wait([
      StaffRepository.getMedicalTimeline(id),
      StaffRepository.getVaccinationTimeline(id),
    ]);

    if (!mounted) return;
    setState(() {
      _loading = false;
      _history = results[0];
      _vaccinations = results[1];
      if (_history.isEmpty && _vaccinations.isEmpty) {
        _error = null; // empty is fine — show empty states
      }
    });
  }

  bool _isActive(Map<String, dynamic> r) =>
      (r['status']?.toString() ?? '').toLowerCase() != 'resolved';

  bool _isAlert(Map<String, dynamic> r) {
    final s = (r['severity']?.toString() ?? '').toLowerCase();
    return s == 'severe' || s == 'critical';
  }

  @override
  Widget build(BuildContext context) {
    final id = widget.patientProfileId?.trim();
    if (id == null || id.isEmpty) {
      return _shell(
        child: const Text(
          'Patient history is unavailable for this booking.',
          style: TextStyle(fontSize: 12.5, color: StaffSurfaces.textSecondary),
        ),
      );
    }
    if (_loading) {
      return _shell(
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              SizedBox(width: 10),
              Text(
                'Loading patient history…',
                style: TextStyle(
                  fontSize: 12.5,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
            ],
          ),
        ),
      );
    }
    if (_error != null) {
      return _shell(
        child: Text(
          _error!,
          style: const TextStyle(fontSize: 12.5, color: AppColors.error),
        ),
      );
    }

    final allergies = _history
        .where((r) => r['recordType'] == 'Allergy' && _isActive(r))
        .toList();
    final conditions = _history
        .where((r) => r['recordType'] != 'Allergy' && _isActive(r))
        .toList();
    final aefi = _vaccinations
        .where((v) => v['adverseEventReported'] == true)
        .toList();

    return _shell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _section(
            title: 'Allergies',
            empty: 'No allergies on record',
            children: allergies
                .map(
                  (r) => Text(
                    '${r['title'] ?? 'Allergy'}'
                    '${r['severity'] != null ? ' (${r['severity']})' : ''}',
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.error,
                    ),
                  ),
                )
                .toList(),
          ),
          _section(
            title: 'Active conditions',
            empty: 'No active conditions on record',
            children: conditions
                .map(
                  (r) => Text(
                    '${r['title'] ?? 'Condition'} · ${r['recordType'] ?? ''}'
                    '${r['severity'] != null ? ' · ${r['severity']}' : ''}',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: _isAlert(r) ? FontWeight.w700 : FontWeight.w500,
                      color: _isAlert(r)
                          ? AppColors.error
                          : StaffSurfaces.textPrimary,
                    ),
                  ),
                )
                .toList(),
          ),
          _section(
            title: 'Adverse events (AEFI)',
            empty: 'No prior adverse events',
            children: aefi
                .map(
                  (v) => Text(
                    '${v['vaccineName'] ?? 'Vaccine'} dose ${v['doseNumber'] ?? '—'}: '
                    '${v['adverseEventNotes'] ?? 'Adverse event reported'}',
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.error,
                    ),
                  ),
                )
                .toList(),
          ),
          Text(
            '${_vaccinations.length} prior vaccination record(s)',
            style: const TextStyle(
              fontSize: 11.5,
              color: StaffSurfaces.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _shell({required Widget child}) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
      decoration: BoxDecoration(
        color: AppColors.warningBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFFDE68A)),
      ),
      child: child,
    );
  }

  Widget _section({
    required String title,
    required String empty,
    required List<Widget> children,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.4,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          if (children.isEmpty)
            Text(
              empty,
              style: const TextStyle(
                fontSize: 12.5,
                color: StaffSurfaces.textSecondary,
              ),
            )
          else
            ...children.map(
              (w) => Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: w,
              ),
            ),
        ],
      ),
    );
  }
}

/// Privacy-gated NIC / phone / email reveal (audited on the API).
class StaffContactReveal extends StatefulWidget {
  final String appointmentId;
  final String paymentStatus;
  final String? boothLabel;

  const StaffContactReveal({
    super.key,
    required this.appointmentId,
    required this.paymentStatus,
    this.boothLabel,
  });

  @override
  State<StaffContactReveal> createState() => _StaffContactRevealState();
}

class _StaffContactRevealState extends State<StaffContactReveal> {
  bool _loading = false;
  String? _error;
  Map<String, String?>? _contact;

  Future<void> _reveal() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await StaffRepository.getPatientContact(widget.appointmentId);
      if (!mounted) return;
      setState(() {
        _contact = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('ApiException: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final booth = widget.boothLabel != null && widget.boothLabel!.isNotEmpty
        ? ' · Booth ${widget.boothLabel}'
        : '';
    final meta = 'Payment: ${widget.paymentStatus}$booth';

    if (_contact != null) {
      final nic = _contact!['nic']?.trim();
      final phone = _contact!['phone']?.trim();
      final email = _contact!['email']?.trim();
      return Text(
        'NIC: ${nic?.isNotEmpty == true ? nic : '—'}'
        '${phone?.isNotEmpty == true ? ' · $phone' : ''}'
        '${email?.isNotEmpty == true ? ' · $email' : ''}'
        '\n$meta',
        style: const TextStyle(
          fontSize: 12.5,
          color: StaffSurfaces.textSecondary,
          height: 1.35,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          meta,
          style: const TextStyle(
            fontSize: 12.5,
            color: StaffSurfaces.textSecondary,
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 4),
          Text(
            _error!,
            style: const TextStyle(fontSize: 12, color: AppColors.error),
          ),
        ],
        const SizedBox(height: 6),
        TextButton(
          onPressed: _loading ? null : _reveal,
          style: TextButton.styleFrom(
            foregroundColor: StaffSurfaces.brandSoft,
            padding: EdgeInsets.zero,
            minimumSize: const Size(0, 28),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: Text(
            _loading ? 'Loading contact…' : 'Show contact details',
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
          ),
        ),
      ],
    );
  }
}
