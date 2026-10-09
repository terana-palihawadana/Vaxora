import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';

class HospitalProfileScreen extends StatefulWidget {
  const HospitalProfileScreen({super.key});

  @override
  State<HospitalProfileScreen> createState() => _HospitalProfileScreenState();
}

class _HospitalProfileScreenState extends State<HospitalProfileScreen> {
  Map<String, dynamic>? _user;
  Map<String, dynamic> _editing = {};
  bool _loading = true;
  bool _editingProfile = false;
  bool _saving = false;
  String? _photoUrl;
  final ImagePicker _imagePicker = ImagePicker();

  Map<String, dynamic> get _details {
    final details = _user?['profileDetails'] ?? _user?['ProfileDetails'];
    return details is Map ? Map<String, dynamic>.from(details) : {};
  }

  String _detail(String key, [String fallback = '']) {
    final details = _details;
    return (details[key] ?? details[_pascal(key)] ?? fallback).toString();
  }

  String _pascal(String value) =>
      value.isEmpty ? value : '${value[0].toUpperCase()}${value.substring(1)}';

  String? _resolvePhoto(String? raw) => resolveMediaUrl(raw);

  String? get _photo => _photoUrl ??
      _resolvePhoto(
        _user?['profilePhotoUrl']?.toString() ??
            _user?['logoUrl']?.toString() ??
            _user?['photoUrl']?.toString() ??
            _detail('logoUrl'),
      );

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final user = await AuthRepository.getCurrentUser(forceRefresh: true);
      final cached = await StorageService.getUser();
      if (!mounted) return;
      final map = cached ?? user?.toJson();
      setState(() {
        _user = map;
        _photoUrl = _resolvePhoto(user?.profilePhotoUrl);
        _editing = {
          'hospitalName': _detailFrom(map, 'hospitalName', user?.name ?? ''),
          'phoneNumber': user?.phoneNumber ?? '',
          'hospitalType': _detailFrom(map, 'hospitalType'),
          'operatingHours': _detailFrom(map, 'operatingHours'),
          'address': _detailFrom(map, 'address'),
          'district': _detailFrom(map, 'district'),
          'province': _detailFrom(map, 'province'),
        };
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      final cached = await StorageService.getUser();
      setState(() {
        _user = cached;
        _photoUrl = _resolvePhoto(
          cached?['profilePhotoUrl']?.toString() ??
              cached?['logoUrl']?.toString(),
        );
        _editing = {
          'hospitalName': _detailFrom(cached, 'hospitalName'),
          'phoneNumber': cached?['phoneNumber']?.toString() ?? '',
          'hospitalType': _detailFrom(cached, 'hospitalType'),
          'operatingHours': _detailFrom(cached, 'operatingHours'),
          'address': _detailFrom(cached, 'address'),
          'district': _detailFrom(cached, 'district'),
          'province': _detailFrom(cached, 'province'),
        };
        _loading = false;
      });
      _showMessage(e is ApiException ? e.message : 'Could not refresh profile.', error: true);
    }
  }

  String _detailFrom(Map<String, dynamic>? user, String key, [String fallback = '']) {
    final details = user?['profileDetails'] ?? user?['ProfileDetails'];
    if (details is! Map) return fallback;
    return (details[key] ?? details[_pascal(key)] ?? fallback).toString();
  }

  void _beginEdit() {
    setState(() {
      _editing = {
        'hospitalName': _detail('hospitalName', _user?['name']?.toString() ?? ''),
        'phoneNumber': _user?['phoneNumber']?.toString() ?? '',
        'hospitalType': _detail('hospitalType'),
        'operatingHours': _detail('operatingHours'),
        'address': _detail('address'),
        'district': _detail('district'),
        'province': _detail('province'),
        ..._editing,
      };
      _editingProfile = true;
    });
  }

  Future<void> _saveProfile() async {
    setState(() => _saving = true);
    try {
      await AuthRepository.updateProfile(
        hospitalName: _editing['hospitalName']?.toString(),
        phoneNumber: _editing['phoneNumber']?.toString(),
        hospitalType: _editing['hospitalType']?.toString(),
        operatingHours: _editing['operatingHours']?.toString(),
        address: _editing['address']?.toString(),
        district: _editing['district']?.toString(),
        province: _editing['province']?.toString(),
      );
      final fresh = await StorageService.getUser();
      if (!mounted) return;
      setState(() {
        _user = fresh ?? _user;
        _editingProfile = false;
        _saving = false;
      });
      _showMessage('Profile updated.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _showMessage(e is ApiException ? e.message : 'Failed to update profile.', error: true);
    }
  }

  Future<void> _pickProfilePhoto() async {
    if (_saving) return;
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
                const Text('Update profile photo', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: StaffSurfaces.textPrimary)),
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
      final file = await _imagePicker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1200,
      );
      if (file == null || !mounted) return;

      setState(() => _saving = true);
      final updated = await AuthRepository.updateProfilePhoto(file);
      final cached = await StorageService.getUser();
      if (!mounted) return;
      setState(() {
        _user = cached ?? _user;
        _photoUrl = _resolvePhoto(updated.profilePhotoUrl) ?? _photoUrl;
        _saving = false;
      });
      _showMessage('Profile photo updated.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _showMessage(e is ApiException ? e.message : 'Failed to update profile photo.', error: true);
    }
  }

  void _showMessage(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? AppColors.error : null,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _logout() async {
    final ok = await confirmAction(
      context,
      title: 'Log out?',
      message: 'You will need to sign in again to manage this hospital.',
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
          'Delete Hospital Account?',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: AppColors.error,
          ),
        ),
        content: const Text(
          'This will permanently delete your hospital facility account, staff rosters, vaults, and inventory registrations. This action cannot be undone.',
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
                    content: Text('Deleting hospital account...'),
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
                    content: Text('Your Vaxora hospital account has been permanently deleted.'),
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

  Widget _section({required String title, required IconData icon, required List<Widget> children}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [Icon(icon, size: 18, color: StaffSurfaces.brandSoft), const SizedBox(width: 8), Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: StaffSurfaces.textPrimary))]),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }

  Widget _field(String label, String value, {String? keyName, bool editable = false, TextInputType keyboardType = TextInputType.text}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.5, color: StaffSurfaces.textSecondary)),
        const SizedBox(height: 5),
        TextFormField(
          key: ValueKey('$label-$_editingProfile'),
          initialValue: value,
          enabled: editable && _editingProfile,
          keyboardType: keyboardType,
          onChanged: keyName == null ? null : (next) => setState(() => _editing[keyName] = next),
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: StaffSurfaces.textPrimary),
          decoration: InputDecoration(
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            filled: true,
            fillColor: editable && _editingProfile ? StaffSurfaces.cardBg : StaffSurfaces.softPanel,
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
    final name = _editingProfile
        ? (_editing['hospitalName']?.toString() ?? 'Hospital')
        : (_user?['name']?.toString() ?? _detail('hospitalName', 'Hospital'));
    final registration = _detail('registrationNumber', _user?['registrationNumber']?.toString() ?? 'N/A');
    final status = _user?['status']?.toString() ?? 'Active';
    final role = _user?['role']?.toString() ?? 'HOSPITAL';

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffSurfaces.appBar(
        title: 'Profile',
        actions: [
          StaffHeaderAction(
            icon: _editingProfile ? Icons.check : Icons.edit_outlined,
            tooltip: _editingProfile ? 'Save profile' : 'Edit profile',
            onPressed: _loading || _saving ? null : (_editingProfile ? _saveProfile : _beginEdit),
          ),
          StaffHeaderAction(icon: Icons.refresh, tooltip: 'Refresh', onPressed: _loading || _saving ? null : _load),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: StaffSurfaces.brandSoft))
          : RefreshIndicator(
              onRefresh: _load,
              color: StaffSurfaces.brandSoft,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: StaffSurfaces.card(),
                    child: Column(
                      children: [
                        SizedBox(
                          width: 96,
                          height: 96,
                          child: Stack(
                            children: [
                              Container(
                                width: 88,
                                height: 88,
                                decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: StaffSurfaces.cardBorder)),
                                clipBehavior: Clip.antiAlias,
                                child: NetworkAvatar(
                                  url: _photo,
                                  size: 88,
                                  fallback: Container(color: StaffSurfaces.softPanelDeep, alignment: Alignment.center, child: Icon(Icons.local_hospital, color: StaffSurfaces.brandSoft, size: 42)),
                                ),
                              ),
                              if (_editingProfile)
                                Positioned(
                                  bottom: 0,
                                  right: 0,
                                  child: Material(
                                    color: StaffSurfaces.cta,
                                    shape: const CircleBorder(),
                                    child: IconButton(
                                      onPressed: _saving ? null : _pickProfilePhoto,
                                      tooltip: 'Change profile photo',
                                      constraints: const BoxConstraints.tightFor(width: 30, height: 30),
                                      padding: EdgeInsets.zero,
                                      icon: _saving
                                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                          : const Icon(Icons.camera_alt_outlined, size: 15),
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(name, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: StaffSurfaces.textPrimary)),
                        const SizedBox(height: 4),
                        Text(_user?['email']?.toString() ?? '', style: const TextStyle(fontSize: 12.5, color: StaffSurfaces.textSecondary)),
                        const SizedBox(height: 8),
                        Text('National Registration: $registration', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: StaffSurfaces.brandSoft)),
                        const SizedBox(height: 14),
                        Wrap(spacing: 6, children: [StaffStatusChip(label: role, tone: StaffChipTone.brand, icon: Icons.local_hospital), StaffStatusChip(label: status, tone: status.toLowerCase() == 'active' ? StaffChipTone.success : StaffChipTone.neutral)]),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  _section(
                    title: 'Personal Information',
                    icon: Icons.badge_outlined,
                    children: [
                      _field('Hospital name', _editing['hospitalName']?.toString() ?? name, keyName: 'hospitalName', editable: true),
                      const SizedBox(height: 12),
                      _field('Email address', _user?['email']?.toString() ?? ''),
                      const SizedBox(height: 12),
                      _field('Contact number', _editing['phoneNumber']?.toString() ?? '', keyName: 'phoneNumber', editable: true, keyboardType: TextInputType.phone),
                      const SizedBox(height: 12),
                      _field('Registration number', registration),
                    ],
                  ),
                  const SizedBox(height: 16),
                  _section(
                    title: 'Hospital Information',
                    icon: Icons.apartment_outlined,
                    children: [
                      _field('Hospital type', _editing['hospitalType']?.toString() ?? '', keyName: 'hospitalType', editable: true),
                      const SizedBox(height: 12),
                      _field('Operating hours', _editing['operatingHours']?.toString() ?? '', keyName: 'operatingHours', editable: true),
                      const SizedBox(height: 12),
                      _field('Address', _editing['address']?.toString() ?? '', keyName: 'address', editable: true),
                      const SizedBox(height: 12),
                      _field('District', _editing['district']?.toString() ?? '', keyName: 'district', editable: true),
                      const SizedBox(height: 12),
                      _field('Province', _editing['province']?.toString() ?? '', keyName: 'province', editable: true),
                    ],
                  ),
                  const SizedBox(height: 16),
                  _section(title: 'Account Status', icon: Icons.verified_user_outlined, children: [_field('Status', status)]),
                  const SizedBox(height: 18),
                  const StaffSectionHeader(title: 'Session'),
                  OutlinedButton.icon(
                    onPressed: _logout,
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('Log out'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: const BorderSide(color: StaffSurfaces.dangerBorder),
                      backgroundColor: AppColors.errorBg,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
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
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
