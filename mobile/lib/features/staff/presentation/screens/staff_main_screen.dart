import 'package:flutter/material.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/repositories/staff_repository.dart';
import 'staff_affiliations_screen.dart';
import 'staff_appointments_screen.dart';
import 'staff_home_screen.dart';
import 'staff_patients_screen.dart';
import 'staff_profile_screen.dart';
import 'staff_shifts_screen.dart';

class StaffMainScreen extends StatefulWidget {
  const StaffMainScreen({super.key});

  @override
  State<StaffMainScreen> createState() => _StaffMainScreenState();
}

class _StaffMainScreenState extends State<StaffMainScreen> {
  int _index = 0;
  int _pendingInvites = 0;

  @override
  void initState() {
    super.initState();
    _refreshPendingCount();
  }

  Future<void> _refreshPendingCount() async {
    try {
      final invites = await StaffRepository.getMyInvitations();
      if (!mounted) return;
      setState(() => _pendingInvites = invites.length);
    } catch (_) {}
  }

  void _onTabSelected(int i) {
    setState(() => _index = i);
    if (i == 4) _refreshPendingCount();
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      StaffHomeScreen(onNavigateTab: _onTabSelected),
      const StaffShiftsScreen(),
      const StaffAppointmentsScreen(),
      const StaffPatientsScreen(),
      StaffAffiliationsScreen(onChanged: _refreshPendingCount),
      const StaffProfileScreen(),
    ];

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      body: IndexedStack(index: _index, children: screens),
      bottomNavigationBar: StaffBottomNav(
        index: _index,
        onSelect: _onTabSelected,
        destinations: [
          const StaffNavDestination(
            icon: Icons.home_outlined,
            activeIcon: Icons.home,
            label: 'Home',
          ),
          const StaffNavDestination(
            icon: Icons.calendar_month_outlined,
            activeIcon: Icons.calendar_month,
            label: 'Shifts',
          ),
          const StaffNavDestination(
            icon: Icons.event_note_outlined,
            activeIcon: Icons.event_note,
            label: 'Clinic',
          ),
          const StaffNavDestination(
            icon: Icons.folder_shared_outlined,
            activeIcon: Icons.folder_shared,
            label: 'Patients',
          ),
          StaffNavDestination(
            icon: Icons.local_hospital_outlined,
            activeIcon: Icons.local_hospital,
            label: 'Hospitals',
            badgeCount: _pendingInvites,
          ),
          const StaffNavDestination(
            icon: Icons.person_outline,
            activeIcon: Icons.person,
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
