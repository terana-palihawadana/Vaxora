import 'package:flutter/material.dart';
import '../../../../core/constants/app_assets.dart';
import '../../../../core/theme/app_colors.dart';

class LandingAppBar extends StatelessWidget implements PreferredSizeWidget {
  final VoidCallback onLoginPressed;
  final VoidCallback onSignupPressed;
  final VoidCallback onMenuPressed;

  const LandingAppBar({
    super.key,
    required this.onLoginPressed,
    required this.onSignupPressed,
    required this.onMenuPressed,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(
            color: AppColors.borderLight,
            width: 1,
          ),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Logo
              Image.asset(
                AppAssets.logo,
                height: 44,
                fit: BoxFit.contain,
              ),

              // Action buttons & Hamburger
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Log in button
                  OutlinedButton(
                    onPressed: onLoginPressed,
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      minimumSize: const Size(0, 36),
                      side: const BorderSide(color: AppColors.borderPill, width: 1.5),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      'Log in',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Sign up button
                  ElevatedButton(
                    onPressed: onSignupPressed,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      minimumSize: const Size(0, 36),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 1,
                    ),
                    child: const Text(
                      'Sign up',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Hamburger Menu Button
                  InkWell(
                    onTap: onMenuPressed,
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: AppColors.borderCard, width: 1.5),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(
                        Icons.menu,
                        size: 20,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Size get preferredSize => const Size.fromHeight(64);
}
