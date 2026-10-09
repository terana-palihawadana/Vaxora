import 'package:flutter/material.dart';

import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/models/user_model.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/vaccination_record_model.dart';
import '../../data/repositories/patient_repository.dart';
import '../widgets/agent_booking_sheet.dart';
import '../widgets/digital_certificate_sheet.dart';
import 'qr_verification_screen.dart';

String _formatShortDate(DateTime date) =>
    '${(date.year % 100).toString().padLeft(2, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

class PatientHistoryScreen extends StatefulWidget {
  const PatientHistoryScreen({super.key});

  @override
  State<PatientHistoryScreen> createState() => _PatientHistoryScreenState();
}

class _PatientHistoryScreenState extends State<PatientHistoryScreen> {
  UserModel? _user;
  PatientVaccinationTimelineModel? _timeline;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadHistoryData();
  }

  Future<void> _loadHistoryData() async {
    setState(() => _isLoading = true);

    final cached = await StorageService.getUser();
    UserModel? user = cached != null ? UserModel.fromJson(cached) : null;
    try {
      final freshUser = await AuthRepository.getCurrentUser();
      if (freshUser != null) user = freshUser;
    } catch (_) {}

    PatientVaccinationTimelineModel? timeline;
    if (user?.patientProfileId != null && user!.patientProfileId!.isNotEmpty) {
      try {
        timeline = await PatientRepository.getVaccinationTimeline(
          user.patientProfileId!,
        );
      } catch (_) {}
    }

    if (mounted) {
      setState(() {
        _user = user;
        _timeline = timeline;
        _isLoading = false;
      });
    }
  }

  void _openCertificate(
    BuildContext context,
    PatientVaccinationRecordModel rec,
  ) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => DigitalCertificateSheet(
        vaccineName: rec.vaccineName,
        dose: 'Dose ${rec.doseNumber}',
        administeredDate: _formatShortDate(rec.administeredAt),
        administeredBy: rec.administeredByName,
        centerName: rec.notes?.isNotEmpty == true
            ? rec.notes!
            : 'National Vaccination Center',
        patientName: _user?.name.toUpperCase() ?? 'CITIZEN',
        vaxoraId: _user?.registrationNumber ?? 'VAX-P-RECORD',
        nic: _user?.nicNumber ?? 'N/A',
      ),
    );
  }

  void _openAgentBookingSheet(BuildContext context) {
    AgentBookingSheet.show(
      context,
      onAppointmentBooked: () {
        _loadHistoryData();
      },
    );
  }

  void _openQrVerification(BuildContext context) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const QrVerificationScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final displayName = _user?.name.isNotEmpty == true
        ? _user!.name
        : 'Citizen';
    final totalDoses = _timeline?.totalDoses ?? 0;
    final distinctVaccines = _timeline?.distinctVaccines ?? 0;
    final lastVaccinated = _timeline?.lastVaccinatedAt != null
        ? _formatShortDate(_timeline!.lastVaccinatedAt!)
        : '—';

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: displayName,
        subtitle: 'Patient · History',
        photoUrl: resolveMediaUrl(_user?.profilePhotoUrl),
        actions: [
          StaffHeaderAction(
            icon: Icons.qr_code_scanner,
            tooltip: 'Verify certificate',
            onPressed: () => _openQrVerification(context),
          ),
          StaffHeaderAction(
            icon: Icons.auto_awesome,
            tooltip: 'Book with AI',
            onPressed: () => _openAgentBookingSheet(context),
          ),
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _isLoading ? null : _loadHistoryData,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadHistoryData,
        color: StaffSurfaces.brandSoft,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Immunization record',
              title: 'Vaccination history',
              subtitle:
                  '${_user?.registrationNumber ?? 'VAX-P-PENDING'} · ${_user?.nicNumber ?? 'NIC pending'}',
              stats: [
                StaffIntroStat(
                  label: 'Doses',
                  value: '$totalDoses',
                  icon: Icons.vaccines_outlined,
                  accent: StaffSurfaces.brandSoft,
                ),
                StaffIntroStat(
                  label: 'Vaccines',
                  value: '$distinctVaccines',
                  icon: Icons.health_and_safety_outlined,
                  accent: AppColors.ai,
                ),
                StaffIntroStat(
                  label: 'Last dose',
                  value: lastVaccinated,
                  icon: Icons.event_available_outlined,
                  accent: AppColors.success,
                ),
              ],
            ),
            const SizedBox(height: 18),
            StaffSectionHeader(
              title: 'Administered doses',
              count: _timeline?.records.length,
            ),
            if (_isLoading)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              )
            else if (_timeline != null && _timeline!.records.isNotEmpty)
              ..._timeline!.records.map((rec) {
                final adminDateStr = _formatShortDate(rec.administeredAt);
                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: StaffSurfaces.card(
                    borderColor: AppColors.success.withValues(alpha: 0.28),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              rec.vaccineName,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: StaffSurfaces.textPrimary,
                              ),
                            ),
                          ),
                          const StaffStatusChip(
                            label: 'Completed',
                            tone: StaffChipTone.success,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Dose ${rec.doseNumber}  ·  ${rec.route}${rec.lotNumber != null ? "  ·  Lot ${rec.lotNumber}" : ""}',
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$adminDateStr  ·  ${rec.administeredByName}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: StaffSurfaces.textMutedSoft,
                        ),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => _openCertificate(context, rec),
                        icon: const Icon(Icons.qr_code_2, size: 16),
                        label: const Text('View certificate'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: StaffSurfaces.textPrimary,
                          side: const BorderSide(
                            color: StaffSurfaces.cardBorder,
                          ),
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
                    ],
                  ),
                );
              })
            else ...[
              const StaffEmptyCard(
                message:
                    'Doses recorded at registered centres will appear here.',
                icon: Icons.verified_user_outlined,
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => _openAgentBookingSheet(context),
                icon: const Icon(Icons.auto_awesome, size: 18),
                label: const Text('Book first dose'),
                style: FilledButton.styleFrom(
                  backgroundColor: StaffSurfaces.cta,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
