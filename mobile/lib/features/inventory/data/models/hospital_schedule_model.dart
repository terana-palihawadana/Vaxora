class HospitalScheduleModel {
  final String id;
  final String vaccineName;
  final String? boothLabel;
  final String? boothId;
  final String scheduleType;
  final String? specificDate;
  final String? startDate;
  final String? endDate;
  final String startTime;
  final String endTime;
  final double price;
  final String status;
  final List<String> daysOfWeek;

  const HospitalScheduleModel({
    required this.id,
    required this.vaccineName,
    this.boothLabel,
    this.boothId,
    required this.scheduleType,
    this.specificDate,
    this.startDate,
    this.endDate,
    required this.startTime,
    required this.endTime,
    required this.price,
    required this.status,
    this.daysOfWeek = const [],
  });

  String get timeLabel => '$startTime – $endTime';

  String get whenLabel {
    if (scheduleType.toLowerCase() == 'weekly') {
      final days = daysOfWeek.isEmpty ? 'Weekly' : daysOfWeek.join(', ');
      final range = [
        if (startDate != null && startDate!.isNotEmpty) startDate,
        if (endDate != null && endDate!.isNotEmpty) endDate,
      ].join(' → ');
      return range.isEmpty ? days : '$days · $range';
    }
    return specificDate?.isNotEmpty == true ? specificDate! : 'One-time';
  }

  bool get isCancelled =>
      status.toLowerCase() == 'cancelled' || status.toLowerCase() == 'canceled';

  factory HospitalScheduleModel.fromJson(Map<String, dynamic> json) {
    final days = json['daysOfWeek'];
    return HospitalScheduleModel(
      id: json['id']?.toString() ?? '',
      vaccineName: json['vaccineName']?.toString() ?? 'Vaccine',
      boothLabel: json['boothLabel']?.toString() ??
          json['boothName']?.toString() ??
          json['boothDisplayLabel']?.toString(),
      boothId: json['boothId']?.toString(),
      scheduleType: json['scheduleType']?.toString() ?? 'OneTime',
      specificDate: json['specificDate']?.toString(),
      startDate: json['startDate']?.toString(),
      endDate: json['endDate']?.toString(),
      startTime: json['startTime']?.toString() ?? '',
      endTime: json['endTime']?.toString() ?? '',
      price: double.tryParse(json['price']?.toString() ?? '') ?? 0,
      status: json['status']?.toString() ?? 'Active',
      daysOfWeek: days is List
          ? days.map((e) => e.toString()).toList()
          : const [],
    );
  }
}
