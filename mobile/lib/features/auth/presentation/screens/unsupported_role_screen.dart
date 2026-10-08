import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';
import 'login_screen.dart';

class UnsupportedRoleScreen extends StatefulWidget {
  const UnsupportedRoleScreen({super.key});

  @override
  State<UnsupportedRoleScreen> createState() => _UnsupportedRoleScreenState();
}

class _UnsupportedRoleScreenState extends State<UnsupportedRoleScreen> {
  bool _isSigningOut = false;
  String? _errorMessage;

  Future<void> _signOut() async {
    setState(() {
      _isSigningOut = true;
      _errorMessage = null;
    });

    try {
      await AuthRepository.logout();
      if (!mounted) return;

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _isSigningOut = false;
          _errorMessage = 'Unable to sign out. Please try again. ($error)';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.admin_panel_settings_outlined,
                  size: 56,
                  color: AppColors.primary,
                ),
                const SizedBox(height: 20),
                const Text(
                  'Admin access is available on the Vaxora web portal',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppColors.textTitle,
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'The mobile app does not support administrator workflows. '
                  'This account cannot use hospital tools in the mobile app.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppColors.textBody,
                    fontSize: 15,
                    height: 1.5,
                  ),
                ),
                if (_errorMessage != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _errorMessage!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.error),
                  ),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _isSigningOut ? null : _signOut,
                  child: _isSigningOut
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
