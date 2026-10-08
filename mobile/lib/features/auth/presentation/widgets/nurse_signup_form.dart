import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';
import 'file_upload_picker_box.dart';

class NurseSignupForm extends StatefulWidget {
  final VoidCallback onSuccess;

  const NurseSignupForm({super.key, required this.onSuccess});

  @override
  State<NurseSignupForm> createState() => _NurseSignupFormState();
}

class _NurseSignupFormState extends State<NurseSignupForm> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _slncController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  SelectedFile? _profilePhoto;
  SelectedFile? _slncDoc;
  SelectedFile? _supportingDoc;

  bool _showPassword = false;
  bool _showConfirmPassword = false;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _fullNameController.dispose();
    _slncController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _handleSubmit() {
    setState(() => _errorMessage = null);

    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    if (_slncDoc == null || !_slncDoc!.hasContent) {
      setState(() => _errorMessage = 'Please upload your SLNC Registration Certificate');
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

    AuthRepository.registerNurse(
      email: _emailController.text,
      password: _passwordController.text,
      fullName: _fullNameController.text,
      slncNumber: _slncController.text,
      phoneNumber: _phoneController.text.trim().isNotEmpty
          ? _phoneController.text
          : null,
      profilePhoto: _profilePhoto,
      slncCertificate: _slncDoc,
      supportingDocument: _supportingDoc,
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
            placeholder: 'Upload Nurse Profile Picture',
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

          // SLNC Number
          TextFormField(
            controller: _slncController,
            decoration: const InputDecoration(
              hintText: 'Nursing Council (SLNC) Reg Number *',
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter SLNC registration number' : null,
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
              hintText: 'Official / Work Email Address *',
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
          const SizedBox(height: 12),

          // SLNC Doc
          FileUploadPickerBox(
            label: 'SLNC Registration Certificate/Card',
            placeholder: 'Upload SLNC Certificate (PDF/JPG)',
            isRequired: true,
            allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
            onFileSelected: (file) => setState(() => _slncDoc = file),
          ),
          const SizedBox(height: 12),

          // Supporting Doc
          FileUploadPickerBox(
            label: 'Additional Supporting Document (Optional)',
            placeholder: 'Hospital ID / Employment Proof (PDF/JPG)',
            allowedExtensions: const ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'],
            onFileSelected: (file) => setState(() => _supportingDoc = file),
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
                      'Register as Nurse',
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
