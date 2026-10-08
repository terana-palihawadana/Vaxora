import 'package:flutter/material.dart';

import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/models/user_model.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/appointment_model.dart';
import '../../data/models/vaccination_record_model.dart';
import '../../data/repositories/agent_repository.dart';
import '../../data/repositories/appointment_repository.dart';
import '../../data/repositories/patient_repository.dart';
import '../widgets/agent_booking_sheet.dart';
import '../widgets/book_appointment_sheet.dart';
import '../widgets/digital_certificate_sheet.dart';
import '../widgets/immunization_timeline_item.dart';
import '../widgets/appointment_card.dart';
import '../widgets/payhere_checkout_sheet.dart';
import '../widgets/care_plan_sheet.dart';
import '../widgets/care_plan_history_sheet.dart';

class PatientDashboardScreen extends StatefulWidget {
  final Function(int targetTab) onNavigateTab;
  final Function(Map<String, dynamic> appointmentData)? onAppointmentBooked;

  const PatientDashboardScreen({super.key, required this.onNavigateTab, this.onAppointmentBooked});

  @override
  State<PatientDashboardScreen> createState() => _PatientDashboardScreenState();
}

class _PatientDashboardScreenState extends State<PatientDashboardScreen> {
  UserModel? _user;
  List<AppointmentModel> _appointments = [];
  PatientVaccinationTimelineModel? _timeline;
  bool _isLoading = true;
  String? _appointmentsError;

  @override
  void initState() {
    super.initState();
    _loadDashboardData();
  }

  Future<void> _loadDashboardData() async {
    setState(() => _isLoading = true);

    // 1. Get cached or fresh user profile
    final cached = await StorageService.getUser();
    UserModel? user = cached != null ? UserModel.fromJson(cached) : null;
    try {
      final freshUser = await AuthRepository.getCurrentUser();
      if (freshUser != null) user = freshUser;
    } catch (_) {}

    // 2. Fetch real appointments from backend
    List<AppointmentModel>? appts;
    String? appointmentsError;
    try {
      appts = await AppointmentRepository.getMyAppointments();
    } catch (error) {
      appointmentsError = error.toString();
    }

    // 3. Fetch real vaccination timeline if profile ID exists
    PatientVaccinationTimelineModel? timeline;
    if (user?.patientProfileId != null && user!.patientProfileId!.isNotEmpty) {
      try {
        timeline = await PatientRepository.getVaccinationTimeline(user.patientProfileId!);
      } catch (_) {}
    }

    if (mounted) {
      setState(() {
        _user = user;
        if (appts != null) _appointments = appts;
        _appointmentsError = appointmentsError;
        _timeline = timeline;
        _isLoading = false;
      });
    }
  }

  void _openBookSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => BookAppointmentSheet(
        onAppointmentBooked: (data) {
          widget.onAppointmentBooked?.call(data);
          _loadDashboardData();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: AppColors.success,
              content: Text('Appointment reserved for ${data['vaccineName']}!'),
              behavior: SnackBarBehavior.floating,
            ),
          );
        },
      ),
    );
  }

  void _openAgentBookingSheet(BuildContext context) {
    AgentBookingSheet.show(
      context,
      onAppointmentBooked: () {
        _loadDashboardData();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.success,
            content: Text('Appointment confirmed via AI Concierge!'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      },
    );
  }

  void _openCarePlanSheet(BuildContext context) {
    final profileId = _user?.patientProfileId;
    if (profileId == null || profileId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: AppColors.error,
          content: Text('Patient profile ID not found. Please log in again.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    CarePlanSheet.show(context, loader: () => AgentRepository.generatePatientCarePlan(profileId));
  }

  void _openDigitalPassSheet(BuildContext context, {AppointmentModel? appt}) {
    final userName = _user?.name.toUpperCase() ?? 'VAXORA CITIZEN';
    final regNo = _user?.registrationNumber ?? 'VAX-P-PENDING';
    final nic = _user?.nicNumber ?? 'N/A';

    final vaccineName =
        appt?.vaccineName ??
        (_timeline?.records.isNotEmpty == true ? _timeline!.records.first.vaccineName : 'Vaxora Certified Health Pass');

    final dose = appt != null
        ? (appt.doseNumber ?? 'Scheduled Dose')
        : (_timeline?.records.isNotEmpty == true ? 'Dose ${_timeline!.records.first.doseNumber}' : 'Pass Active');

    final date =
        appt?.appointmentDate ??
        (_timeline?.lastVaccinatedAt != null
            ? '${_timeline!.lastVaccinatedAt!.year}-${_timeline!.lastVaccinatedAt!.month.toString().padLeft(2, '0')}-${_timeline!.lastVaccinatedAt!.day.toString().padLeft(2, '0')}'
            : 'Active 2026');

    final center =
        appt?.hospitalName ??
        (_timeline?.records.isNotEmpty == true
            ? _timeline!.records.first.administeredByName
            : 'National Immunization Network');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => DigitalCertificateSheet(
        vaccineName: vaccineName,
        dose: dose,
        administeredDate: date,
        administeredBy: 'Authorized Medical Officer',
        centerName: center,
        patientName: userName,
        vaxoraId: regNo,
        nic: nic,
      ),
    );
  }

  StaffChipTone _chipTone(String status) {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'confirmed':
      case 'approved':
      case 'paid':
        return StaffChipTone.success;
      case 'cancelled':
      case 'declined':
      case 'rejected':
        return StaffChipTone.danger;
      case 'due soon':
      case 'pending':
      case 'pendingpayment':
        return StaffChipTone.warning;
      case 'administering':
      case 'observation':
        return StaffChipTone.brand;
      default:
        return StaffChipTone.brand;
    }
  }

  String _statusLabel(String status) {
    switch (status.toLowerCase()) {
      case 'pendingpayment':
        return 'Awaiting payment';
      case 'administering':
        return 'In session';
      case 'observation':
        return 'Observation';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'rejected':
        return 'Rejected';
      case 'confirmed':
        return 'Confirmed';
      default:
        return status;
    }
  }

  ButtonStyle get _ctaStyle => FilledButton.styleFrom(
    backgroundColor: StaffSurfaces.cta,
    foregroundColor: Colors.white,
    elevation: 0,
    padding: const EdgeInsets.symmetric(vertical: 12),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
  );

  ButtonStyle get _outlineStyle => OutlinedButton.styleFrom(
    foregroundColor: StaffSurfaces.textPrimary,
    side: const BorderSide(color: StaffSurfaces.cardBorder),
    padding: const EdgeInsets.symmetric(vertical: 12),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
  );

  @override
  Widget build(BuildContext context) {
    final userName = _user?.name.isNotEmpty == true ? _user!.name : 'Citizen';
    final upcomingAppointments = _appointments
        .where((a) => a.status.toLowerCase() != 'cancelled' && a.status.toLowerCase() != 'completed')
        .toList();
    final nextAppointment = upcomingAppointments.isNotEmpty ? upcomingAppointments.first : null;
    final totalDoses =
        _timeline?.totalDoses ?? _appointments.where((a) => a.status.toLowerCase() == 'completed').length;
    final scheduledCount = upcomingAppointments.length;
    final photoUrl = resolveMediaUrl(_user?.profilePhotoUrl);

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: userName,
        subtitle: 'Patient · Home',
        photoUrl: photoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.qr_code_2,
            tooltip: 'Health pass',
            onPressed: () => _openDigitalPassSheet(context, appt: nextAppointment),
          ),
          StaffHeaderAction(icon: Icons.refresh, tooltip: 'Refresh', onPressed: _isLoading ? null : _loadDashboardData),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboardData,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Patient home',
              title: 'Your immunization',
              subtitle: _appointmentsError != null
                  ? 'Unable to load appointments: $_appointmentsError'
                  : nextAppointment != null
                  ? 'Next: ${nextAppointment.vaccineName} on ${nextAppointment.appointmentDate}.'
                  : 'No upcoming session. Book a dose with AI or the form.',
              stats: [
                StaffIntroStat(
                  label: 'Received',
                  value: _appointmentsError != null && _timeline == null ? '—' : '$totalDoses',
                  icon: Icons.vaccines_outlined,
                  accent: AppColors.success,
                ),
                StaffIntroStat(
                  label: 'Upcoming',
                  value: _appointmentsError == null ? '$scheduledCount' : '—',
                  icon: Icons.event_note_outlined,
                  accent: scheduledCount > 0 ? const Color(0xFFB2660A) : StaffSurfaces.brandSoft,
                ),
                StaffIntroStat(
                  label: 'Vaccines',
                  value: '${_timeline?.distinctVaccines ?? 0}',
                  icon: Icons.health_and_safety_outlined,
                  accent: const Color(0xFF6D5BAE),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Row 1 — booking actions
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _openAgentBookingSheet(context),
                    icon: const Icon(Icons.auto_awesome, size: 18),
                    label: const Text('Book with AI'),
                    style: _ctaStyle,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _openBookSheet(context),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Manual form'),
                    style: _outlineStyle,
                  ),
                ),
              ],
            ),

            // Row 2 — AI care plan actions (was added on Patient-Management branch)
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _openCarePlanSheet(context),
                    icon: const Icon(Icons.auto_awesome, size: 18),
                    label: const Text('AI care plan'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF168B91),
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => CarePlanHistorySheet.show(context),
                    icon: const Icon(Icons.history, size: 18),
                    label: const Text('Saved plans'),
                    style: _outlineStyle,
                  ),
                ),
              ],
            ),

            if (_isLoading && _appointments.isEmpty && _timeline == null) ...[
              const SizedBox(height: 36),
              Center(child: CircularProgressIndicator(color: StaffSurfaces.brandSoft)),
            ],
            const SizedBox(height: 18),
            StaffSectionHeader(
              title: 'Next appointment',
              trailing: TextButton(
                onPressed: () => widget.onNavigateTab(1),
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  foregroundColor: StaffSurfaces.brandSoft,
                ),
                child: const Text('View all', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ),
            if (nextAppointment == null && _appointmentsError != null)
              Column(
                children: [
                  StaffEmptyCard(
                    message: 'Unable to load appointments: $_appointmentsError',
                    icon: Icons.cloud_off_outlined,
                  ),
                  TextButton.icon(
                    onPressed: _isLoading ? null : _loadDashboardData,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'),
                  ),
                ],
              )
            else if (nextAppointment == null)
              const StaffEmptyCard(
                message: 'No upcoming sessions. Book a dose with AI or the form.',
                icon: Icons.event_available_outlined,
              )
            else
              Container(
                padding: const EdgeInsets.all(14),
                decoration: StaffSurfaces.card(
                  borderColor: switch (_chipTone(nextAppointment.status)) {
                    StaffChipTone.success => AppColors.success.withValues(alpha: 0.28),
                    StaffChipTone.danger => AppColors.error.withValues(alpha: 0.28),
                    StaffChipTone.warning => const Color(0xFFF5B168),
                    _ => StaffSurfaces.cardBorder,
                  },
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            nextAppointment.hospitalName,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: StaffSurfaces.textPrimary,
                            ),
                          ),
                        ),
                        StaffStatusChip(
                          label: _statusLabel(nextAppointment.status),
                          tone: _chipTone(nextAppointment.status),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      nextAppointment.vaccineName,
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: StaffSurfaces.brandSoft),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Ref ${nextAppointment.referenceNumber ?? (nextAppointment.id.length > 8 ? nextAppointment.id.substring(0, 8) : nextAppointment.id)}',
                      style: const TextStyle(fontSize: 12, color: StaffSurfaces.textSecondary),
                    ),
                    const SizedBox(height: 10),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: StaffSurfaces.softWell(),
                      child: Text(
                        '${nextAppointment.appointmentDate}  ·  ${nextAppointment.timeSlot}',
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        if (!nextAppointment.isPaid &&
                            (nextAppointment.fee ?? 0) > 0 &&
                            nextAppointment.status.toLowerCase() != 'confirmed' &&
                            nextAppointment.status.toLowerCase() != 'completed' &&
                            nextAppointment.status.toLowerCase() != 'cancelled') ...[
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: () {
                                final apt = PatientAppointment(
                                  id:
                                      nextAppointment.referenceNumber ??
                                      (nextAppointment.id.length > 8
                                          ? nextAppointment.id.substring(0, 8)
                                          : nextAppointment.id),
                                  rawId: nextAppointment.id,
                                  vaccineName: nextAppointment.vaccineName,
                                  hospitalName: nextAppointment.hospitalName,
                                  location: 'Assigned Center',
                                  date: nextAppointment.appointmentDate,
                                  time: nextAppointment.timeSlot,
                                  doctorName: 'Medical Officer',
                                  status: nextAppointment.status,
                                  fee: nextAppointment.fee ?? 0.0,
                                  isPaid: nextAppointment.isPaid,
                                );
                                PayHereCheckoutSheet.show(
                                  context,
                                  appointment: apt,
                                  onPaymentSuccess: _loadDashboardData,
                                );
                              },
                              icon: const Icon(Icons.payment, size: 16),
                              label: Text('Pay LKR ${(nextAppointment.fee ?? 0).toStringAsFixed(0)}'),
                              style: FilledButton.styleFrom(
                                backgroundColor: AppColors.success,
                                foregroundColor: Colors.white,
                                elevation: 0,
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                        ],
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => widget.onNavigateTab(1),
                            style: _outlineStyle,
                            child: const Text('Manage'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton(
                            onPressed: () => _openDigitalPassSheet(context, appt: nextAppointment),
                            style: _ctaStyle,
                            child: const Text('View slip'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 18),
            StaffSectionHeader(title: 'Travel advisory'),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: StaffSurfaces.card(),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(color: AppColors.infoBg, borderRadius: BorderRadius.circular(10)),
                    child: const Icon(Icons.flight_takeoff_outlined, size: 18, color: AppColors.accent),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'International travel',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: StaffSurfaces.textPrimary),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Renew Yellow Fever and Meningococcal records 14 days before departure.',
                          style: TextStyle(fontSize: 12.5, color: StaffSurfaces.textSecondary, height: 1.4),
                        ),
                        const SizedBox(height: 8),
                        GestureDetector(
                          onTap: () => widget.onNavigateTab(2),
                          child: Text(
                            'Check certificates',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: StaffSurfaces.brandSoft),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            StaffSectionHeader(
              title: 'Immunization tracker',
              trailing: TextButton(
                onPressed: () => widget.onNavigateTab(2),
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  foregroundColor: StaffSurfaces.brandSoft,
                ),
                child: const Text('Full history', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ),
            if (_timeline != null && _timeline!.records.isNotEmpty)
              Container(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                decoration: StaffSurfaces.card(),
                child: Column(
                  children: [
                    for (int i = 0; i < _timeline!.records.length && i < 4; i++) ...[
                      if (i > 0) const Divider(color: StaffSurfaces.divider, height: 1),
                      ImmunizationTimelineItem(
                        icon: Icons.vaccines_outlined,
                        name: _timeline!.records[i].vaccineName,
                        target: 'Dose ${_timeline!.records[i].doseNumber} · ${_timeline!.records[i].route}',
                        status: 'Completed',
                        date:
                            '${_timeline!.records[i].administeredAt.year}-${_timeline!.records[i].administeredAt.month.toString().padLeft(2, '0')}-${_timeline!.records[i].administeredAt.day.toString().padLeft(2, '0')}',
                      ),
                    ],
                  ],
                ),
              )
            else if (_appointments.isNotEmpty)
              Container(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                decoration: StaffSurfaces.card(),
                child: Column(
                  children: [
                    for (int i = 0; i < _appointments.length && i < 3; i++) ...[
                      if (i > 0) const Divider(color: StaffSurfaces.divider, height: 1),
                      ImmunizationTimelineItem(
                        icon: Icons.event_outlined,
                        name: _appointments[i].vaccineName,
                        target: '${_appointments[i].hospitalName} · ${_appointments[i].doseNumber ?? "Dose 1"}',
                        status: _appointments[i].status,
                        date: _appointments[i].appointmentDate,
                      ),
                    ],
                  ],
                ),
              )
            else if (_appointmentsError != null)
              StaffEmptyCard(
                compact: true,
                message: 'Unable to load appointment data: $_appointmentsError',
                icon: Icons.cloud_off_outlined,
              )
            else
              const StaffEmptyCard(
                compact: true,
                message: 'Completed doses recorded by officers will appear here.',
                icon: Icons.vaccines_outlined,
              ),
          ],
        ),
      ),
    );
  }
}
