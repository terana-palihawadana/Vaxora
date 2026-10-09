import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../auth/presentation/utils/home_route_utils.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../auth/data/models/user_model.dart';
import '../widgets/staff_common_widgets.dart';
import '../widgets/network_avatar.dart';

class StaffProfileScreen extends StatefulWidget {
  const StaffProfileScreen({super.key});

  @override
  State<StaffProfileScreen> createState() => _StaffProfileScreenState();
}

class _StaffProfileScreenState extends State<StaffProfileScreen> {
  UserModel? _user;
  bool _loading = true;
  bool _saving = false;
  bool _isEditing = false;
  String? _error;

  String? _photoUrl;
  String _editingName = '';
  String _editingPhone = '';
  String _specialization = '';
  final ImagePicker _imagePicker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _load();
  }

  String? _resolvePhotoUrl(String? raw) => resolveMediaUrl(raw);

  String? _photoFromMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    return _resolvePhotoUrl(UserModel.fromJson(map).profilePhotoUrl);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    // Show cached photo immediately if we have one.
    final cached = await StorageService.getUser();
    if (mounted && cached != null) {
      setState(() {
        _user = UserModel.fromJson(cached);
        _photoUrl = _photoFromMap(cached);
        _editingName = _user!.name;
        _editingPhone = _user!.phoneNumber ?? '';
        final details = cached['profileDetails'] ?? cached['ProfileDetails'];
        if (details is Map) {
          _specialization = details['specialization']?.toString() ?? '';
        }
      });
    }

    try {
      final user = await AuthRepository.getCurrentUser(forceRefresh: true);
      final fresh = await StorageService.getUser();
      if (!mounted) return;
      setState(() {
        _user = user ?? _user;
        _photoUrl = _photoFromMap(fresh) ??
            _resolvePhotoUrl(user?.profilePhotoUrl) ??
            _photoUrl;
        if (_user != null) {
          _editingName = _user!.name;
          _editingPhone = _user!.phoneNumber ?? '';
        }
        final details = fresh?['profileDetails'] ?? fresh?['ProfileDetails'];
        if (details is Map) {
          _specialization = details['specialization']?.toString() ?? '';
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Could not refresh profile.';
        _photoUrl ??= _photoFromMap(cached);
      });
    }
  }

  Future<void> _saveProfile() async {
    if (_user == null) return;
    setState(() => _saving = true);
    try {
      final updated = await AuthRepository.updateProfile(
        fullName: _editingName,
        phoneNumber: _editingPhone,
        specialization: _user!.role.toUpperCase() == 'DOCTOR'
            ? _specialization
            : null,
      );
      if (!mounted) return;
      setState(() {
        _user = updated;
        _editingName = updated.name;
        _editingPhone = updated.phoneNumber ?? '';
        _isEditing = false;
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile updated.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e is ApiException ? e.message : 'Failed to update profile.'),
          backgroundColor: AppColors.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _pickProfilePhoto() async {
    if (_saving || _user == null) return;
    try {
      final source = await showModalBottomSheet<ImageSource>(
        context: context,
        backgroundColor: StaffSurfaces.appBarBg,
        builder: (context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: StaffSurfaces.cardBorder,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Update profile photo',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.camera_alt_outlined),
                  title: const Text('Take photo'),
                  onTap: () => Navigator.pop(context, ImageSource.camera),
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Choose from photos'),
                  onTap: () => Navigator.pop(context, ImageSource.gallery),
                ),
              ],
            ),
          ),
        ),
      );
      if (source == null || !mounted) return;

      final photo = await _imagePicker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1200,
      );
      if (photo == null || !mounted) return;

      setState(() => _saving = true);
      final updated = await AuthRepository.updateProfilePhoto(photo);
      final fresh = await StorageService.getUser();
      if (!mounted) return;
      setState(() {
        _user = updated;
        _photoUrl = _photoFromMap(fresh) ??
            _resolvePhotoUrl(updated.profilePhotoUrl) ??
            _photoUrl;
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile photo updated.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException ? e.message : 'Failed to update profile photo.',
          ),
          backgroundColor: AppColors.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _logout() async {
    final ok = await confirmAction(
      context,
      title: 'Log out?',
      message: 'You will need to sign in again to access staff tools.',
      cancelLabel: 'Stay',
      confirmLabel: 'Log out',
      destructive: true,
    );
    if (!ok || !mounted) return;
    await AuthRepository.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  void _deleteAccount() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: StaffSurfaces.cardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(StaffSurfaces.cardRadius),
        ),
        title: const Text(
          'Delete Staff Account?',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: AppColors.error,
          ),
        ),
        content: const Text(
          'This will permanently delete your healthcare staff profile, affiliations, and credentials. This action cannot be undone.',
          style: TextStyle(fontSize: 13.5, color: StaffSurfaces.textSecondary, height: 1.4),
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
                    content: Text('Deleting staff account...'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
                await AuthRepository.deleteAccount();
                if (!mounted) return;
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                  (route) => false,
                );
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    backgroundColor: AppColors.error,
                    content: Text('Your Vaxora staff account has been permanently deleted.'),
                    behavior: SnackBarBehavior.floating,
                  ),
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

  String get _roleLabel {
    final raw = _user?.role ?? '';
    final label = staffRoleLabel(raw);
    return label == 'Staff' && raw.isNotEmpty ? raw : label;
  }

  String get _initials {
    final name = _user?.name ?? '';
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return 'V';
    if (parts.length == 1) {
      final w = parts.first;
      return w.substring(0, w.length >= 2 ? 2 : 1).toUpperCase();
    }
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  Widget _avatarFallback() {
    return Container(
      color: StaffSurfaces.softPanelDeep,
      alignment: Alignment.center,
      child: Text(
        _initials,
        style: TextStyle(
          fontSize: 26,
          fontWeight: FontWeight.w700,
          color: StaffSurfaces.brandSoft,
        ),
      ),
    );
  }

  Widget _profileSection({
    required String title,
    required IconData icon,
    required List<Widget> children,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: StaffSurfaces.brandSoft),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: StaffSurfaces.textPrimary)),
            ],
          ),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }

  Widget _profileField({
    required String label,
    required String value,
    bool editable = false,
    TextInputType keyboardType = TextInputType.text,
    ValueChanged<String>? onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.5, color: StaffSurfaces.textSecondary)),
        const SizedBox(height: 5),
        TextFormField(
          key: ValueKey('$label-$_isEditing'),
          initialValue: value,
          enabled: editable && _isEditing,
          keyboardType: keyboardType,
          onChanged: onChanged,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: StaffSurfaces.textPrimary),
          decoration: InputDecoration(
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            fillColor: editable && _isEditing ? StaffSurfaces.cardBg : StaffSurfaces.softPanel,
            filled: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: StaffSurfaces.cardBorder)),
            disabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: StaffSurfaces.cardBorder)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: StaffSurfaces.brandSoft)),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final photo = _photoUrl ?? _resolvePhotoUrl(_user?.profilePhotoUrl);

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffSurfaces.appBar(
        title: 'My Profile',
        actions: [
          StaffHeaderAction(
            icon: _isEditing ? Icons.check : Icons.edit_outlined,
            tooltip: _isEditing ? 'Save profile' : 'Edit profile',
            onPressed: _loading || _saving || _user == null
                ? null
                : _isEditing
                    ? _saveProfile
                    : () => setState(() {
                          _editingName = _user!.name;
                          _editingPhone = _user!.phoneNumber ?? '';
                          _isEditing = true;
                        }),
          ),
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _loading || _saving ? null : _load,
          ),
        ],
      ),
      body: _loading
          ? Center(
              child:
                  CircularProgressIndicator(color: StaffSurfaces.brandSoft),
            )
          : RefreshIndicator(
              onRefresh: _load,
              color: StaffSurfaces.brandSoft,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                children: [
                  if (_error != null) ...[
                    StaffErrorBanner(
                      message: _error!,
                      onDismiss: () => setState(() => _error = null),
                    ),
                    const SizedBox(height: 12),
                  ],
          _ProfileCard(
            photoUrl: photo,
            fallback: _avatarFallback(),
            name: _isEditing ? _editingName : (_user?.name ?? 'Staff'),
            email: _user?.email ?? '',
            registrationNumber: _user?.registrationNumber ?? 'N/A',
            roleLabel: _roleLabel,
            status: _user?.status ?? 'Active',
            uploading: _saving,
            editing: _isEditing,
            onEditPhoto: _pickProfilePhoto,
          ),
                  const SizedBox(height: 18),
                  _profileSection(
                    title: 'Personal Information',
                    icon: Icons.badge_outlined,
                    children: [
                      _profileField(
                        label: 'Full name',
                        value: _editingName,
                        editable: _isEditing,
                        onChanged: (value) => setState(() => _editingName = value),
                      ),
                      const SizedBox(height: 12),
                      _profileField(
                        label: 'Email address',
                        value: _user?.email ?? '',
                      ),
                      const SizedBox(height: 12),
                      _profileField(
                        label: 'Contact number',
                        value: _editingPhone,
                        editable: _isEditing,
                        keyboardType: TextInputType.phone,
                        onChanged: (value) => setState(() => _editingPhone = value),
                      ),
                      const SizedBox(height: 12),
                      _profileField(
                        label: 'Registration number',
                        value: _user?.registrationNumber ?? 'N/A',
                      ),
                    ],
                  ),
                  if (_user?.role.toUpperCase() == 'DOCTOR') ...[
                    const SizedBox(height: 16),
                    _profileSection(
                      title: 'Professional Information',
                      icon: Icons.medical_services_outlined,
                      children: [
                        _profileField(
                          label: 'Specialization',
                          value: _specialization,
                          editable: _isEditing,
                          onChanged: (value) => setState(() => _specialization = value),
                        ),
                        const SizedBox(height: 12),
                        _profileField(label: 'Role', value: _roleLabel),
                      ],
                    ),
                  ],
                  const SizedBox(height: 16),
                  _profileSection(
                    title: 'Account Status',
                    icon: Icons.verified_user_outlined,
                    children: [
                      _profileField(label: 'Status', value: _user?.status ?? 'Active'),
                    ],
                  ),
                  const SizedBox(height: 18),
                  StaffSectionHeader(title: 'Session'),
                  OutlinedButton.icon(
                    onPressed: _logout,
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('Log out'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: const BorderSide(
                          color: StaffSurfaces.dangerBorder),
                      backgroundColor: AppColors.errorBg,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      textStyle: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _deleteAccount,
                    icon: const Icon(Icons.delete_forever_outlined, size: 18),
                    label: const Text('Delete Account'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.error,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      textStyle: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  final String? photoUrl;
  final Widget fallback;
  final String name;
  final String email;
  final String registrationNumber;
  final String roleLabel;
  final String status;
  final bool uploading;
  final bool editing;
  final VoidCallback onEditPhoto;

  const _ProfileCard({
    required this.photoUrl,
    required this.fallback,
    required this.name,
    required this.email,
    required this.registrationNumber,
    required this.roleLabel,
    required this.status,
    required this.uploading,
    required this.editing,
    required this.onEditPhoto,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 96,
            height: 96,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned(
                  left: 0,
                  top: 0,
                  child: Container(
                    width: 88,
                    height: 88,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: StaffSurfaces.cardBorder, width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: StaffSurfaces.cta.withValues(alpha: 0.06),
                          blurRadius: 10,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: ClipOval(
                      child: NetworkAvatar(
                        url: photoUrl,
                        size: 88,
                        fallback: fallback,
                      ),
                    ),
                  ),
                ),
                if (editing)
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: Material(
                    color: StaffSurfaces.cta,
                    shape: const CircleBorder(),
                    child: IconButton(
                      onPressed: uploading ? null : onEditPhoto,
                      tooltip: 'Change profile photo',
                      constraints: const BoxConstraints.tightFor(width: 30, height: 30),
                      padding: EdgeInsets.zero,
                      icon: uploading
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.camera_alt_outlined, size: 15),
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(
            name,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: StaffSurfaces.textPrimary,
              height: 1.2,
            ),
          ),
          if (email.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              email,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12.5,
                color: StaffSurfaces.textSecondary,
              ),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'National Registration: $registrationNumber',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: StaffSurfaces.brandSoft),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            alignment: WrapAlignment.center,
            children: [
              StaffStatusChip(
                label: roleLabel,
                tone: StaffChipTone.brand,
                icon: Icons.medical_services,
              ),
              StaffStatusChip(
                label: status,
                tone: status.toLowerCase() == 'active'
                    ? StaffChipTone.success
                    : StaffChipTone.neutral,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

