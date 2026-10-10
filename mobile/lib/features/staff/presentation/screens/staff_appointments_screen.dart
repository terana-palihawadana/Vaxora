import 'dart:async';

import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/utils/home_route_utils.dart';
import '../../../inventory/data/models/batch_model.dart';
import '../../../inventory/data/repositories/inventory_repository.dart';
import '../../data/models/affiliation_model.dart';
import '../../data/models/shift_model.dart';
import '../../data/models/staff_appointment_model.dart';
import '../../data/repositories/staff_repository.dart';
import '../utils/staff_date_utils.dart';
import '../widgets/network_avatar.dart';
import '../widgets/clinical_context_panel.dart';
import '../widgets/staff_administer_sheet.dart';
import '../widgets/staff_aefi_sheet.dart';
import '../widgets/staff_prescribe_sheet.dart';
import '../widgets/staff_common_widgets.dart';

const _observationWindowMinutes = 15;

int? _observationMinutesLeft(String? updatedAt, DateTime now) {
  if (updatedAt == null || updatedAt.trim().isEmpty) return null;
  final started = DateTime.tryParse(updatedAt);
  if (started == null) return null;
  final elapsed = now.toUtc().difference(started.toUtc()).inMinutes;
  final left = _observationWindowMinutes - elapsed;
  return left < 0 ? 0 : left;
}

class StaffAppointmentsScreen extends StatefulWidget {
  const StaffAppointmentsScreen({super.key});

  @override
  State<StaffAppointmentsScreen> createState() =>
      _StaffAppointmentsScreenState();
}

class _StaffAppointmentsScreenState extends State<StaffAppointmentsScreen> {
  List<AffiliationModel> _hospitals = [];
  List<StaffAppointmentModel> _appointments = [];
  List<ShiftModel> _todayShifts = [];
  // true = only my live shift's booth (plus unassigned patients).
  bool _myBoothOnly = true;
  List<BatchModel> _lots = [];
  String _selectedHospitalId = '';
  late String _filterDate;
  String _filterStatus = 'all';
  final TextEditingController _searchCtrl = TextEditingController();
  bool _loadingHospitals = true;
  bool _loadingAppointments = false;
  bool _updating = false;
  bool _dutyUpdating = false;
  Timer? _ticker;
  String? _error;
  bool _allowHospitalSwitch = true;
  bool _isDoctor = false;
  String _facilitySuffix = '';
  String? _activePatientId;
  String? _myUserId;

  String _displayName = 'there';
  String _roleLabel = 'Staff';
  String? _photoUrl;

  @override
  void initState() {
    super.initState();
    _filterDate = todayIsoDate();
    _bootstrap();
    // Keep observation countdowns and live-shift booth scope current.
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  String get _searchQuery => _searchCtrl.text;

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    final role = user?['role']?.toString().toUpperCase() ?? '';
    final isNurse = role.contains('NURSE') && !role.contains('DOCTOR');
    if (mounted) {
      setState(() {
        _allowHospitalSwitch = !isNurse;
        _isDoctor = role.contains('DOCTOR');
        _facilitySuffix = isNurse ? ' · Nursing Station' : '';
        _myUserId = user?['id']?.toString();
        if (user != null) {
          _displayName = user['name']?.toString().trim().isNotEmpty == true
              ? user['name'].toString().trim()
              : 'there';
          _roleLabel = staffRoleLabel(user['role']?.toString() ?? '');
          _photoUrl = resolveMediaUrl(
            user['profilePhotoUrl']?.toString() ??
                user['profilePhoto']?.toString() ??
                user['photoUrl']?.toString(),
          );
        }
      });
    }
    await _loadHospitals();
  }

  String _pickDefaultHospitalId(
    List<AffiliationModel> active,
    String preferredId,
  ) {
    final onDuty = active.where((a) => a.isOnDutyNow).toList();
    if (onDuty.isNotEmpty) return onDuty.first.hospitalUserId;
    if (preferredId.isNotEmpty &&
        active.any((a) => a.hospitalUserId == preferredId)) {
      return preferredId;
    }
    return active.isEmpty ? '' : active.first.hospitalUserId;
  }

  Future<void> _loadHospitals() async {
    setState(() {
      _loadingHospitals = true;
      _error = null;
    });
    try {
      final list = await StaffRepository.getMyAffiliations();
      final active = list.where((a) => a.isActive).toList();
      if (!mounted) return;
      final hospitalId = _allowHospitalSwitch
          ? _pickDefaultHospitalId(active, _selectedHospitalId)
          : (active.isEmpty ? '' : active.first.hospitalUserId);
      setState(() {
        _hospitals = active;
        _selectedHospitalId = hospitalId;
        _loadingHospitals = false;
      });
      await _loadAppointments();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingHospitals = false;
        _error = e is ApiException
            ? e.message
            : 'Failed to load hospital affiliations.';
        _hospitals = [];
        _selectedHospitalId = '';
        _appointments = [];
        _lots = [];
      });
    }
  }

  Future<void> _loadAppointments() async {
    if (_selectedHospitalId.isEmpty) {
      setState(() {
        _appointments = [];
        _lots = [];
        _activePatientId = null;
      });
      return;
    }
    setState(() {
      _loadingAppointments = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        StaffRepository.getHospitalAppointments(
          hospitalUserId: _selectedHospitalId,
          date: _filterDate,
        ),
        InventoryRepository.getBatches(hospitalUserId: _selectedHospitalId),
        StaffRepository.getMyShifts(from: todayIsoDate(), to: todayIsoDate())
            .catchError((_) => <ShiftModel>[]),
      ]);
      if (!mounted) return;
      final list = results[0] as List<StaffAppointmentModel>;
      final lots = results[1] as List<BatchModel>;
      _todayShifts = results[2] as List<ShiftModel>;
      setState(() {
        _appointments = list;
        _lots = lots;
        _loadingAppointments = false;
        // Keep the chosen session while it is live; otherwise the spotlight falls
        // back to a session I may work (see _activePatient), never a colleague's.
        if (!list.any((a) => a.id == _activePatientId && a.uiStatus == 'consulting')) {
          _activePatientId = null;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingAppointments = false;
        _error =
            e is ApiException ? e.message : 'Failed to load appointments.';
        _appointments = [];
        _lots = [];
      });
    }
  }

  AffiliationModel? get _selectedHospital {
    try {
      return _hospitals
          .firstWhere((h) => h.hospitalUserId == _selectedHospitalId);
    } catch (_) {
      return _hospitals.isEmpty ? null : _hospitals.first;
    }
  }

  bool get _isOnDuty => _selectedHospital?.isOnDutyNow == true;

  /// Clinical actions need a live shift or a clock-in; the API enforces the same rule.
  bool _requireDuty() {
    if (_selectedHospital == null || _isOnDuty) return true;
    _toast('Clock in to start clinical work.');
    return false;
  }

  Future<void> _changeDuty(String dutyStatus) async {
    final hospital = _selectedHospital;
    if (hospital == null) return;
    setState(() => _dutyUpdating = true);
    try {
      await StaffRepository.updateDutyStatus(
        affiliationId: hospital.affiliationId,
        dutyStatus: dutyStatus,
      );
      await _loadHospitals();
      _toast(switch (dutyStatus) {
        'OnDuty' => 'You are on duty. Clinical actions are unlocked.',
        'OnBreak' => 'Break started. Clinical actions are paused.',
        _ => 'Clocked out.',
      });
    } catch (e) {
      _toast(e is ApiException ? e.message : 'Could not update your duty status.');
    } finally {
      if (mounted) setState(() => _dutyUpdating = false);
    }
  }

  /// Off duty: no spotlight. On duty: the chosen patient, else my own live
  /// session, else my booth's.
  StaffAppointmentModel? get _activePatient {
    if (!_isOnDuty) return null;
    for (final a in _appointments) {
      if (a.id == _activePatientId && (!_isInSession(a) || _canWorkSession(a))) return a;
    }
    final workable = _appointments
        .where((a) => a.uiStatus == 'consulting' && _canWorkSession(a))
        .toList();
    for (final a in workable) {
      if (a.sessionStaffUserId != null && a.sessionStaffUserId == _myUserId) return a;
    }
    return workable.isEmpty ? null : workable.first;
  }

  static bool _isInSession(StaffAppointmentModel a) =>
      a.uiStatus == 'consulting' || a.uiStatus == 'observation';

  static bool _hasBooth(StaffAppointmentModel a) =>
      (a.boothId ?? '').isNotEmpty || (a.boothLabel?.trim() ?? '').isNotEmpty;

  static bool _isAtBooth(StaffAppointmentModel a, ({String? id, String label}) booth) {
    final id = a.boothId ?? '';
    if ((booth.id ?? '').isNotEmpty && id.isNotEmpty) return id == booth.id;
    return (a.boothLabel?.trim() ?? '').toLowerCase() == booth.label.toLowerCase();
  }

  /// A live session belongs to its booth team or whoever called the patient in;
  /// the API enforces the same rule, and anyone else must take it over.
  bool _canWorkSession(StaffAppointmentModel a) {
    if (!_isOnDuty) return false;
    if (a.sessionStaffUserId != null && a.sessionStaffUserId == _myUserId) return true;
    if (!_hasBooth(a)) return a.sessionStaffUserId == null;
    final booth = _myBooth;
    return booth != null && _isAtBooth(a, booth);
  }

  /// "B01 · Nurse Kavindi": who has a colleague's live session.
  static String _sessionOwnerLabel(StaffAppointmentModel a) {
    final boothCode = a.boothLabel?.split(' · ').first.trim();
    final parts = [
      if (boothCode != null && boothCode.isNotEmpty) boothCode,
      if ((a.sessionStaffName ?? '').isNotEmpty) a.sessionStaffName!,
    ];
    return parts.isEmpty ? 'another booth' : parts.join(' · ');
  }

  /// Owner label when this is a colleague's session I cannot work, else null.
  String? _colleagueOwner(StaffAppointmentModel a) =>
      _isInSession(a) && !_canWorkSession(a) ? _sessionOwnerLabel(a) : null;

  /// Booth of my live shift at the selected hospital (clock-ins have none).
  ({String? id, String label})? get _myBooth {
    final hospital = _selectedHospital;
    if (hospital == null || _filterDate != todayIsoDate()) return null;
    final now = hospitalNow();
    final nowMinutes = now.hour * 60 + now.minute;
    int? minutes(String raw) {
      final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(raw.trim());
      return m == null ? null : int.parse(m.group(1)!) * 60 + int.parse(m.group(2)!);
    }

    for (final s in _todayShifts) {
      if (s.affiliationId != hospital.affiliationId) continue;
      final start = minutes(s.startTime);
      final end = minutes(s.endTime);
      if (start == null || end == null) continue;
      if (start > nowMinutes || nowMinutes >= end) continue;
      final label = s.boothOrStation?.trim() ?? '';
      if ((s.boothId ?? '').isEmpty && label.isEmpty) return null;
      return (id: s.boothId, label: label.isEmpty ? 'My booth' : label);
    }
    return null;
  }

  /// Patients in my booth scope; unassigned patients stay visible to everyone.
  List<StaffAppointmentModel> get _scopedAppointments {
    final booth = _myBooth;
    if (booth == null || !_myBoothOnly) return _appointments;
    return _appointments.where((a) => !_hasBooth(a) || _isAtBooth(a, booth)).toList();
  }

  List<StaffAppointmentModel> get _filteredAppointments {
    final q = _searchQuery.trim().toLowerCase();
    return _scopedAppointments.where((a) {
      final matchesSearch = q.isEmpty ||
          a.patientName.toLowerCase().contains(q) ||
          a.token.toLowerCase().contains(q) ||
          a.vaccineName.toLowerCase().contains(q);
      if (!matchesSearch) return false;

      if (_filterStatus == 'all') return true;
      if (_filterStatus == 'waiting') {
        return a.uiStatus == 'waiting' && a.isPaymentSettled;
      }
      if (_filterStatus == 'awaiting_payment') {
        return a.uiStatus == 'waiting' && !a.isPaymentSettled;
      }
      return a.uiStatus == _filterStatus;
    }).toList();
  }

  int get _completedCount =>
      _scopedAppointments.where((a) => a.uiStatus == 'completed').length;
  int get _waitingCount => _scopedAppointments
      .where((a) => a.uiStatus == 'waiting' && a.isPaymentSettled)
      .length;
  int get _awaitingPaymentCount => _scopedAppointments
      .where((a) => a.uiStatus == 'waiting' && !a.isPaymentSettled)
      .length;
  int get _observationCount =>
      _scopedAppointments.where((a) => a.uiStatus == 'observation').length;

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _updateStatus(
    StaffAppointmentModel appointment,
    String status, {
    Map<String, dynamic>? administration,
  }) async {
    setState(() => _updating = true);
    try {
      await StaffRepository.updateAppointmentStatus(
        appointmentId: appointment.id,
        status: status,
        administration: administration,
      );
      await _loadAppointments();
    } catch (e) {
      _toast(e is ApiException ? e.message : 'Failed to update status.');
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _prescribe(StaffAppointmentModel patient) async {
    if (!_requireDuty()) return;
    final dosage = await showStaffPrescribeSheet(
      context: context,
      patient: patient,
    );
    if (dosage == null) return;
    setState(() => _updating = true);
    try {
      await StaffRepository.updateDosage(
        appointmentId: patient.id,
        dosage: dosage,
      );
      await _loadAppointments();
      _toast('Dose prescribed for ${patient.patientName}');
    } catch (e) {
      _toast(e is ApiException ? e.message : 'Failed to prescribe dose.');
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _callNext() async {
    if (!_requireDuty()) return;
    final current = _activePatient;
    if (current != null && current.uiStatus == 'consulting') {
      _toast(
        'Finish ${current.patientName} (certify to observation) before calling the next patient.',
      );
      return;
    }
    StaffAppointmentModel? next;
    final scoped = _scopedAppointments;
    for (final a in scoped) {
      if (a.uiStatus == 'waiting' && a.isCheckedIn && a.isPaymentSettled && a.hasDosage) {
        next = a;
        break;
      }
    }
    if (next == null) {
      final unpaidWaiting =
          scoped.any((a) => a.uiStatus == 'waiting' && !a.isPaymentSettled);
      final anyArrived = scoped.any((a) => a.uiStatus == 'waiting' && a.isCheckedIn);
      if (!anyArrived && scoped.any((a) => a.uiStatus == 'waiting')) {
        _toast('No checked-in patients yet. Patients join the queue when they check in.');
        return;
      }
      final awaitingDose = scoped.any(
          (a) => a.uiStatus == 'waiting' && a.isPaymentSettled && !a.hasDosage);
      _toast(
        awaitingDose
            ? 'Paid patients are waiting for a doctor to prescribe their dose.'
            : unpaidWaiting
            ? 'No paid patients waiting. Unpaid appointments cannot be administered yet.'
            : 'No more waiting patients in today’s queue.',
      );
      return;
    }
    setState(() => _activePatientId = next!.id);
    await _updateStatus(next, 'Administering');
    _toast('Called ${next.patientName}');
  }

  Future<void> _checkIn(StaffAppointmentModel patient) async {
    setState(() => _updating = true);
    try {
      await StaffRepository.checkIn(patient.id);
      await _loadAppointments();
      _toast('${patient.patientName} checked in.');
    } catch (e) {
      _toast(e is ApiException ? e.message : 'Failed to check in patient.');
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _examine(StaffAppointmentModel patient) async {
    if (!_requireDuty()) return;
    if (!patient.isCheckedIn) {
      _toast('This patient has not checked in yet.');
      return;
    }
    if (!patient.isPaymentSettled) {
      _toast('Payment must be settled before starting consultation.');
      return;
    }
    if (!patient.hasDosage) {
      _toast('A doctor must prescribe the dose before this patient can be examined.');
      return;
    }
    setState(() => _activePatientId = patient.id);
    if (patient.uiStatus == 'waiting') {
      await _updateStatus(patient, 'Administering');
    }
  }

  Future<void> _takeOver(StaffAppointmentModel patient) async {
    if (!_requireDuty()) return;
    final ok = await confirmAction(
      context,
      title: 'Take over session?',
      message:
          '${patient.patientName} is with ${_sessionOwnerLabel(patient)}. '
          'Take over only if they cannot continue. This is logged.',
      confirmLabel: 'Take over',
    );
    if (!ok || !mounted) return;
    setState(() => _updating = true);
    try {
      await StaffRepository.takeOverSession(
        appointmentId: patient.id,
        status: patient.status,
      );
      setState(() => _activePatientId = patient.id);
      await _loadAppointments();
      _toast('You now have ${patient.patientName}.');
    } catch (e) {
      _toast(e is ApiException ? e.message : 'Could not take over the session.');
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _returnToQueue(StaffAppointmentModel patient) async {
    if (!_requireDuty()) return;
    await _updateStatus(patient, 'Confirmed');
    if (_activePatientId == patient.id) {
      setState(() => _activePatientId = null);
    }
    _toast('${patient.patientName} returned to the waiting queue.');
  }

  Future<void> _certify(StaffAppointmentModel patient) async {
    if (!_requireDuty()) return;
    if (!patient.isPaymentSettled) {
      _toast('Payment must be settled before recording administration.');
      return;
    }
    final result = await showStaffAdministerSheet(
      context: context,
      patient: patient,
      lots: _lots,
    );
    if (result == null) return;
    await _updateStatus(
      patient,
      'Observation',
      administration: {
        'batchId': result.batchId,
        'lotNumber': result.lotNumber,
        'injectionSite': result.injectionSite,
        'route': result.route,
        if (result.notes.isNotEmpty) 'administrationNotes': result.notes,
        'doseConfirmed': result.doseConfirmed,
        'consentConfirmed': result.consentConfirmed,
        'vitalsConfirmed': result.vitalsConfirmed,
      },
    );
    _toast('Recorded administration for ${patient.patientName}');
  }

  Future<void> _discharge(StaffAppointmentModel patient) async {
    if (!_requireDuty()) return;
    if (!patient.isPaymentSettled) {
      _toast('Payment must be settled before discharging the patient.');
      return;
    }
    final minsLeft =
        _observationMinutesLeft(patient.updatedAt, DateTime.now()) ?? 0;
    if (minsLeft > 0) {
      final ok = await confirmAction(
        context,
        title: 'Discharge early?',
        message:
            '${patient.patientName} still has $minsLeft min left in the '
            '$_observationWindowMinutes-minute watch. Discharge only if they are well.',
        confirmLabel: 'Discharge',
      );
      if (!ok || !mounted) return;
    }
    await _updateStatus(patient, 'Completed');
    if (_activePatientId == patient.id) {
      setState(() => _activePatientId = null);
    }
    _toast('${patient.patientName} discharged from observation.');
  }

  Future<void> _reportAefi(StaffAppointmentModel patient) async {
    final draft = await showStaffAefiSheet(context: context, patient: patient);
    if (draft == null) return;

    setState(() => _updating = true);
    try {
      final result = await StaffRepository.reportAefi(
        appointmentId: patient.id,
        severity: draft.severity,
        description: draft.description,
        treatmentGiven: draft.treatmentGiven,
        followUpAt: draft.followUpAt,
        followUpPlan: draft.followUpPlan,
        notifyDoctor: draft.notifyDoctor,
      );
      await _loadAppointments();
      final message = result['message']?.toString();
      _toast(
        (message != null && message.trim().isNotEmpty)
            ? message
            : 'AEFI saved for ${patient.patientName}.',
      );
    } catch (e) {
      _toast(e is ApiException ? e.message : 'Failed to submit AEFI report.');
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _pickDate() async {
    final initial = DateTime.tryParse(_filterDate) ?? hospitalNow();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: hospitalNow().subtract(const Duration(days: 365)),
      lastDate: hospitalNow().add(const Duration(days: 365)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: ColorScheme.light(
              primary: StaffSurfaces.cta,
              onPrimary: Colors.white,
              surface: StaffSurfaces.appBarBg,
              onSurface: StaffSurfaces.textPrimary,
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked == null) return;
    setState(() {
      _filterDate =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
    await _loadAppointments();
  }

  @override
  Widget build(BuildContext context) {
    final facility = _selectedHospital == null
        ? (_loadingHospitals ? 'Loading hospital…' : 'No affiliated hospital')
        : '${_selectedHospital!.hospitalName}$_facilitySuffix';
    final isToday = _filterDate == todayIsoDate();
    final dutyLabel = _selectedHospital?.dutyLabel;
    final active = _activePatient;
    final now = hospitalNow();

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _displayName,
        subtitle: '$_roleLabel · Clinical',
        photoUrl: _photoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _loadingHospitals || _loadingAppointments || _updating
                ? null
                : _loadHospitals,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadHospitals,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Clinical session',
              title: isToday ? "Today's clinic queue" : 'Clinic queue',
              subtitle: dutyLabel == null ? facility : '$facility · $dutyLabel',
              stats: [
                StaffIntroStat(
                  label: 'Waiting',
                  value: '$_waitingCount',
                  icon: Icons.pending_outlined,
                  accent: _waitingCount > 0
                      ? AppColors.warning
                      : AppColors.success,
                ),
                StaffIntroStat(
                  label: 'Watch',
                  value: '$_observationCount',
                  icon: Icons.visibility_outlined,
                ),
                StaffIntroStat(
                  label: 'Done',
                  value: '$_completedCount',
                  icon: Icons.check_circle_outline,
                  accent: AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (_selectedHospital != null) ...[
              _DutyBar(
                hospital: _selectedHospital!,
                busy: _dutyUpdating,
                onChange: _changeDuty,
              ),
              const SizedBox(height: 12),
            ],
            if (_error != null) ...[
              StaffErrorBanner(
                message: _error!,
                onDismiss: () => setState(() => _error = null),
              ),
              const SizedBox(height: 12),
            ],
            if (_allowHospitalSwitch && _hospitals.length > 1) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: StaffSurfaces.softWell(),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isExpanded: true,
                    value: _selectedHospitalId.isEmpty
                        ? null
                        : _selectedHospitalId,
                    hint: const Text('Select hospital'),
                    iconEnabledColor: StaffSurfaces.brandSoft,
                    onChanged: (v) async {
                      if (v == null) return;
                      setState(() {
                        _selectedHospitalId = v;
                        _activePatientId = null;
                      });
                      await _loadAppointments();
                    },
                    items: _hospitals
                        .map(
                          (h) => DropdownMenuItem(
                            value: h.hospitalUserId,
                            child: Text(
                              '${h.hospitalName} · ${h.dutyLabel}',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                color: StaffSurfaces.textPrimary,
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            _DateFilterRow(
              date: _filterDate,
              isToday: isToday,
              onPick: _pickDate,
              onToday: () async {
                setState(() => _filterDate = todayIsoDate());
                await _loadAppointments();
              },
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _updating ? null : _callNext,
                style: FilledButton.styleFrom(
                  backgroundColor: StaffSurfaces.cta,
                  disabledBackgroundColor: StaffSurfaces.softPanelDeep,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                icon: const Icon(Icons.campaign_outlined, size: 18),
                label: Text(
                  'Call next patient',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ),
            if (active != null && active.uiStatus == 'consulting') ...[
              const SizedBox(height: 14),
              _ActivePatientCard(
                patient: active,
                busy: _updating,
                onReturn: () => _returnToQueue(active),
                onCertify: () => _certify(active),
                onAefi: () => _reportAefi(active),
              ),
            ],
            if (_observationCount > 0) ...[
              const SizedBox(height: 14),
              StaffSectionHeader(
                title: 'Observation watch',
                count: _observationCount,
              ),
              ..._scopedAppointments
                  .where((a) => a.uiStatus == 'observation')
                  .map(
                    (obs) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _ObservationCard(
                        patient: obs,
                        minsLeft: _observationMinutesLeft(obs.updatedAt, now),
                        busy: _updating,
                        ownerLabel: _colleagueOwner(obs),
                        onTakeOver: _isOnDuty ? () => _takeOver(obs) : null,
                        onDischarge: () => _discharge(obs),
                        onAefi: () => _reportAefi(obs),
                      ),
                    ),
                  ),
            ],
            const SizedBox(height: 14),
            if (_myBooth != null) ...[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _FilterChip(
                    label: 'My booth · ${_myBooth!.label.split(' · ').first}',
                    selected: _myBoothOnly,
                    onTap: () => setState(() => _myBoothOnly = true),
                  ),
                  _FilterChip(
                    label: 'All booths',
                    selected: !_myBoothOnly,
                    onTap: () => setState(() => _myBoothOnly = false),
                  ),
                ],
              ),
              const SizedBox(height: 8),
            ],
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _FilterChip(
                  label: 'All (${_scopedAppointments.length})',
                  selected: _filterStatus == 'all',
                  onTap: () => setState(() => _filterStatus = 'all'),
                ),
                _FilterChip(
                  label: 'Waiting ($_waitingCount)',
                  selected: _filterStatus == 'waiting',
                  onTap: () => setState(() => _filterStatus = 'waiting'),
                ),
                if (_awaitingPaymentCount > 0)
                  _FilterChip(
                    label: 'Awaiting payment ($_awaitingPaymentCount)',
                    selected: _filterStatus == 'awaiting_payment',
                    onTap: () =>
                        setState(() => _filterStatus = 'awaiting_payment'),
                  ),
                _FilterChip(
                  label: 'Observation ($_observationCount)',
                  selected: _filterStatus == 'observation',
                  onTap: () => setState(() => _filterStatus = 'observation'),
                ),
                _FilterChip(
                  label: 'Done ($_completedCount)',
                  selected: _filterStatus == 'completed',
                  onTap: () => setState(() => _filterStatus = 'completed'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _searchCtrl,
              onChanged: (_) => setState(() {}),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search patient, token, vaccine…',
                hintStyle: const TextStyle(
                  color: StaffSurfaces.textMutedSoft,
                  fontSize: 13.5,
                ),
                prefixIcon: Icon(
                  Icons.search_rounded,
                  color: StaffSurfaces.brandSoft,
                  size: 22,
                ),
                suffixIcon: _searchQuery.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear',
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() {});
                        },
                        icon: const Icon(Icons.close_rounded, size: 18),
                      ),
                filled: true,
                fillColor: StaffSurfaces.softPanel,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 12,
                ),
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
                  borderSide: BorderSide(color: StaffSurfaces.cta, width: 1.4),
                ),
              ),
            ),
            const SizedBox(height: 14),
            if (_loadingHospitals || _loadingAppointments)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(
                      color: StaffSurfaces.brandSoft),
                ),
              )
            else if (_hospitals.isEmpty)
              const StaffEmptyCard(
                message: 'Join a hospital affiliation to run a clinical session.',
                icon: Icons.local_hospital_outlined,
              )
            else if (_filteredAppointments.isEmpty)
              StaffEmptyCard(
                message: _searchQuery.trim().isNotEmpty
                    ? 'No patients matching your search criteria.'
                    : 'No appointments in this filter for the selected date.',
                icon: Icons.event_busy_outlined,
              )
            else ...[
              StaffSectionHeader(
                title: isToday ? "Today's queue" : 'Queue',
                count: _filteredAppointments.length,
              ),
              ..._filteredAppointments.map(
                (a) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _AppointmentCard(
                    appointment: a,
                    busy: _updating,
                    ownerLabel: _colleagueOwner(a),
                    onTakeOver: _isOnDuty ? () => _takeOver(a) : null,
                    canPrescribe: _isDoctor,
                    onPrescribe: () => _prescribe(a),
                    onExamine: () => _examine(a),
                    onCheckIn: () => _checkIn(a),
                    onCertify: () => _certify(a),
                    onDischarge: () => _discharge(a),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? StaffSurfaces.cta : StaffSurfaces.softPanel,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : StaffSurfaces.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}

class _DateFilterRow extends StatelessWidget {
  final String date;
  final bool isToday;
  final VoidCallback onPick;
  final VoidCallback onToday;

  const _DateFilterRow({
    required this.date,
    required this.isToday,
    required this.onPick,
    required this.onToday,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Material(
            color: StaffSurfaces.cardBg,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              onTap: onPick,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 13,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: StaffSurfaces.cardBorder),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.calendar_today_outlined,
                      size: 18,
                      color: StaffSurfaces.brandSoft,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        date,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                          fontSize: 13.5,
                        ),
                      ),
                    ),
                    Icon(
                      Icons.expand_more,
                      size: 20,
                      color: StaffSurfaces.textMutedSoft,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        FilledButton(
          onPressed: onToday,
          style: FilledButton.styleFrom(
            backgroundColor:
                isToday ? StaffSurfaces.cta : StaffSurfaces.softPanelDeep,
            foregroundColor:
                isToday ? Colors.white : StaffSurfaces.brandSoft,
            elevation: 0,
            padding:
                const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          child: const Text(
            'Today',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
          ),
        ),
      ],
    );
  }
}

class _ActivePatientCard extends StatelessWidget {
  final StaffAppointmentModel patient;
  final bool busy;
  final VoidCallback onReturn;
  final VoidCallback onCertify;
  final VoidCallback onAefi;

  const _ActivePatientCard({
    required this.patient,
    required this.busy,
    required this.onReturn,
    required this.onCertify,
    required this.onAefi,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: StaffSurfaces.brandSoft.withValues(alpha: 0.35),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${patient.token} · ${patient.patientName}',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ),
              StaffStatusChip(label: 'In session', tone: StaffChipTone.brand),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${patient.vaccineName}'
            '${patient.hasDosage ? ' · ${patient.prescribedDosage}' : ''}',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: StaffSurfaces.brandSoft,
            ),
          ),
          const SizedBox(height: 6),
          StaffContactReveal(
            appointmentId: patient.id,
            paymentStatus: patient.paymentStatus,
            boothLabel: patient.boothLabel,
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: busy ? null : onReturn,
                  child: const Text('Return to queue'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: busy || !patient.isPaymentSettled
                      ? null
                      : onCertify,
                  style: FilledButton.styleFrom(
                    backgroundColor: StaffSurfaces.cta,
                  ),
                  child: const Text('Certify'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: busy ? null : onAefi,
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.error,
                side: BorderSide(color: AppColors.error.withValues(alpha: 0.55)),
              ),
              icon: const Icon(Icons.warning_amber_rounded, size: 18),
              label: const Text('Report AEFI'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Clock in / break / clock out controls for the selected hospital.
class _DutyBar extends StatelessWidget {
  final AffiliationModel hospital;
  final bool busy;
  final ValueChanged<String> onChange;

  const _DutyBar({
    required this.hospital,
    required this.busy,
    required this.onChange,
  });

  @override
  Widget build(BuildContext context) {
    final onDuty = hospital.isOnDutyNow;
    final actions = <Widget>[
      if (hospital.isOnBreak)
        FilledButton(
          onPressed: busy ? null : () => onChange('OnDuty'),
          child: const Text('End break'),
        )
      else if (!onDuty)
        FilledButton(
          onPressed: busy ? null : () => onChange('OnDuty'),
          child: const Text('Clock in'),
        )
      else ...[
        OutlinedButton(
          onPressed: busy ? null : () => onChange('OnBreak'),
          child: const Text('Take break'),
        ),
        if (hospital.isClockedIn)
          OutlinedButton(
            onPressed: busy ? null : () => onChange('Off'),
            child: const Text('Clock out'),
          ),
      ],
    ];

    // Status on its own line, buttons below, so narrow phones never overflow.
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: StaffSurfaces.softWell(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                onDuty ? Icons.circle : Icons.circle_outlined,
                size: 12,
                color: onDuty ? AppColors.success : StaffSurfaces.textSecondary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  onDuty
                      ? hospital.dutyLabel
                      : '${hospital.dutyLabel} · clock in for walk-ins or cover',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: actions),
        ],
      ),
    );
  }
}

class _ObservationCard extends StatelessWidget {
  final StaffAppointmentModel patient;
  final int? minsLeft;
  final bool busy;
  /// Set when a colleague has this session; replaces Discharge with Take over.
  final String? ownerLabel;
  final VoidCallback? onTakeOver;
  final VoidCallback onDischarge;
  final VoidCallback onAefi;

  const _ObservationCard({
    required this.patient,
    required this.minsLeft,
    required this.busy,
    required this.ownerLabel,
    required this.onTakeOver,
    required this.onDischarge,
    required this.onAefi,
  });

  @override
  Widget build(BuildContext context) {
    final watch = minsLeft == null
        ? 'Under observation'
        : (minsLeft == 0
            ? 'Observation window complete'
            : '$minsLeft min remaining');
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      patient.patientName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        color: StaffSurfaces.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      watch,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: StaffSurfaces.textSecondary,
                      ),
                    ),
                    if (ownerLabel != null) ...[
                      const SizedBox(height: 4),
                      _SessionOwnerText(label: ownerLabel!),
                    ],
                  ],
                ),
              ),
              if (ownerLabel == null)
                FilledButton(
                  onPressed: busy || !patient.isPaymentSettled ? null : onDischarge,
                  style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                  child: const Text('Discharge'),
                )
              else if (onTakeOver != null)
                OutlinedButton(
                  onPressed: busy ? null : onTakeOver,
                  child: const Text('Take over'),
                ),
            ],
          ),
          if (ownerLabel == null) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: busy ? null : onAefi,
                icon: const Icon(Icons.warning_amber_rounded, size: 16),
                label: const Text('Report AEFI'),
                style: TextButton.styleFrom(foregroundColor: AppColors.error),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "With B01 · Nurse Kavindi" on a colleague's live session.
class _SessionOwnerText extends StatelessWidget {
  final String label;

  const _SessionOwnerText({required this.label});

  @override
  Widget build(BuildContext context) {
    return Text(
      'With $label',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: AppColors.info,
      ),
    );
  }
}

class _AppointmentCard extends StatelessWidget {
  final StaffAppointmentModel appointment;
  final bool busy;
  /// Set when a colleague has this session; replaces the clinical action with Take over.
  final String? ownerLabel;
  final VoidCallback? onTakeOver;
  final bool canPrescribe;
  final VoidCallback onPrescribe;
  final VoidCallback onExamine;
  final VoidCallback onCheckIn;
  final VoidCallback onCertify;
  final VoidCallback onDischarge;

  const _AppointmentCard({
    required this.appointment,
    required this.busy,
    required this.ownerLabel,
    required this.onTakeOver,
    required this.canPrescribe,
    required this.onPrescribe,
    required this.onExamine,
    required this.onCheckIn,
    required this.onCertify,
    required this.onDischarge,
  });

  StaffChipTone _toneFor(String uiStatus) {
    switch (uiStatus) {
      case 'completed':
        return StaffChipTone.success;
      case 'waiting':
        return StaffChipTone.warning;
      case 'cancelled':
        return StaffChipTone.danger;
      case 'observation':
      case 'consulting':
        return StaffChipTone.brand;
      default:
        return StaffChipTone.brand;
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final tone = _toneFor(a.uiStatus);
    final barColor = switch (tone) {
      StaffChipTone.success => AppColors.success,
      StaffChipTone.warning => AppColors.warning,
      StaffChipTone.danger => AppColors.error,
      _ => StaffSurfaces.accentBar,
    };
    final borderColor = switch (tone) {
      StaffChipTone.success => AppColors.success.withValues(alpha: 0.28),
      StaffChipTone.warning => AppColors.warningBorder,
      StaffChipTone.danger => AppColors.error.withValues(alpha: 0.28),
      _ => StaffSurfaces.cardBorder,
    };

    Widget? action;
    if (ownerLabel != null) {
      action = onTakeOver == null
          ? null
          : TextButton(
              onPressed: busy ? null : onTakeOver,
              child: const Text(
                'Take over',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            );
    } else if (a.uiStatus == 'waiting' && !a.isCheckedIn) {
      action = TextButton(
        onPressed: busy ? null : onCheckIn,
        child: const Text(
          'Check in',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      );
    } else if (a.uiStatus == 'waiting') {
      action = TextButton(
        onPressed: busy || !a.isPaymentSettled || !a.hasDosage
            ? null
            : onExamine,
        child: Text(
          !a.isPaymentSettled
              ? 'Unpaid'
              : !a.hasDosage
                  ? 'Awaiting dose'
                  : 'Examine',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      );
    } else if (a.uiStatus == 'consulting') {
      action = TextButton(
        onPressed: busy || !a.isPaymentSettled ? null : onCertify,
        child: const Text(
          'Certify',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      );
    } else if (a.uiStatus == 'observation') {
      action = TextButton(
        onPressed: busy || !a.isPaymentSettled ? null : onDischarge,
        child: const Text(
          'Discharge',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(borderColor: borderColor),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 4,
            height: 72,
            decoration: BoxDecoration(
              color: barColor,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${a.token} · ${a.patientName}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ),
                    StaffStatusChip(
                      label: a.statusLabel,
                      tone: _toneFor(a.uiStatus),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  a.vaccineName,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${a.appointmentDate} · ${a.timeLabel} · ${a.isPaymentSettled ? 'Paid' : a.paymentStatus}',
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
                if (a.hasDosage) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Dosage · ${a.prescribedDosage}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: StaffSurfaces.textSecondary,
                    ),
                  ),
                ],
                if (ownerLabel != null) ...[
                  const SizedBox(height: 6),
                  _SessionOwnerText(label: ownerLabel!),
                ],
                if (canPrescribe && appointment.uiStatus == 'waiting') ...[
                  const SizedBox(height: 4),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: busy ? null : onPrescribe,
                      icon: const Icon(Icons.medication_outlined, size: 18),
                      label: Text(
                        appointment.hasDosage ? 'Edit dose' : 'Prescribe dose',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ],
                if (action != null) ...[
                  const SizedBox(height: 4),
                  Align(alignment: Alignment.centerRight, child: action),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
