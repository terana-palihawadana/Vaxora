import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/models/user_model.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/repositories/appointment_repository.dart';
import '../widgets/agent_booking_sheet.dart';
import '../widgets/appointment_card.dart';
import '../widgets/book_appointment_sheet.dart';
import '../widgets/digital_certificate_sheet.dart';
import '../widgets/payhere_checkout_sheet.dart';

class PatientAppointmentsScreen extends StatefulWidget {
  final List<PatientAppointment>? initialAppointments;
  final Function(Map<String, dynamic> appointmentData)? onAppointmentBooked;
  final VoidCallback? onAppointmentsChanged;

  const PatientAppointmentsScreen({
    super.key,
    this.initialAppointments,
    this.onAppointmentBooked,
    this.onAppointmentsChanged,
  });

  @override
  State<PatientAppointmentsScreen> createState() => _PatientAppointmentsScreenState();
}

class _PatientAppointmentsScreenState extends State<PatientAppointmentsScreen> {
  int _selectedFilter = 0; // 0: Upcoming, 1: Past

  late List<PatientAppointment> _appointments;
  UserModel? _user;
  bool _isLoading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _appointments = widget.initialAppointments ?? [];
    _loadBackendAppointments();
  }

  Future<void> _loadBackendAppointments() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });
    try {
      final backendList = await AppointmentRepository.getMyAppointments();
      final user = await AuthRepository.getCurrentUser();
      if (mounted) {
        setState(() {
          _user = user;
          _appointments = backendList
              .map(
                (b) => PatientAppointment(
                  id: b.referenceNumber ?? (b.id.length > 8 ? b.id.substring(0, 8) : b.id),
                  rawId: b.id,
                  vaccineName: b.vaccineName,
                  hospitalName: b.hospitalName,
                  location: 'Assigned Vaccination Center',
                  date: b.appointmentDate,
                  time: b.timeSlot,
                  doctorName: 'Medical Officer',
                  status: b.status,
                  fee: b.fee ?? 0.0,
                  isPaid: b.isPaid || b.status.toLowerCase() == 'confirmed' || b.status.toLowerCase() == 'completed',
                ),
              )
              .toList();
          _isLoading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadError = error.toString();
        });
      }
    }
  }

  void _openAgentBookingSheet() {
    AgentBookingSheet.show(
      context,
      onAppointmentBooked: () {
        _loadBackendAppointments();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.success,
            content: Text('Appointment confirmed via AI Concierge!'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      },
    ).then((_) {
      // Automatically refresh appointments when the AI Concierge sheet closes
      _loadBackendAppointments();
    });
  }

  void _openBookSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => BookAppointmentSheet(
        onAppointmentBooked: (data) {
          final newApt = PatientAppointment(
            id: data['id'] as String,
            rawId: (data['rawId'] ?? data['id']) as String,
            vaccineName: data['vaccineName'] as String,
            hospitalName: data['hospitalName'] as String,
            location: data['location'] as String,
            date: data['date'] as String,
            time: data['time'] as String,
            doctorName: data['doctorName'] as String,
            status: data['status'] as String,
            fee: (data['fee'] as num).toDouble(),
            isPaid: data['isPaid'] as bool,
          );

          setState(() {
            _appointments.insert(0, newApt);
          });

          widget.onAppointmentBooked?.call(data);

          if (!newApt.isPaid && newApt.fee > 0) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                backgroundColor: const Color(0xFF003366),
                content: Text('Reserved! Pay LKR ${newApt.fee.toStringAsFixed(0)} via PayHere.'),
                action: SnackBarAction(
                  label: 'Pay Now',
                  textColor: const Color(0xFFFF9900),
                  onPressed: () => _payNow(newApt),
                ),
                behavior: SnackBarBehavior.floating,
                duration: const Duration(seconds: 8),
              ),
            );
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                backgroundColor: AppColors.success,
                content: Text('Appointment confirmed for ${newApt.vaccineName}!'),
                behavior: SnackBarBehavior.floating,
              ),
            );
          }
        },
      ),
    );
  }

  void _showSlipSheet(PatientAppointment apt) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => DigitalCertificateSheet(
        vaccineName: apt.vaccineName,
        dose: 'Appointment Verification',
        administeredDate: apt.date,
        administeredBy: apt.doctorName,
        centerName: apt.hospitalName,
        patientName: _user?.name.toUpperCase() ?? 'VALUED CITIZEN',
        vaxoraId: _user?.registrationNumber ?? apt.id,
        nic: _user?.nicNumber ?? _user?.registrationNumber ?? 'VAX-P-RECORD',
      ),
    );
  }

  void _cancelAppointment(PatientAppointment apt) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: StaffSurfaces.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius)),
        title: const Text(
          'Cancel appointment?',
          style: TextStyle(fontWeight: FontWeight.w700, color: StaffSurfaces.textPrimary),
        ),
        content: Text(
          'Cancel your ${apt.vaccineName} session at ${apt.hospitalName}?',
          style: const TextStyle(fontSize: 13.5, color: StaffSurfaces.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Keep',
              style: TextStyle(fontWeight: FontWeight.w600, color: StaffSurfaces.textSecondary),
            ),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                final targetId = apt.rawId.isNotEmpty ? apt.rawId : apt.id;
                await AppointmentRepository.cancelAppointment(targetId);
                if (mounted) {
                  setState(() {
                    _appointments = _appointments.map((a) {
                      if ((apt.rawId.isNotEmpty && a.rawId == apt.rawId) || a.id == apt.id) {
                        return PatientAppointment(
                          id: a.id,
                          rawId: a.rawId,
                          vaccineName: a.vaccineName,
                          hospitalName: a.hospitalName,
                          location: a.location,
                          date: a.date,
                          time: a.time,
                          doctorName: a.doctorName,
                          status: 'Cancelled',
                          fee: a.fee,
                          isPaid: a.isPaid,
                        );
                      }
                      return a;
                    }).toList();
                  });
                }
                _loadBackendAppointments();
                widget.onAppointmentsChanged?.call();
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      backgroundColor: AppColors.error,
                      content: Text('Appointment cancelled.'),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      backgroundColor: AppColors.error,
                      content: Text('Failed to cancel: $e'),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                }
              }
            },
            style: FilledButton.styleFrom(backgroundColor: AppColors.error, elevation: 0),
            child: const Text('Cancel session'),
          ),
        ],
      ),
    );
  }

  void _payNow(PatientAppointment apt) {
    PayHereCheckoutSheet.show(
      context,
      appointment: apt,
      onPaymentSuccess: () {
        setState(() {
          _appointments = _appointments.map((a) {
            if ((apt.rawId.isNotEmpty && a.rawId == apt.rawId) || a.id == apt.id) {
              return PatientAppointment(
                id: a.id,
                rawId: a.rawId,
                vaccineName: a.vaccineName,
                hospitalName: a.hospitalName,
                location: a.location,
                date: a.date,
                time: a.time,
                doctorName: a.doctorName,
                status: 'Confirmed',
                fee: a.fee,
                isPaid: true,
              );
            }
            return a;
          }).toList();
        });
        _loadBackendAppointments();
        widget.onAppointmentsChanged?.call();
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final upcomingList = _appointments.where(isUpcomingPatientAppointment).toList();
    final pastList = _appointments.where((a) => !isUpcomingPatientAppointment(a)).toList();
    final filteredAppointments = _selectedFilter == 0 ? upcomingList : pastList;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _user?.name.isNotEmpty == true ? _user!.name : 'Citizen',
        subtitle: 'Patient · Bookings',
        photoUrl: resolveMediaUrl(_user?.profilePhotoUrl),
        actions: [
          StaffHeaderAction(icon: Icons.auto_awesome, tooltip: 'Book with AI', onPressed: _openAgentBookingSheet),
          StaffHeaderAction(icon: Icons.add, tooltip: 'Manual booking', onPressed: _openBookSheet),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadBackendAppointments,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Vaccination bookings',
              title: _selectedFilter == 0 ? 'Upcoming sessions' : 'Past sessions',
              subtitle: _selectedFilter == 0
                  ? 'Confirmed and pending slots you can still manage.'
                  : 'Completed and cancelled sessions on your record.',
              stats: [
                StaffIntroStat(
                  label: 'Upcoming',
                  value: '${upcomingList.length}',
                  icon: Icons.event_note_outlined,
                  accent: upcomingList.isNotEmpty ? const Color(0xFFB2660A) : StaffSurfaces.brandSoft,
                ),
                StaffIntroStat(
                  label: 'Past',
                  value: '${pastList.length}',
                  icon: Icons.history,
                  accent: AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(4),
              decoration: StaffSurfaces.softWell(),
              child: Row(
                children: [
                  Expanded(
                    child: _FilterChip(
                      label: 'Upcoming',
                      selected: _selectedFilter == 0,
                      onTap: () => setState(() => _selectedFilter = 0),
                    ),
                  ),
                  Expanded(
                    child: _FilterChip(
                      label: 'Past',
                      selected: _selectedFilter == 1,
                      onTap: () => setState(() => _selectedFilter = 1),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            StaffSectionHeader(
              title: _selectedFilter == 0 ? 'Sessions' : 'History',
              count: filteredAppointments.length,
            ),
            if (_isLoading && _appointments.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Center(child: CircularProgressIndicator(color: StaffSurfaces.brandSoft)),
              )
            else if (_loadError != null)
              Column(
                children: [
                  StaffEmptyCard(message: 'Unable to load appointments: $_loadError', icon: Icons.cloud_off_outlined),
                  TextButton.icon(
                    onPressed: _isLoading ? null : _loadBackendAppointments,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'),
                  ),
                ],
              )
            else if (filteredAppointments.isEmpty)
              StaffEmptyCard(
                message: _selectedFilter == 0
                    ? 'No upcoming sessions. Book a slot with AI or the form.'
                    : 'No past appointments on record.',
                icon: Icons.event_busy_outlined,
              )
            else
              ...filteredAppointments.map(
                (apt) => AppointmentCard(
                  appointment: apt,
                  onViewSlip: () => _showSlipSheet(apt),
                  onCancel: () => _cancelAppointment(apt),
                  onPayNow:
                      (!apt.isPaid &&
                          apt.status.toLowerCase() != 'confirmed' &&
                          apt.status.toLowerCase() != 'completed' &&
                          apt.status.toLowerCase() != 'cancelled')
                      ? () => _payNow(apt)
                      : null,
                ),
              ),
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

  const _FilterChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: selected ? StaffSurfaces.cardBg : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: selected ? StaffSurfaces.cardBorder : Colors.transparent),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: selected ? StaffSurfaces.brandSoft : StaffSurfaces.textSecondary,
          ),
        ),
      ),
    );
  }
}
