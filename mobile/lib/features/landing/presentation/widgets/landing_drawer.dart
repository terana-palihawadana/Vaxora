import 'package:flutter/material.dart';
import '../../../../core/constants/app_assets.dart';
import '../../../../core/theme/app_colors.dart';

class LandingDrawer extends StatelessWidget {
  final String activeSection;
  final Function(String section) onSectionSelected;
  final VoidCallback onLoginPressed;
  final VoidCallback onSignupPressed;

  const LandingDrawer({
    super.key,
    required this.activeSection,
    required this.onSectionSelected,
    required this.onLoginPressed,
    required this.onSignupPressed,
  });

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          bottomLeft: Radius.circular(20),
        ),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header with logo and close
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Image.asset(
                    AppAssets.logo,
                    height: 40,
                    fit: BoxFit.contain,
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppColors.primaryDark),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              const Divider(color: AppColors.borderLight, height: 1),
              const SizedBox(height: 20),

              // Navigation Links
              _buildNavLink(
                title: 'Home',
                section: 'home',
                context: context,
              ),
              const SizedBox(height: 8),
              _buildNavLink(
                title: 'About',
                section: 'about',
                context: context,
              ),
              const SizedBox(height: 8),
              _buildNavLink(
                title: 'Contact us',
                section: 'contact',
                context: context,
              ),
              const SizedBox(height: 8),
              _buildNavLink(
                title: 'Reviews',
                section: 'reviews',
                context: context,
              ),

              const Spacer(),

              const Divider(color: AppColors.borderLight, height: 1),
              const SizedBox(height: 16),

              // Bottom Actions
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        onLoginPressed();
                      },
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        side: const BorderSide(color: AppColors.borderPill, width: 1.5),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                      child: const Text(
                        'Log in',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        onSignupPressed();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                      child: const Text(
                        'Sign up',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
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

  Widget _buildNavLink({
    required String title,
    required String section,
    required BuildContext context,
  }) {
    final isActive = activeSection == section;
    return InkWell(
      onTap: () {
        Navigator.of(context).pop();
        onSectionSelected(section);
      },
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: isActive ? AppColors.brandBlue : AppColors.background,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive ? AppColors.brandBlue : AppColors.borderLight,
            width: 1,
          ),
        ),
        child: Text(
          title,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: isActive ? Colors.white : AppColors.primaryDark,
          ),
        ),
      ),
    );
  }
}
