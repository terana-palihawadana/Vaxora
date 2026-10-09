import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../hospital_staff/presentation/screens/hospital_booths_screen.dart';
import '../../../hospital_staff/presentation/screens/hospital_staff_screen.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../providers/inventory_provider.dart';
import 'hospital_desk_screen.dart';
import 'hospital_home_screen.dart';
import 'hospital_profile_screen.dart';
import 'inventory_home_screen.dart';

class HospitalMainScreen extends StatefulWidget {
  const HospitalMainScreen({super.key});

  @override
  State<HospitalMainScreen> createState() => _HospitalMainScreenState();
}

class _HospitalMainScreenState extends State<HospitalMainScreen> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => InventoryProvider()..loadAll(),
      child: Scaffold(
        backgroundColor: StaffSurfaces.pageBg,
        body: IndexedStack(
          index: _index,
          children: [
            HospitalHomeScreen(
              onNavigateTab: (i) => setState(() => _index = i),
            ),
            const HospitalDeskScreen(),
            const HospitalStaffScreen(),
            const HospitalBoothsScreen(),
            const InventoryHomeScreen(),
            const HospitalProfileScreen(),
          ],
        ),
        bottomNavigationBar: StaffBottomNav(
          index: _index,
          onSelect: (i) => setState(() => _index = i),
          destinations: const [
            StaffNavDestination(
              icon: Icons.dashboard_outlined,
              activeIcon: Icons.dashboard,
              label: 'Home',
            ),
            StaffNavDestination(
              icon: Icons.event_note_outlined,
              activeIcon: Icons.event_note,
              label: 'Desk',
            ),
            StaffNavDestination(
              icon: Icons.groups_outlined,
              activeIcon: Icons.groups,
              label: 'Staff',
            ),
            StaffNavDestination(
              icon: Icons.meeting_room_outlined,
              activeIcon: Icons.meeting_room,
              label: 'Booths',
            ),
            StaffNavDestination(
              icon: Icons.inventory_2_outlined,
              activeIcon: Icons.inventory_2,
              label: 'Stock',
            ),
            StaffNavDestination(
              icon: Icons.person_outline,
              activeIcon: Icons.person,
              label: 'Profile',
            ),
          ],
        ),
      ),
    );
  }
}
