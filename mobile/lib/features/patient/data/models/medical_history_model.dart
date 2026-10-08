class PatientMedicalHistoryRecordModel {
  final String id;
  final String patientProfileId;
  final String title;
  final String? description;
  final String? icd10Code;
  final String recordType; // Diagnosis | Allergy | Medication | Surgery | Other
  final String severity; // Mild | Moderate | Severe | Critical
  final String status; // Active | Resolved | Chronic | InRemission
  final DateTime? diagnosedAt;
  final DateTime createdAt;
  final String? recordedByName;

  const PatientMedicalHistoryRecordModel({
    required this.id,
    required this.patientProfileId,
    required this.title,
    this.description,
    this.icd10Code,
    required this.recordType,
    required this.severity,
    required this.status,
    this.diagnosedAt,
    required this.createdAt,
    this.recordedByName,
  });

  factory PatientMedicalHistoryRecordModel.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic raw) {
      if (raw == null) return null;
      return DateTime.tryParse(raw.toString());
    }

    return PatientMedicalHistoryRecordModel(
      id: json['id']?.toString() ?? '',
      patientProfileId: json['patientProfileId']?.toString() ?? '',
      title: json['title']?.toString() ?? '—',
      description: json['description']?.toString(),
      icd10Code: json['icd10Code']?.toString(),
      recordType: json['recordType']?.toString() ?? 'Other',
      severity: json['severity']?.toString() ?? 'Mild',
      status: json['status']?.toString() ?? 'Active',
      diagnosedAt: parseDate(json['diagnosedAt']),
      createdAt: parseDate(json['createdAt']) ?? DateTime.now(),
      recordedByName: json['recordedByName']?.toString(),
    );
  }
}

class PatientMedicalHistoryTimelineModel {
  final String patientProfileId;
  final int totalRecords;
  final int activeConditions;
  final int criticalOrSevere;
  final List<PatientMedicalHistoryRecordModel> records;

  const PatientMedicalHistoryTimelineModel({
    required this.patientProfileId,
    required this.totalRecords,
    required this.activeConditions,
    required this.criticalOrSevere,
    required this.records,
  });

  factory PatientMedicalHistoryTimelineModel.fromJson(
    Map<String, dynamic> json,
  ) {
    return PatientMedicalHistoryTimelineModel(
      patientProfileId: json['patientProfileId']?.toString() ?? '',
      totalRecords: (json['totalRecords'] as num?)?.toInt() ?? 0,
      activeConditions: (json['activeConditions'] as num?)?.toInt() ?? 0,
      criticalOrSevere: (json['criticalOrSevere'] as num?)?.toInt() ?? 0,
      records:
          (json['records'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .map(PatientMedicalHistoryRecordModel.fromJson)
              .toList() ??
          const [],
    );
  }
}
