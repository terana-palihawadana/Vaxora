class AffiliationModel {
  final String affiliationId;
  final String hospitalUserId;
  final String hospitalName;
  final String? hospitalLogoUrl;
  final String staffUserId;
  final String staffName;
  final String staffRole;
  final String? specialization;
  final String status;
  final String dutyStatus;
  final bool isOnDutyNow;
  final bool isClockedIn;
  final String? invitedAt;
  final String? respondedAt;

  const AffiliationModel({
    required this.affiliationId,
    required this.hospitalUserId,
    required this.hospitalName,
    this.hospitalLogoUrl,
    required this.staffUserId,
    required this.staffName,
    required this.staffRole,
    this.specialization,
    required this.status,
    required this.dutyStatus,
    required this.isOnDutyNow,
    this.isClockedIn = false,
    this.invitedAt,
    this.respondedAt,
  });

  bool get isPending => status.toUpperCase() == 'PENDING';
  bool get isActive => status.toUpperCase() == 'ACTIVE';
  bool get isOnBreak => dutyStatus.toUpperCase() == 'ONBREAK';

  /// Short duty label matching the web dashboard.
  String get dutyLabel {
    if (isOnBreak) return 'On break';
    if (isOnDutyNow) return isClockedIn ? 'Clocked in' : 'On shift';
    return 'Not on duty';
  }

  factory AffiliationModel.fromJson(Map<String, dynamic> json) {
    return AffiliationModel(
      affiliationId: json['affiliationId']?.toString() ?? '',
      hospitalUserId: json['hospitalUserId']?.toString() ?? '',
      hospitalName: json['hospitalName']?.toString() ?? 'Hospital',
      hospitalLogoUrl: json['hospitalLogoUrl']?.toString(),
      staffUserId: json['staffUserId']?.toString() ?? '',
      staffName: json['staffName']?.toString() ?? 'Staff',
      staffRole: json['staffRole']?.toString() ?? '',
      specialization: json['specialization']?.toString(),
      status: json['status']?.toString() ?? '',
      dutyStatus: json['dutyStatus']?.toString() ?? '',
      isOnDutyNow: json['isOnDutyNow'] == true,
      isClockedIn: json['isClockedIn'] == true,
      invitedAt: json['invitedAt']?.toString(),
      respondedAt: json['respondedAt']?.toString(),
    );
  }
}
