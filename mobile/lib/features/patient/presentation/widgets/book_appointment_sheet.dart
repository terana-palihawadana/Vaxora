import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/schedule_model.dart';
import '../../data/repositories/appointment_repository.dart';
import '../../data/repositories/patient_repository.dart';

class BookAppointmentSheet extends StatefulWidget {
  final Function(Map<String, dynamic> appointmentData) onAppointmentBooked;

  const BookAppointmentSheet({
    super.key,
    required this.onAppointmentBooked,
  });

  @override
  State<BookAppointmentSheet> createState() => _BookAppointmentSheetState();
}

class _BookAppointmentSheetState extends State<BookAppointmentSheet> {
  final _notesController = TextEditingController();

  List<String> _vaccines = [
    'COVID-19 mRNA Booster (Moderna / Pfizer)',
    'AstraZeneca',
    'Influenza (Quadrivalent Seasonal)',
    'Hepatitis B Recombinant Booster',
    'HPV (Human Papillomavirus)',
    'Tetanus & Diphtheria (Td Adult)',
  ];

  List<HospitalScheduleModel> _schedules = [];

  List<String> _slots = [
    '09:00 AM - 09:20 AM',
    '09:20 AM - 09:40 AM',
    '09:40 AM - 10:00 AM',
    '10:00 AM - 10:20 AM',
    '10:20 AM - 10:40 AM',
    '10:40 AM - 11:00 AM',
    '02:00 PM - 02:20 PM',
    '02:20 PM - 02:40 PM',
  ];

  String? _selectedVaccine;
  HospitalScheduleModel? _selectedSchedule;
  DateTime? _selectedDate;
  String? _selectedSlot;
  bool _isLoadingData = true;
  bool _isLoadingSlots = false;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now().add(const Duration(days: 2));
    _fetchBackendData();
  }

  Future<void> _fetchBackendData() async {
    setState(() => _isLoadingData = true);
    try {
      final futures = await Future.wait([
        PatientRepository.getAvailableSchedules(),
        PatientRepository.getVaccines(),
      ]);

      final schedules = futures[0] as List<HospitalScheduleModel>;
      final vaccines = futures[1] as List<VaccineItemModel>;

      if (mounted) {
        setState(() {
          if (vaccines.isNotEmpty) {
            final distinctNames = vaccines.map((v) => v.name).toSet().toList();
            _vaccines = distinctNames;
          }
          _schedules = schedules;

          if (_vaccines.isNotEmpty) {
            _selectedVaccine = _vaccines.first;
          }
          if (_schedules.isNotEmpty) {
            _selectedSchedule = _schedules.first;
          }
          _selectedSlot = _slots.first;
          _isLoadingData = false;
        });

        _fetchSlotsForCurrentSelection();
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isLoadingData = false);
      }
    }
  }

  Future<void> _fetchSlotsForCurrentSelection() async {
    if (_selectedSchedule == null || _selectedVaccine == null || _selectedDate == null) {
      return;
    }

    setState(() => _isLoadingSlots = true);
    try {
      final dateStr =
          "${_selectedDate!.year}-${_selectedDate!.month.toString().padLeft(2, '0')}-${_selectedDate!.day.toString().padLeft(2, '0')}";

      final slots = await PatientRepository.getAvailableSlots(
        hospitalUserId: _selectedSchedule!.hospitalUserId,
        vaccineName: _selectedVaccine!,
        date: dateStr,
      );

      if (mounted && slots.isNotEmpty) {
        setState(() {
          _slots = slots.map((s) => s.slot).toList();
          _selectedSlot = _slots.first;
          _isLoadingSlots = false;
        });
      } else if (mounted) {
        setState(() => _isLoadingSlots = false);
      }
    } catch (_) {
      if (mounted) setState(() => _isLoadingSlots = false);
    }
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: ColorScheme.light(
              primary: StaffSurfaces.cta,
              onPrimary: Colors.white,
              onSurface: StaffSurfaces.textPrimary,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() => _selectedDate = picked);
      _fetchSlotsForCurrentSelection();
    }
  }

  Future<void> _handleConfirm({bool payAtDesk = false}) async {
    if (_selectedVaccine == null || _selectedDate == null || _selectedSlot == null) {
      setState(() => _errorMessage = 'Please complete all required fields.');
      return;
    }

    final hospitalUserId = _selectedSchedule?.hospitalUserId;
    if (hospitalUserId == null || hospitalUserId.isEmpty) {
      setState(() => _errorMessage = 'Please select a valid hospital.');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final dateStr =
        "${_selectedDate!.year}-${_selectedDate!.month.toString().padLeft(2, '0')}-${_selectedDate!.day.toString().padLeft(2, '0')}";

    try {
      final hasFee = _selectedSchedule != null && _selectedSchedule!.price > 0;
      // 'Hospital' holds the slot and leaves payment to the hospital desk on the day.
      final paymentMethod = !hasFee
          ? 'Free'
          : payAtDesk
              ? 'Hospital'
              : 'PayHere';

      final appt = await AppointmentRepository.bookAppointment(
        hospitalUserId: hospitalUserId,
        vaccineName: _selectedVaccine!,
        appointmentDate: dateStr,
        timeSlot: _selectedSlot!,
        notes: _notesController.text.trim(),
        paymentMethod: paymentMethod,
      );

      if (mounted) {
        setState(() => _isSubmitting = false);
        widget.onAppointmentBooked({
          'id': appt.referenceNumber ?? (appt.id.length > 8 ? appt.id.substring(0, 8) : appt.id),
          'rawId': appt.id,
          'vaccineName': appt.vaccineName,
          'hospitalName': appt.hospitalName,
          'location': 'Assigned Center',
          'date': appt.appointmentDate,
          'time': appt.timeSlot,
          'doctorName': 'Medical Officer',
          'status': appt.status,
          'fee': appt.fee ?? 0.0,
          'isPaid': appt.isPaid,
          'payAtDesk': hasFee && payAtDesk,
        });
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _errorMessage = e.toString().replaceFirst('ApiException: ', '').replaceFirst('Exception: ', '');
        });
      }
    }
  }

  InputDecoration _field(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(
        color: StaffSurfaces.textMutedSoft,
        fontSize: 13,
      ),
      filled: true,
      fillColor: StaffSurfaces.cardBg,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: StaffSurfaces.brandSoft),
      ),
    );
  }

  Widget _label(String text) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.5,
        color: StaffSurfaces.textSecondary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fee = _selectedSchedule != null ? _selectedSchedule!.price : 0.0;
    final feeText =
        fee == 0.0 ? 'Free (gov. immunization)' : 'LKR ${fee.toStringAsFixed(2)}';
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        decoration: const BoxDecoration(
          color: StaffSurfaces.appBarBg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: StaffSurfaces.chipNeutralBorder,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: StaffSurfaces.softPanelDeep,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        Icons.event_available_outlined,
                        color: StaffSurfaces.brandSoft,
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Text(
                        'Book a slot',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: Icon(Icons.close, color: StaffSurfaces.textSecondary),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_isLoadingData) ...[
                  LinearProgressIndicator(color: StaffSurfaces.brandSoft),
                  const SizedBox(height: 12),
                ],
                if (_errorMessage != null) ...[
                  StaffErrorBanner(
                    message: _errorMessage!,
                    onDismiss: () => setState(() => _errorMessage = null),
                  ),
                  const SizedBox(height: 12),
                ],

                _label('Vaccine'),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  initialValue: _selectedVaccine,
                  decoration: _field('Choose vaccine'),
                  dropdownColor: StaffSurfaces.cardBg,
                  isExpanded: true,
                  items: _vaccines.map((v) {
                    return DropdownMenuItem(
                      value: v,
                      child: Text(
                        v,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                    );
                  }).toList(),
                  onChanged: (v) {
                    setState(() => _selectedVaccine = v);
                    _fetchSlotsForCurrentSelection();
                  },
                ),
                const SizedBox(height: 14),
                _label('Hospital / center'),
                const SizedBox(height: 6),
                if (_schedules.isNotEmpty)
                  DropdownButtonFormField<HospitalScheduleModel>(
                    initialValue: _selectedSchedule,
                    decoration: _field('Choose center'),
                    dropdownColor: StaffSurfaces.cardBg,
                    isExpanded: true,
                    items: _schedules.map((s) {
                      return DropdownMenuItem(
                        value: s,
                        child: Text(
                          '${s.hospitalName} · ${s.vaccineName} (${s.formattedPrice})',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: StaffSurfaces.textPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      );
                    }).toList(),
                    onChanged: (s) {
                      setState(() {
                        _selectedSchedule = s;
                        if (s?.vaccineName.isNotEmpty == true &&
                            _vaccines.contains(s!.vaccineName)) {
                          _selectedVaccine = s.vaccineName;
                        }
                      });
                      _fetchSlotsForCurrentSelection();
                    },
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: StaffSurfaces.softWell(),
                    child: const Text(
                      'National hospital network (direct assignment)',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: StaffSurfaces.textPrimary,
                      ),
                    ),
                  ),
                const SizedBox(height: 14),
                _label('Appointment date'),
                const SizedBox(height: 6),
                InkWell(
                  onTap: _pickDate,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: StaffSurfaces.cardBg,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: StaffSurfaces.cardBorder),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          _selectedDate != null
                              ? '${_selectedDate!.year}-${_selectedDate!.month.toString().padLeft(2, '0')}-${_selectedDate!.day.toString().padLeft(2, '0')}'
                              : 'Select date',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: StaffSurfaces.textPrimary,
                          ),
                        ),
                        Icon(
                          Icons.calendar_today_outlined,
                          size: 18,
                          color: StaffSurfaces.brandSoft,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _label('20-minute slot'),
                    if (_isLoadingSlots)
                      SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: StaffSurfaces.brandSoft,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _slots.map((slot) {
                    final isSelected = _selectedSlot == slot;
                    return ChoiceChip(
                      label: Text(
                        slot,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: isSelected
                              ? Colors.white
                              : StaffSurfaces.textPrimary,
                        ),
                      ),
                      selected: isSelected,
                      selectedColor: StaffSurfaces.cta,
                      backgroundColor: StaffSurfaces.softPanel,
                      side: BorderSide(
                        color: isSelected
                            ? StaffSurfaces.cta
                            : StaffSurfaces.cardBorder,
                      ),
                      onSelected: (selected) {
                        if (selected) setState(() => _selectedSlot = slot);
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 14),
                _label('Notes (optional)'),
                const SizedBox(height: 6),
                TextField(
                  controller: _notesController,
                  maxLines: 2,
                  decoration: _field(
                    'Allergy, preferred arm, or anything the center should know',
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: StaffSurfaces.softWell(),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Fee',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                      Text(
                        feeText,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: fee == 0.0
                              ? AppColors.success
                              : StaffSurfaces.brandSoft,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _isSubmitting ? null : _handleConfirm,
                  style: FilledButton.styleFrom(
                    backgroundColor: StaffSurfaces.cta,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: StaffSurfaces.softPanelDeep,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Confirm slot'),
                ),
                if (fee > 0) ...[
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _isSubmitting
                        ? null
                        : () => _handleConfirm(payAtDesk: true),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: StaffSurfaces.cta,
                      side: BorderSide(color: StaffSurfaces.cta),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    child: const Text('Pay on the day'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
