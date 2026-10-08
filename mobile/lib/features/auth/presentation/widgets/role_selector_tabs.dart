import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class RoleItem {
  final String id;
  final String label;

  const RoleItem({required this.id, required this.label});
}

class RoleSelectorTabs extends StatelessWidget {
  final String selectedRole;
  final Function(String roleId) onRoleSelected;

  const RoleSelectorTabs({
    super.key,
    required this.selectedRole,
    required this.onRoleSelected,
  });

  static const List<RoleItem> roles = [
    RoleItem(id: 'patient', label: 'Patient'),
    RoleItem(id: 'doctor', label: 'Doctor'),
    RoleItem(id: 'nurse', label: 'Nurse'),
    RoleItem(id: 'hospital', label: 'Hospital'),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Text(
          'SELECT ACCOUNT TYPE',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
            color: AppColors.textMuted,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: AppColors.surfaceSubtle,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Row(
            children: roles.map((role) {
              final isSelected = selectedRole == role.id;
              return Expanded(
                child: InkWell(
                  onTap: () => onRoleSelected(role.id),
                  borderRadius: BorderRadius.circular(8),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    decoration: BoxDecoration(
                      color: isSelected ? AppColors.primary : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: isSelected
                          ? [
                              BoxShadow(
                                color: AppColors.primary.withValues(alpha: 0.18),
                                blurRadius: 6,
                                offset: const Offset(0, 2),
                              ),
                            ]
                          : null,
                    ),
                    child: Text(
                      role.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? Colors.white : AppColors.textBody,
                      ),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}
