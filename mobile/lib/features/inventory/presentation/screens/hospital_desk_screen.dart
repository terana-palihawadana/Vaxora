import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/data/models/staff_appointment_model.dart';
import '../../../staff/presentation/utils/staff_date_utils.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/formulary_entry_model.dart';
import '../../data/repositories/hospital_desk_repository.dart';
import '../../data/repositories/inventory_repository.dart';
import '../widgets/walk_in_registration_sheet.dart';
import 'hospital_schedules_panel.dart';

/// Hospital desk hub — Queue + Schedules tabs (web Appointments).
class HospitalDeskScreen extends StatefulWidget {
  const HospitalDeskScreen({super.key});

  @override
  State<HospitalDeskScreen> createState() => _HospitalDeskScreenState();
}

class _HospitalDeskScreenState extends State<HospitalDeskScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final GlobalKey<HospitalSchedulesPanelState> _schedulesKey =
      GlobalKey<HospitalSchedulesPanelState>();
  String _hospitalName = 'Hospital';
  String? _logoUrl;
  List<StaffAppointmentModel> _queue = [];
  List<FormularyEntryModel> _formulary = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String _filter = 'all';
  late final String _today;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _tabs.addListener(() {
      if (!_tabs.indexIsChanging) setState(() {});
    });
    _today = todayIsoDate();
    _bootstrap();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    if (mounted && user != null) {
      setState(() {
        _hospitalName = user['name']?.toString().trim().isNotEmpty == true
            ? user['name'].toString().trim()
            : 'Hospital';
        _logoUrl = resolveMediaUrl(
          user['profilePhotoUrl']?.toString() ??
              user['logoUrl']?.toString() ??
              user['photoUrl']?.toString(),
        );
      });
    }
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        HospitalDeskRepository.getQueue(date: _today),
        InventoryRepository.getFormulary(),
      ]);
      if (!mounted) return;
      setState(() {
        _queue = results[0] as List<StaffAppointmentModel>;
        _formulary = results[1] as List<FormularyEntryModel>;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Failed to load desk queue.';
        _queue = [];
      });
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  /// Desk UI bucket aligned with web appointmentStatus.js.
  String _deskStatus(StaffAppointmentModel a) {
    final s = a.status.toLowerCase();
    if (s == 'completed') return 'completed';
    if (s == 'observation') return 'observation';
    if (s == 'administering') return 'consulting';
    if (s == 'cancelled' || s == 'rejected') return 'cancelled';
    if (s == 'pendingpayment') return 'awaiting_payment';
    if (!a.isPaymentSettled && s == 'confirmed') return 'awaiting_payment';
    return 'waiting';
  }

  String _deskLabel(StaffAppointmentModel a) {
    final bucket = _deskStatus(a);
    if (bucket == 'awaiting_payment') return 'Awaiting payment';
    if (bucket == 'waiting' && !a.isCheckedIn) return 'Not arrived';
    if (bucket == 'waiting' && a.isCheckedIn) return 'Checked in';
    if (bucket == 'consulting') return 'In session';
    if (bucket == 'observation') return 'Observation';
    if (bucket == 'completed') return 'Completed';
    if (bucket == 'cancelled') {
      return a.status.toLowerCase() == 'rejected' ? 'Rejected' : 'Cancelled';
    }
    return a.status;
  }

  List<StaffAppointmentModel> get _filtered {
    if (_filter == 'all') return _queue;
    return _queue.where((a) => _deskStatus(a) == _filter).toList();
  }

  Future<void> _runBusy(Future<void> Function() action, String ok) async {
    setState(() => _busy = true);
    try {
      await action();
      _toast(ok);
      await _load();
    } catch (e) {
      _toast(e is ApiException ? e.message : e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _registerWalkIn() async {
    final form = await showWalkInRegistrationSheet(
      context: context,
      formulary: _formulary,
    );
    if (form == null) return;

    setState(() => _busy = true);
    try {
      final created = await HospitalDeskRepository.createWalkIn(
        patientNic: form.patientNic,
        patientName: form.patientName,
        patientEmail: form.patientEmail,
        patientPhone: form.patientPhone,
        vaccineName: form.vaccineName,
        dose: form.dose,
        age: form.age,
        gender: form.gender,
      );
      final unpaid = !created.isPaymentSettled;
      _toast(
        unpaid
            ? '${form.patientName} registered — collect the fee and tap Mark paid. Guest password is their NIC.'
            : '${form.patientName} registered and checked into today’s queue.',
      );
      await _load();
    } catch (e) {
      _toast(e is ApiException ? e.message : e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(
    String message, {
    String title = 'Confirm?',
    String confirmLabel = 'Confirm',
    bool destructive = false,
  }) {
    return confirmAction(
      context,
      title: title,
      message: message,
      confirmLabel: confirmLabel,
      destructive: destructive,
    );
  }

  @override
  Widget build(BuildContext context) {
    final awaiting = _queue.where((a) => _deskStatus(a) == 'awaiting_payment').length;
    final waiting = _queue.where((a) => _deskStatus(a) == 'waiting').length;

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _hospitalName,
        subtitle: 'Hospital · Appointments',
        photoUrl: _logoUrl,
        actions: [
          StaffHeaderAction(
            icon: Icons.refresh,
            tooltip: 'Refresh',
            onPressed: _tabs.index == 0 && !(_loading || _busy) ? _load : null,
          ),
        ],
      ),
      floatingActionButton: _tabs.index == 0
          ? FloatingActionButton.extended(
              onPressed: _busy || _loading ? null : _registerWalkIn,
              backgroundColor: StaffSurfaces.cta,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.person_add_alt_1_rounded),
              label: const Text(
                'Walk-in',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            )
          : FloatingActionButton.extended(
              onPressed: () => _schedulesKey.currentState?.openCreate(),
              backgroundColor: StaffSurfaces.cta,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add),
              label: const Text(
                'Add schedule',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
      body: Column(
        children: [
          Material(
            color: StaffSurfaces.appBarBg,
            child: TabBar(
              controller: _tabs,
              labelColor: StaffSurfaces.cta,
              unselectedLabelColor: StaffSurfaces.textMutedSoft,
              indicatorColor: StaffSurfaces.cta,
              labelStyle: const TextStyle(fontWeight: FontWeight.w800),
              tabs: const [
                Tab(text: 'Desk queue'),
                Tab(text: 'Schedules'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                RefreshIndicator(
                  onRefresh: _load,
                  color: StaffSurfaces.brandSoft,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 100),
                    children: [
                      StaffPageIntro(
                        eyebrow: 'Front desk',
                        title: "Today's queue",
                        subtitle:
                            'Check in arrivals, mark counter payments, register walk-ins.',
                        stats: [
                          StaffIntroStat(
                            label: 'Today',
                            value: '${_queue.length}',
                            icon: Icons.people_outline,
                            accent: StaffSurfaces.brandSoft,
                          ),
                          StaffIntroStat(
                            label: 'Waiting',
                            value: '$waiting',
                            icon: Icons.hourglass_empty,
                            accent: const Color(0xFFB2660A),
                          ),
                          StaffIntroStat(
                            label: 'Unpaid',
                            value: '$awaiting',
                            icon: Icons.payments_outlined,
                            accent: awaiting > 0
                                ? AppColors.error
                                : AppColors.success,
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _chip('All (${_queue.length})', 'all'),
                          _chip('Waiting ($waiting)', 'waiting'),
                          if (awaiting > 0)
                            _chip(
                              'Awaiting payment ($awaiting)',
                              'awaiting_payment',
                            ),
                          _chip(
                            'Done (${_queue.where((a) => _deskStatus(a) == 'completed').length})',
                            'completed',
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      if (_loading)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 48),
                          child: Center(
                            child: CircularProgressIndicator(
                              color: StaffSurfaces.brandSoft,
                            ),
                          ),
                        )
                      else if (_error != null)
                        StaffEmptyCard(
                          message: _error!,
                          icon: Icons.error_outline,
                        )
                      else if (_filtered.isEmpty)
                        const StaffEmptyCard(
                          message:
                              'No patients in this filter for today’s session.',
                          icon: Icons.event_busy_outlined,
                        )
                      else ...[
                        StaffSectionHeader(
                          title: 'Desk queue',
                          count: _filtered.length,
                        ),
                        ..._filtered.map(
                          (a) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _DeskCard(
                              appointment: a,
                              label: _deskLabel(a),
                              bucket: _deskStatus(a),
                              busy: _busy,
                              onCheckIn: () => _runBusy(
                                () => HospitalDeskRepository.checkIn(a.id),
                                'Patient checked in — now in the clinical queue.',
                              ),
                              onMarkPaid: () => _runBusy(
                                () => HospitalDeskRepository.markPaid(a.id),
                                'Counter payment recorded — patient is ready for clinical queue.',
                              ),
                              onNoShow: () async {
                                if (!await _confirm(
                                  'Mark ${a.patientName} as a no-show for this session?',
                                  title: 'Mark as no-show?',
                                  confirmLabel: 'Mark no-show',
                                  destructive: true,
                                )) {
                                  return;
                                }
                                await _runBusy(
                                  () => HospitalDeskRepository.markNoShow(a.id),
                                  'Marked as no-show.',
                                );
                              },
                              onDecline: () async {
                                if (!await _confirm(
                                  'Decline this unpaid appointment for ${a.patientName}? The booking will be cancelled.',
                                  title: 'Decline appointment?',
                                  confirmLabel: 'Decline',
                                  destructive: true,
                                )) {
                                  return;
                                }
                                await _runBusy(
                                  () => HospitalDeskRepository.declineUnpaid(
                                    a.id,
                                  ),
                                  'Unpaid appointment declined.',
                                );
                              },
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                HospitalSchedulesPanel(key: _schedulesKey),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(String label, String value) {
    final selected = _filter == value;
    return FilterChip(
      label: Text(
        label,
        style: TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 12.5,
          color: selected ? Colors.white : StaffSurfaces.textPrimary,
        ),
      ),
      selected: selected,
      onSelected: (_) => setState(() => _filter = value),
      selectedColor: StaffSurfaces.cta,
      backgroundColor: StaffSurfaces.softPanel,
      side: BorderSide(
        color: selected ? StaffSurfaces.cta : StaffSurfaces.cardBorder,
      ),
      showCheckmark: false,
      padding: const EdgeInsets.symmetric(horizontal: 4),
    );
  }
}

class _DeskCard extends StatelessWidget {
  final StaffAppointmentModel appointment;
  final String label;
  final String bucket;
  final bool busy;
  final VoidCallback onCheckIn;
  final VoidCallback onMarkPaid;
  final VoidCallback onNoShow;
  final VoidCallback onDecline;

  const _DeskCard({
    required this.appointment,
    required this.label,
    required this.bucket,
    required this.busy,
    required this.onCheckIn,
    required this.onMarkPaid,
    required this.onNoShow,
    required this.onDecline,
  });

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final isAwaiting = bucket == 'awaiting_payment';
    final isNotArrived = bucket == 'waiting' && !a.isCheckedIn;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        borderColor: isAwaiting
            ? const Color(0xFFF5B168)
            : StaffSurfaces.cardBorder,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: StaffSurfaces.softPanelDeep,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  a.token,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                    color: StaffSurfaces.brandSoft,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  a.patientName,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w800,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
              ),
              StaffStatusChip(
                label: label,
                tone: isAwaiting
                    ? StaffChipTone.warning
                    : bucket == 'completed'
                        ? StaffChipTone.success
                        : bucket == 'cancelled'
                            ? StaffChipTone.danger
                            : StaffChipTone.brand,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            a.vaccineName,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: StaffSurfaces.brandSoft,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            '${a.timeLabel}'
            '${a.boothLabel != null && a.boothLabel!.isNotEmpty ? ' · Booth ${a.boothLabel}' : ' · Unassigned booth'}'
            ' · ${a.isPaymentSettled ? 'Paid' : a.paymentStatus}',
            style: const TextStyle(
              fontSize: 12.5,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          if (isAwaiting || isNotArrived) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (!a.isCheckedIn)
                  OutlinedButton(
                    onPressed: busy ? null : onCheckIn,
                    child: const Text('Check in'),
                  ),
                if (isAwaiting)
                  FilledButton(
                    onPressed: busy ? null : onMarkPaid,
                    style: FilledButton.styleFrom(
                      backgroundColor: StaffSurfaces.cta,
                    ),
                    child: const Text('Mark paid'),
                  ),
                if (isAwaiting)
                  OutlinedButton(
                    onPressed: busy ? null : onDecline,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: BorderSide(
                        color: AppColors.error.withValues(alpha: 0.55),
                      ),
                    ),
                    child: const Text('Decline'),
                  ),
                if (isNotArrived && !isAwaiting)
                  OutlinedButton(
                    onPressed: busy ? null : onNoShow,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: BorderSide(
                        color: AppColors.error.withValues(alpha: 0.55),
                      ),
                    ),
                    child: const Text('No-show'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
