class HospitalBoothModel {
  final String boothId;
  final String code;
  final String name;
  final String displayLabel;
  final bool isActive;
  final int sortOrder;
  final List<String> vaccineIds;
  final List<String> vaccineNames;

  const HospitalBoothModel({
    required this.boothId,
    required this.code,
    required this.name,
    required this.displayLabel,
    required this.isActive,
    required this.sortOrder,
    required this.vaccineIds,
    required this.vaccineNames,
  });

  factory HospitalBoothModel.fromJson(Map<String, dynamic> json) {
    return HospitalBoothModel(
      boothId: json['boothId']?.toString() ?? json['id']?.toString() ?? '',
      code: json['code']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      displayLabel: json['displayLabel']?.toString() ??
          json['name']?.toString() ??
          '',
      isActive: json['isActive'] != false,
      sortOrder: int.tryParse(json['sortOrder']?.toString() ?? '') ?? 0,
      vaccineIds: (json['vaccineIds'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      vaccineNames: (json['vaccineNames'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
    );
  }
}
