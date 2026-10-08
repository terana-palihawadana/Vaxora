import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';

class PatientAppointment {
  final String id;
  final String rawId;
  final String vaccineName;
  final String hospitalName;
  final String location;
  final String date;
  final String time;
  final String doctorName;
  final String status;
  final double fee;
  final bool isPaid;

  const PatientAppointment({
    required this.id,
    this.rawId = '',
    required this.vaccineName,
    required this.hospitalName,
    required this.location,
    required this.date,
    required this.time,
    required this.doctorName,
    required this.status,
    this.fee = 0.0,
    this.isPaid = true,
  });
}

bool isUpcomingPatientAppointment(PatientAppointment appointment) {
  final status = appointment.status.trim().toLowerCase();
  if (status == 'completed' || status == 'cancelled' || status == 'rejected') {
    return false;
  }

  try {
    final date = DateTime.parse(appointment.date);
    final today = DateTime.now();
    final appointmentDay = DateTime(date.year, date.month, date.day);
    final todayStart = DateTime(today.year, today.month, today.day);
    return !appointmentDay.isBefore(todayStart);
  } catch (_) {
    // Keep undated records visible in Upcoming, matching the booking screen.
    return true;
  }
}

class AppointmentCard extends StatelessWidget {
  final PatientAppointment appointment;
  final VoidCallback onViewSlip;
  final VoidCallback? onCancel;
  final VoidCallback? onPayNow;

  const AppointmentCard({
    super.key,
    required this.appointment,
    required this.onViewSlip,
    this.onCancel,
    this.onPayNow,
  });

  StaffChipTone get _tone {
    switch (appointment.status.toLowerCase()) {
      case 'confirmed':
      case 'completed':
        return StaffChipTone.success;
      case 'cancelled':
      case 'rejected':
        return StaffChipTone.danger;
      case 'pendingpayment':
      case 'pending':
        return StaffChipTone.warning;
      case 'administering':
      case 'observation':
        return StaffChipTone.brand;
      default:
        return StaffChipTone.warning;
    }
  }

  String get _statusLabel {
    switch (appointment.status.toLowerCase()) {
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
        return appointment.status;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isCancelled = appointment.status.toLowerCase() == 'cancelled' ||
        appointment.status.toLowerCase() == 'rejected';
    final isPaymentComplete = appointment.isPaid ||
        appointment.status.toLowerCase() == 'confirmed' ||
        appointment.status.toLowerCase() == 'completed' ||
        appointment.status.toLowerCase() == 'administering' ||
        appointment.status.toLowerCase() == 'observation';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: switch (_tone) {
          StaffChipTone.success => AppColors.success.withValues(alpha: 0.28),
          StaffChipTone.danger => AppColors.error.withValues(alpha: 0.28),
          StaffChipTone.warning => AppColors.warningBorder,
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
                  appointment.hospitalName,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ),
              StaffStatusChip(label: _statusLabel, tone: _tone),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            appointment.vaccineName,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: StaffSurfaces.brandSoft,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            appointment.location,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: StaffSurfaces.softWell(),
            child: Row(
              children: [
                Icon(
                  Icons.schedule_outlined,
                  size: 14,
                  color: StaffSurfaces.brandSoft,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '${appointment.date}  ·  ${appointment.time}',
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: StaffSurfaces.textPrimary,
                    ),
                  ),
                ),
                Text(
                  appointment.doctorName,
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (isCancelled)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
              decoration: BoxDecoration(
                color: AppColors.errorBg,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: AppColors.error.withValues(alpha: 0.25),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.cancel_outlined, size: 16, color: AppColors.error),
                  SizedBox(width: 8),
                  Text(
                    'Appointment cancelled',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.error,
                    ),
                  ),
                ],
              ),
            )
          else
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onViewSlip,
                    icon: const Icon(Icons.qr_code_2, size: 16),
                    label: const Text('QR slip'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: StaffSurfaces.textPrimary,
                      side: const BorderSide(color: StaffSurfaces.cardBorder),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
                if (!isPaymentComplete &&
                    appointment.fee > 0 &&
                    onPayNow != null) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: onPayNow,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.success,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        textStyle: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      child: Text(
                        'Pay LKR ${appointment.fee.toStringAsFixed(0)}',
                      ),
                    ),
                  ),
                ],
                if (appointment.status.toLowerCase() != 'completed' &&
                    appointment.status.toLowerCase() != 'administering' &&
                    appointment.status.toLowerCase() != 'observation' &&
                    appointment.status.toLowerCase() != 'cancelled' &&
                    appointment.status.toLowerCase() != 'rejected' &&
                    onCancel != null) ...[
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: onCancel,
                    tooltip: 'Cancel appointment',
                    icon: const Icon(Icons.close, size: 18, color: AppColors.error),
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.errorBg,
                      padding: const EdgeInsets.all(8),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ],
              ],
            ),
        ],
      ),
    );
  }
}
