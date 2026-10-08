import 'package:flutter/material.dart';
import '../../../../core/constants/app_assets.dart';
import '../../../../core/theme/app_colors.dart';
import '../widgets/auth_banner_header.dart';
import '../widgets/role_selector_tabs.dart';
import '../widgets/patient_signup_form.dart';
import '../widgets/doctor_signup_form.dart';
import '../widgets/nurse_signup_form.dart';
import '../widgets/hospital_signup_form.dart';
import '../../../patient/presentation/screens/patient_main_screen.dart';
import 'login_screen.dart';

class SignupScreen extends StatefulWidget {
  final String? initialRole;

  const SignupScreen({super.key, this.initialRole});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  late String _selectedRole;
  Map<String, String>? _pendingVerificationInfo;

  @override
  void initState() {
    super.initState();
    _selectedRole = widget.initialRole ?? 'patient';
  }

  void _handleSignupSuccess(String role) {
    if (role == 'patient') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: AppColors.success,
          content: Text('Patient registration successful! Welcome to Vaxora.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (context) => const PatientMainScreen()),
        (route) => false,
      );
    } else {
      // Doctor, Nurse, Hospital undergo administrative licensing verification
      setState(() {
        _pendingVerificationInfo = {
          'role': role.toUpperCase(),
          'message':
              'Your $role registration documents have been securely submitted for administrative verification.',
        };
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        child: Column(
          children: [
            // Top Curved Blue Header
            AuthBannerHeader(
              title: 'Welcome To Vaxora',
              subtext:
                  'Join the national vaccination network for secure appointments, verified professional licensing, and live updates.',
              onBackToHome: () => Navigator.of(context).pop(),
            ),

            // Form Card
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 440),
                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 28),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.borderAuthCard, width: 2.5),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDark.withValues(alpha: 0.06),
                      blurRadius: 20,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Logo
                    Center(
                      child: Image.asset(
                        AppAssets.logo,
                        height: 70,
                        fit: BoxFit.contain,
                      ),
                    ),
                    const SizedBox(height: 14),

                    if (_pendingVerificationInfo == null) ...[
                      const Text(
                        'Create an account',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textTitle,
                        ),
                      ),
                      const SizedBox(height: 18),

                      // Segmented Role Selector
                      RoleSelectorTabs(
                        selectedRole: _selectedRole,
                        onRoleSelected: (roleId) {
                          setState(() {
                            _selectedRole = roleId;
                          });
                        },
                      ),
                      const SizedBox(height: 20),

                      // Role-Specific Signup Form
                      if (_selectedRole == 'patient')
                        PatientSignupForm(
                          onSuccess: () => _handleSignupSuccess('patient'),
                        )
                      else if (_selectedRole == 'doctor')
                        DoctorSignupForm(
                          onSuccess: () => _handleSignupSuccess('doctor'),
                        )
                      else if (_selectedRole == 'nurse')
                        NurseSignupForm(
                          onSuccess: () => _handleSignupSuccess('nurse'),
                        )
                      else if (_selectedRole == 'hospital')
                        HospitalSignupForm(
                          onSuccess: () => _handleSignupSuccess('hospital'),
                        ),
                    ] else ...[
                      // Application Under Review Alert (Matching Web Experience)
                      Container(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: AppColors.infoBg,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppColors.infoBorder, width: 1.5),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.verified_user_outlined, color: AppColors.brandBlue, size: 24),
                                SizedBox(width: 8),
                                Text(
                                  'Application Under Review',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.info,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Text(
                              _pendingVerificationInfo!['message']!,
                              style: const TextStyle(
                                fontSize: 13,
                                color: AppColors.textBody,
                                height: 1.5,
                              ),
                            ),
                            const SizedBox(height: 10),
                            const Text(
                              'Once approved by national administrators, you will be able to log in to access clinical and administrative tools.',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppColors.textMuted,
                                height: 1.45,
                              ),
                            ),
                            const SizedBox(height: 20),
                            Container(
                              decoration: BoxDecoration(
                                gradient: AppColors.authButtonGradient,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: ElevatedButton(
                                onPressed: () {
                                  Navigator.of(context).pushReplacement(
                                    MaterialPageRoute(builder: (context) => const LoginScreen()),
                                  );
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.transparent,
                                  shadowColor: Colors.transparent,
                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                  minimumSize: const Size(double.infinity, 44),
                                ),
                                child: const Text(
                                  'Return to Log In',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),

                    // Already have an account link
                    Center(
                      child: TextButton(
                        onPressed: () {
                          Navigator.of(context).pushReplacement(
                            MaterialPageRoute(builder: (context) => const LoginScreen()),
                          );
                        },
                        child: const Text(
                          'Already have an account? Log in',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.primaryDark,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
