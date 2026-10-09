import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';
import 'file_upload_picker_box.dart';

class ProvinceDistricts {
  final String province;
  final List<String> districts;

  const ProvinceDistricts({required this.province, required this.districts});
}

class HospitalSignupForm extends StatefulWidget {
  final VoidCallback onSuccess;

  const HospitalSignupForm({super.key, required this.onSuccess});

  @override
  State<HospitalSignupForm> createState() => _HospitalSignupFormState();
}

class _HospitalSignupFormState extends State<HospitalSignupForm> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _regNoController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  static const List<ProvinceDistricts> slProvinces = [
    ProvinceDistricts(province: 'Western Province', districts: ['Colombo', 'Gampaha', 'Kalutara']),
    ProvinceDistricts(province: 'Central Province', districts: ['Kandy', 'Matale', 'Nuwara Eliya']),
    ProvinceDistricts(province: 'Southern Province', districts: ['Galle', 'Matara', 'Hambantota']),
    ProvinceDistricts(province: 'Northern Province', districts: ['Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu']),
    ProvinceDistricts(province: 'Eastern Province', districts: ['Batticaloa', 'Ampara', 'Trincomalee']),
    ProvinceDistricts(province: 'North Western Province', districts: ['Kurunegala', 'Puttalam']),
    ProvinceDistricts(province: 'North Central Province', districts: ['Anuradhapura', 'Polonnaruwa']),
    ProvinceDistricts(province: 'Uva Province', districts: ['Badulla', 'Monaragala']),
    ProvinceDistricts(province: 'Sabaragamuwa Province', districts: ['Ratnapura', 'Kegalle']),
  ];

  String _hospitalType = 'Government';
  String _operatingHoursType = '24hrs';
  String? _selectedProvince = 'Western Province';
  String? _selectedDistrict = 'Colombo';

  SelectedFile? _logo;
  SelectedFile? _regProof;
  SelectedFile? _addrProof;

  bool _showPassword = false;
  bool _showConfirmPassword = false;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _nameController.dispose();
    _regNoController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  List<String> get _currentDistricts {
    final match = slProvinces.firstWhere(
      (p) => p.province == _selectedProvince,
      orElse: () => slProvinces.first,
    );
    return match.districts;
  }

  void _handleSubmit() {
    setState(() => _errorMessage = null);

    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    if (_regProof == null || !_regProof!.hasContent) {
      setState(() => _errorMessage = 'Please upload Proof of Hospital Registration');
      return;
    }

    if (_passwordController.text != _confirmPasswordController.text) {
      setState(() => _errorMessage = 'Passwords do not match');
      return;
    }

    if (_passwordController.text.length < 6) {
      setState(() => _errorMessage = 'Password must be at least 6 characters');
      return;
    }

    setState(() => _isLoading = true);

    final operatingHours = _operatingHoursType == '24hrs' ? '24 Hours' : 'Daytime / Standard Clinic Hours';

    AuthRepository.registerHospital(
      email: _emailController.text,
      password: _passwordController.text,
      hospitalName: _nameController.text,
      registrationNumber: _regNoController.text,
      hospitalType: _hospitalType,
      operatingHours: operatingHours,
      address: _addressController.text.trim().isNotEmpty ? _addressController.text : null,
      district: _selectedDistrict,
      province: _selectedProvince,
      contactNumber: _phoneController.text.trim().isNotEmpty ? _phoneController.text : null,
      logo: _logo,
      registrationCertificate: _regProof,
      mohDocument: _addrProof,
    ).then((_) {
      if (mounted) {
        setState(() => _isLoading = false);
        widget.onSuccess();
      }
    }).catchError((e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString();
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_errorMessage != null) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.errorBg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
              ),
              child: Text(
                _errorMessage!,
                style: const TextStyle(
                  color: AppColors.error,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Hospital Logo
          FileUploadPickerBox(
            label: 'Hospital / Facility Logo (Optional)',
            placeholder: 'Upload Hospital Brand Logo',
            allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
            onFileSelected: (file) => setState(() => _logo = file),
          ),
          const SizedBox(height: 12),

          // Hospital Name
          TextFormField(
            controller: _nameController,
            decoration: const InputDecoration(
              hintText: 'Official Hospital / Clinic Name *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter hospital name' : null,
          ),
          const SizedBox(height: 12),

          // Reg No
          TextFormField(
            controller: _regNoController,
            decoration: const InputDecoration(
              hintText: 'Registration / MOH License Number *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter license number' : null,
          ),
          const SizedBox(height: 12),

          // Hospital Type (Dropdown)
          DropdownButtonFormField<String>(
            initialValue: _hospitalType,
            decoration: const InputDecoration(
              hintText: 'Hospital Type *',
            ),
            dropdownColor: Colors.white,
            items: const [
              DropdownMenuItem(value: 'Government', child: Text('Government Hospital / Center')),
              DropdownMenuItem(value: 'Private', child: Text('Private Hospital / Clinic')),
            ],
            onChanged: (v) => setState(() => _hospitalType = v ?? 'Government'),
          ),
          const SizedBox(height: 12),

          // Operating Hours Type
          DropdownButtonFormField<String>(
            initialValue: _operatingHoursType,
            decoration: const InputDecoration(
              hintText: 'Operating Hours *',
            ),
            dropdownColor: Colors.white,
            items: const [
              DropdownMenuItem(value: '24hrs', child: Text('Open 24 Hours / Emergency Care')),
              DropdownMenuItem(value: 'Daytime', child: Text('Daytime / Standard Clinic Hours')),
            ],
            onChanged: (v) => setState(() => _operatingHoursType = v ?? '24hrs'),
          ),
          const SizedBox(height: 12),

          // Province (Dropdown)
          DropdownButtonFormField<String>(
            initialValue: _selectedProvince,
            decoration: const InputDecoration(
              hintText: 'Province *',
            ),
            dropdownColor: Colors.white,
            items: slProvinces.map((p) {
              return DropdownMenuItem(value: p.province, child: Text(p.province));
            }).toList(),
            onChanged: (v) {
              setState(() {
                _selectedProvince = v;
                _selectedDistrict = _currentDistricts.first;
              });
            },
          ),
          const SizedBox(height: 12),

          // District (Dropdown)
          DropdownButtonFormField<String>(
            key: ValueKey(_selectedProvince),
            initialValue: _selectedDistrict,
            decoration: const InputDecoration(
              hintText: 'District *',
            ),
            dropdownColor: Colors.white,
            items: _currentDistricts.map((d) {
              return DropdownMenuItem(value: d, child: Text(d));
            }).toList(),
            onChanged: (v) => setState(() => _selectedDistrict = v),
          ),
          const SizedBox(height: 12),

          // Physical Address
          TextFormField(
            controller: _addressController,
            maxLines: 2,
            decoration: const InputDecoration(
              hintText: 'Physical Street Address / Location *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter hospital address' : null,
          ),
          const SizedBox(height: 12),

          // Contact Number
          TextFormField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              hintText: 'Main Hospital Contact / Landline *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter contact number' : null,
          ),
          const SizedBox(height: 12),

          // Work Email
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              hintText: 'Official Hospital Administration Email *',
            ),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Please enter administrative email';
              if (!v.contains('@')) return 'Enter a valid email address';
              return null;
            },
          ),
          const SizedBox(height: 12),

          // Password
          TextFormField(
            controller: _passwordController,
            obscureText: !_showPassword,
            decoration: InputDecoration(
              hintText: 'Password (Min 6 characters) *',
              suffixIcon: IconButton(
                icon: Icon(
                  _showPassword ? Icons.visibility_off : Icons.visibility,
                  size: 20,
                  color: AppColors.textMuted,
                ),
                onPressed: () => setState(() => _showPassword = !_showPassword),
              ),
            ),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Please enter password';
              if (v.length < 6) return 'Password must be at least 6 characters';
              return null;
            },
          ),
          const SizedBox(height: 12),

          // Confirm Password
          TextFormField(
            controller: _confirmPasswordController,
            obscureText: !_showConfirmPassword,
            decoration: InputDecoration(
              hintText: 'Confirm Password *',
              suffixIcon: IconButton(
                icon: Icon(
                  _showConfirmPassword ? Icons.visibility_off : Icons.visibility,
                  size: 20,
                  color: AppColors.textMuted,
                ),
                onPressed: () => setState(() => _showConfirmPassword = !_showConfirmPassword),
              ),
            ),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Please confirm password';
              return null;
            },
          ),
          const SizedBox(height: 12),

          // Proof of Registration
          FileUploadPickerBox(
            label: 'Proof of Hospital Registration / License',
            placeholder: 'Upload Operating License (PDF/JPG)',
            isRequired: true,
            allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
            onFileSelected: (file) => setState(() => _regProof = file),
          ),
          const SizedBox(height: 12),

          // Proof of Address
          FileUploadPickerBox(
            label: 'Proof of Address / Facility Document (Optional)',
            placeholder: 'Upload Utility Bill / Government Notice (PDF/JPG)',
            allowedExtensions: const ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'],
            onFileSelected: (file) => setState(() => _addrProof = file),
          ),
          const SizedBox(height: 18),

          // Submit Button
          Container(
            decoration: BoxDecoration(
              gradient: AppColors.authButtonGradient,
              borderRadius: BorderRadius.circular(10),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.35),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: ElevatedButton(
              onPressed: _isLoading ? null : _handleSubmit,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: _isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : const Text(
                      'Register Hospital',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
