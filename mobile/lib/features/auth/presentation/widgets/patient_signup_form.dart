import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';
import 'file_upload_picker_box.dart';

class PatientSignupForm extends StatefulWidget {
  final VoidCallback onSuccess;

  const PatientSignupForm({super.key, required this.onSuccess});

  @override
  State<PatientSignupForm> createState() => _PatientSignupFormState();
}

class _PatientSignupFormState extends State<PatientSignupForm> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _nicController = TextEditingController();
  final _dobController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  SelectedFile? _profilePhoto;
  bool _showPassword = false;
  bool _showConfirmPassword = false;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _fullNameController.dispose();
    _nicController.dispose();
    _dobController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _selectDateOfBirth() async {
    final DateTime now = DateTime.now();
    final DateTime initialDate = DateTime(2000, 1, 1);
    final DateTime firstDate = DateTime(1920);

    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: now,
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.brandBlue,
              onPrimary: Colors.white,
              onSurface: AppColors.textTitle,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        _dobController.text =
            "${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}";
      });
    }
  }

  void _handleSubmit() {
    setState(() => _errorMessage = null);

    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    if (_dobController.text.trim().isEmpty) {
      setState(() => _errorMessage = 'Please select your Date of Birth');
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

    AuthRepository.registerPatient(
      email: _emailController.text,
      password: _passwordController.text,
      fullName: _fullNameController.text,
      nicNumber: _nicController.text,
      dateOfBirth: _dobController.text,
      phoneNumber: _phoneController.text.trim().isNotEmpty ? _phoneController.text : null,
      profilePhoto: _profilePhoto,
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

          // Profile Photo
          FileUploadPickerBox(
            label: 'Profile Photo (Optional)',
            placeholder: 'Upload Profile Photo (JPG/PNG)',
            allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
            onFileSelected: (file) => setState(() => _profilePhoto = file),
          ),
          const SizedBox(height: 12),

          // Full Name
          TextFormField(
            controller: _fullNameController,
            decoration: const InputDecoration(
              hintText: 'Full Name *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter full name' : null,
          ),
          const SizedBox(height: 12),

          // NIC
          TextFormField(
            controller: _nicController,
            decoration: const InputDecoration(
              hintText: 'National Identity Card (NIC) / ID *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter NIC/ID' : null,
          ),
          const SizedBox(height: 12),

          // Date of Birth
          InkWell(
            onTap: _selectDateOfBirth,
            child: IgnorePointer(
              child: TextFormField(
                controller: _dobController,
                decoration: const InputDecoration(
                  hintText: 'Date of Birth (YYYY-MM-DD) *',
                  suffixIcon: Icon(Icons.calendar_today_outlined, size: 20, color: AppColors.brandBlue),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Contact Number
          TextFormField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              hintText: 'Contact Number (Optional)',
            ),
          ),
          const SizedBox(height: 12),

          // Email
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              hintText: 'Email Address *',
            ),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Please enter email';
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
                      'Register as Patient',
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
