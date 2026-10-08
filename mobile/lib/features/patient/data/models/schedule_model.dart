class HospitalScheduleModel {
  final String id;
  final String hospitalUserId;
  final String hospitalName;
  final String? vaccineId;
  final String vaccineName;
  final String scheduleType;
  final String? specificDate;
  final List<String> daysOfWeek;
  final String? startDate;
  final String? endDate;
  final String startTime;
  final String endTime;
  final String formattedTime;
  final String displayRecurrence;
  final double price;
  final String formattedPrice;
  final String status;

  const HospitalScheduleModel({
    required this.id,
    required this.hospitalUserId,
    required this.hospitalName,
    this.vaccineId,
    required this.vaccineName,
    required this.scheduleType,
    this.specificDate,
    this.daysOfWeek = const [],
    this.startDate,
    this.endDate,
    required this.startTime,
    required this.endTime,
    required this.formattedTime,
    required this.displayRecurrence,
    required this.price,
    required this.formattedPrice,
    required this.status,
  });

  factory HospitalScheduleModel.fromJson(Map<String, dynamic> json) {
    return HospitalScheduleModel(
      id: json['id']?.toString() ?? '',
      hospitalUserId: json['hospitalUserId']?.toString() ?? '',
      hospitalName: json['hospitalName']?.toString() ?? 'Hospital',
      vaccineId: json['vaccineId']?.toString(),
      vaccineName: json['vaccineName']?.toString() ?? '',
      scheduleType: json['scheduleType']?.toString() ?? 'OneTime',
      specificDate: json['specificDate']?.toString(),
      daysOfWeek: (json['daysOfWeek'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      startDate: json['startDate']?.toString(),
      endDate: json['endDate']?.toString(),
      startTime: json['startTime']?.toString() ?? '',
      endTime: json['endTime']?.toString() ?? '',
      formattedTime: json['formattedTime']?.toString() ?? '',
      displayRecurrence: json['displayRecurrence']?.toString() ?? '',
      price: (json['price'] as num?)?.toDouble() ?? 0.0,
      formattedPrice: json['formattedPrice']?.toString() ?? 'Free',
      status: json['status']?.toString() ?? 'Active',
    );
  }
}

class AvailableSlotModel {
  final String slot;
  final String startTime;
  final String endTime;
  final bool isBooked;
  final String displayStatus;

  const AvailableSlotModel({
    required this.slot,
    required this.startTime,
    required this.endTime,
    required this.isBooked,
    required this.displayStatus,
  });

  factory AvailableSlotModel.fromJson(Map<String, dynamic> json) {
    return AvailableSlotModel(
      slot: json['slot']?.toString() ?? '',
      startTime: json['startTime']?.toString() ?? '',
      endTime: json['endTime']?.toString() ?? '',
      isBooked: json['isBooked'] == true,
      displayStatus: json['displayStatus']?.toString() ?? 'Available',
    );
  }
}

class VaccineItemModel {
  final String id;
  final String name;
  final String manufacturer;
  final String category;

  const VaccineItemModel({
    required this.id,
    required this.name,
    required this.manufacturer,
    required this.category,
  });

  factory VaccineItemModel.fromJson(Map<String, dynamic> json) {
    return VaccineItemModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      manufacturer: json['manufacturer']?.toString() ?? '',
      category: json['category']?.toString() ?? 'routine',
    );
  }
}
