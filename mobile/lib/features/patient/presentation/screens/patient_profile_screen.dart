import 'package:flutter/material.dart';

import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/medical_history_model.dart';
import '../../data/repositories/patient_repository.dart';

class PatientProfileScreen extends StatefulWidget {
  const PatientProfileScreen({super.key});

  @override
  State<PatientProfileScreen> createState() => _PatientProfileScreenState();
}

class _PatientProfileScreenState extends State<PatientProfileScreen> {
  bool _isEditing = false;
  bool _isLoading = true;
  bool _isSaving = false;

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _dobController = TextEditingController();
  final _nicController = TextEditingController();
  final _emergencyNameController = TextEditingController();
  final _emergencyPhoneController = TextEditingController();

  String _registrationNumber = 'VAX-P-PENDING';
  String _status = 'ACTIVE';
  String? _photoUrl;

  // Medical history state
  PatientMedicalHistoryTimelineModel? _medicalHistory;
  bool _isLoadingMedicalHistory = true;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    await Future.wait([_loadUserProfile(), _loadMedicalHistory()]);
  }

  Future<void> _loadUserProfile() async {
    setState(() => _isLoading = true);
    final user = await AuthRepository.getCurrentUser();
    if (user != null && mounted) {
      setState(() {
        _nameController.text = user.name;
        _emailController.text = user.email;
        if (user.phoneNumber != null) _phoneController.text = user.phoneNumber!;
        if (user.nicNumber != null) _nicController.text = user.nicNumber!;
        if (user.dateOfBirth != null) {
          _dobController.text = user.dateOfBirth!.split('T').first;
        }
        _registrationNumber = user.registrationNumber ?? 'VAX-P-PENDING';
        _status = user.status;
        _photoUrl = resolveMediaUrl(user.profilePhotoUrl);
        _isLoading = false;
      });
    } else {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMedicalHistory() async {
    setState(() => _isLoadingMedicalHistory = true);
    try {
      // The backend wants the patientProfileId (a GUID). Read it from the
      // cached raw user JSON — field name varies by signup version.
      final rawUser = await StorageService.getUser();
      final profileId =
          rawUser?['profileDetails']?['id']?.toString() ??
          rawUser?['patientProfileId']?.toString() ??
          rawUser?['profileId']?.toString();

      if (profileId == null || profileId.isEmpty) {
        if (mounted) setState(() => _isLoadingMedicalHistory = false);
        return;
      }

      final timeline = await PatientRepository.getMedicalHistoryTimeline(
        profileId,
      );
      if (mounted) {
        setState(() {
          _medicalHistory = timeline;
          _isLoadingMedicalHistory = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoadingMedicalHistory = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _dobController.dispose();
    _nicController.dispose();
    _emergencyNameController.dispose();
    _emergencyPhoneController.dispose();
    super.dispose();
  }

  Future<void> _handleSave() async {
    setState(() => _isSaving = true);
    try {
      DateTime? parsedDob;
      if (_dobController.text.trim().isNotEmpty) {
        parsedDob = DateTime.tryParse(_dobController.text.trim());
      }

      final updated = await AuthRepository.updateProfile(
        fullName: _nameController.text.trim(),
        phoneNumber: _phoneController.text.trim(),
        dateOfBirth: parsedDob,
      );

      if (mounted) {
        setState(() {
          _nameController.text = updated.name;
          _emailController.text = updated.email;
          _phoneController.text = updated.phoneNumber ?? '';
          if (updated.nicNumber != null) {
            _nicController.text = updated.nicNumber!;
          }
          if (updated.dateOfBirth != null) {
            _dobController.text = updated.dateOfBirth!.split('T').first;
          }
          _registrationNumber =
              updated.registrationNumber ?? _registrationNumber;
          _status = updated.status;
          _isEditing = false;
          _isSaving = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.success,
            content: Text('Profile details updated successfully!'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.error,
            content: Text('Failed to update profile: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  void _handleLogout() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: StaffSurfaces.cardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
        ),
        title: const Text(
          'Log out?',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: StaffSurfaces.textPrimary,
          ),
        ),
        content: const Text(
          'You will need to sign in again to view your immunization account.',
          style: TextStyle(fontSize: 13.5, color: StaffSurfaces.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Stay',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: StaffSurfaces.textSecondary,
              ),
            ),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await AuthRepository.logout();
              if (!mounted) return;
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (context) => const LoginScreen()),
                (route) => false,
              );
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.error,
              elevation: 0,
            ),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
  }

  void _handleDeleteAccount() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: StaffSurfaces.cardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
        ),
        title: const Text(
          'Delete Account Permanently?',
          style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.error),
        ),
        content: const Text(
          'This will permanently delete your Vaxora patient account, personal records, and vaccination history. This action cannot be undone.',
          style: TextStyle(
            fontSize: 13.5,
            color: StaffSurfaces.textSecondary,
            height: 1.4,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Cancel',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: StaffSurfaces.textSecondary,
              ),
            ),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Deleting account...'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
                await AuthRepository.deleteAccount();
                if (!mounted) return;
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (context) => const LoginScreen()),
                  (route) => false,
                );
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    backgroundColor: AppColors.error,
                    content: Text('Failed to delete account: $e'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.error,
              elevation: 0,
            ),
            child: const Text('Yes, Delete Account'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffSurfaces.appBar(
        title: 'Profile',
        actions: [
          if (!_isLoading)
            _isSaving
                ? const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: Center(
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                : StaffHeaderAction(
                    icon: _isEditing ? Icons.check : Icons.edit_outlined,
                    tooltip: _isEditing ? 'Save' : 'Edit',
                    onPressed: () {
                      if (_isEditing) {
                        _handleSave();
                      } else {
                        setState(() => _isEditing = true);
                      }
                    },
                  ),
        ],
      ),
      body: _isLoading
          ? Center(
              child: CircularProgressIndicator(color: StaffSurfaces.brandSoft),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
              children: [
                // 1. Avatar header
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: StaffSurfaces.card(),
                  child: Column(
                    children: [
                      Container(
                        width: 88,
                        height: 88,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: StaffSurfaces.cardBorder),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: NetworkAvatar(
                          url: _photoUrl,
                          size: 88,
                          fallback: Container(
                            color: StaffSurfaces.softPanelDeep,
                            alignment: Alignment.center,
                            child: Icon(
                              Icons.person,
                              size: 54,
                              color: StaffSurfaces.brandSoft,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _nameController.text.isNotEmpty
                            ? _nameController.text
                            : 'Patient Profile',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'National Registration: $_registrationNumber',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: StaffSurfaces.brandSoft,
                        ),
                      ),
                      const SizedBox(height: 8),
                      StaffStatusChip(
                        label: _status,
                        tone: StaffChipTone.success,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // 2. Personal Info
                _buildSectionCard(
                  title: 'Personal Information',
                  icon: Icons.badge_outlined,
                  children: [
                    _buildField(
                      label: 'Full Name',
                      controller: _nameController,
                      enabled: _isEditing,
                    ),
                    const SizedBox(height: 12),
                    _buildField(
                      label: 'NIC / Passport',
                      controller: _nicController,
                      enabled: false,
                    ),
                    const SizedBox(height: 12),
                    _buildField(
                      label: 'Date of Birth (YYYY-MM-DD)',
                      controller: _dobController,
                      enabled: _isEditing,
                    ),
                    const SizedBox(height: 12),
                    _buildField(
                      label: 'Email Address',
                      controller: _emailController,
                      enabled: false,
                    ),
                    const SizedBox(height: 12),
                    _buildField(
                      label: 'Contact Number',
                      controller: _phoneController,
                      enabled: _isEditing,
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // 3. Medical & Clinical Registry (existing static)
                _buildSectionCard(
                  title: 'Medical & Clinical Registry',
                  icon: Icons.medical_services_outlined,
                  iconColor: AppColors.accentTeal,
                  children: [
                    _buildStaticRow('Registry ID', _registrationNumber),
                    const Divider(color: StaffSurfaces.divider, height: 16),
                    _buildStaticRow('Account Status', _status),
                    const Divider(color: StaffSurfaces.divider, height: 16),
                    _buildStaticRow(
                      'Immunization Record',
                      'National Health Database Verified',
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // 4. NEW — Medical History card
                _buildMedicalHistoryCard(),
                const SizedBox(height: 16),

                // 5. Emergency Contact
                _buildSectionCard(
                  title: 'Emergency Contact',
                  icon: Icons.contact_phone_outlined,
                  iconColor: AppColors.warning,
                  children: [
                    _buildField(
                      label: 'Contact Name & Relationship',
                      controller: _emergencyNameController,
                      enabled: _isEditing,
                    ),
                    const SizedBox(height: 12),
                    _buildField(
                      label: 'Emergency Phone',
                      controller: _emergencyPhoneController,
                      enabled: _isEditing,
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                // 6. Actions
                OutlinedButton.icon(
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Exporting official citizen health dossier (.PDF)',
                        ),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                  icon: const Icon(Icons.file_download_outlined, size: 20),
                  label: const Text('Export health pass (PDF)'),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: StaffSurfaces.cardBorder),
                    foregroundColor: StaffSurfaces.textPrimary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _handleLogout,
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('Log out'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.errorBg,
                    foregroundColor: AppColors.error,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: const BorderSide(color: StaffSurfaces.dangerBorder),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _handleDeleteAccount,
                  icon: const Icon(Icons.delete_forever_outlined, size: 18),
                  label: const Text('Delete Account'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.error,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  // ============================================================
  // Medical History card
  // ============================================================

  Widget _buildMedicalHistoryCard() {
    final records =
        _medicalHistory?.records ?? const <PatientMedicalHistoryRecordModel>[];

    // Group by record type for a scannable layout
    final groups = <String, List<PatientMedicalHistoryRecordModel>>{};
    for (final r in records) {
      groups.putIfAbsent(r.recordType, () => []).add(r);
    }
    const groupOrder = [
      'Diagnosis',
      'Allergy',
      'Medication',
      'Surgery',
      'Other',
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.monitor_heart_outlined,
                size: 18,
                color: AppColors.info,
              ),
              const SizedBox(width: 8),
              const Text(
                'Medical History',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
              const Spacer(),
              if (!_isLoadingMedicalHistory && _medicalHistory != null)
                Text(
                  '${_medicalHistory!.totalRecords} record'
                  '${_medicalHistory!.totalRecords == 1 ? '' : 's'}',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),

          if (_isLoadingMedicalHistory)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else if (records.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No medical history on file yet.',
                style: TextStyle(
                  fontSize: 13,
                  fontStyle: FontStyle.italic,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final groupKey in groupOrder)
                  if ((groups[groupKey] ?? []).isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: 4, bottom: 6),
                      child: Text(
                        '$groupKey'.toUpperCase(),
                        style: const TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.6,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                    ),
                    for (final rec in groups[groupKey]!)
                      _buildMedicalHistoryRow(rec),
                    const SizedBox(height: 8),
                  ],
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildMedicalHistoryRow(PatientMedicalHistoryRecordModel rec) {
    final severityColor = _severityColor(rec.severity);
    final statusColor = _historyStatusColor(rec.status);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: StaffSurfaces.softPanel,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: StaffSurfaces.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            rec.title,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: StaffSurfaces.textPrimary,
            ),
          ),
          if (rec.icd10Code != null && rec.icd10Code!.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              'ICD-10: ${rec.icd10Code}',
              style: const TextStyle(
                fontSize: 10.5,
                color: StaffSurfaces.textMutedSoft,
              ),
            ),
          ],
          if (rec.description != null && rec.description!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              rec.description!,
              style: const TextStyle(
                fontSize: 11.5,
                color: StaffSurfaces.textSecondary,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: 6),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: severityColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  rec.severity.toUpperCase(),
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: severityColor,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  rec.status,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Color _severityColor(String severity) {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'severe':
        return AppColors.error;
      case 'moderate':
        return AppColors.warning;
      case 'mild':
        return AppColors.info;
      default:
        return AppColors.textMuted;
    }
  }

  Color _historyStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'active':
      case 'chronic':
        return AppColors.warning;
      case 'resolved':
      case 'inremission':
        return AppColors.success;
      default:
        return AppColors.textMuted;
    }
  }

  // ============================================================
  // Shared helpers
  // ============================================================

  Widget _buildSectionCard({
    required String title,
    required IconData icon,
    required List<Widget> children,
    Color? iconColor,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: iconColor ?? StaffSurfaces.brandSoft),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }

  Widget _buildField({
    required String label,
    required TextEditingController controller,
    required bool enabled,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
            color: StaffSurfaces.textSecondary,
          ),
        ),
        const SizedBox(height: 5),
        TextField(
          controller: controller,
          enabled: enabled,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: StaffSurfaces.textPrimary,
          ),
          decoration: InputDecoration(
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 11,
            ),
            fillColor: enabled ? StaffSurfaces.cardBg : StaffSurfaces.softPanel,
            filled: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: StaffSurfaces.brandSoft),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildStaticRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            color: StaffSurfaces.textSecondary,
            fontWeight: FontWeight.w500,
          ),
        ),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: StaffSurfaces.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}
