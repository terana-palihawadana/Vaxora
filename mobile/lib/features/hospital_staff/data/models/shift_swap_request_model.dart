class ShiftSwapRequestModel {
  final String id;
  final String shiftId;
  final String requesterUserId;
  final String requesterName;
  final String requesterRole;
  final String? requesterPhotoUrl;
  final String shiftDate;
  final String? shiftWindow;
  final String? boothOrStation;
  final String? reason;
  final String? conversationSnippet;
  final String status;
  final String? decisionNote;
  final String createdAt;
  final String? decidedAt;
  final String? reviewSummary;
  final bool aiRanked;
  final String? hospitalName;
  final String? direction;
  final String? replacementUserId;
  final String? replacementName;
  final List<ShiftSwapReplacementModel> suggestions;

  const ShiftSwapRequestModel({
    required this.id,
    required this.shiftId,
    required this.requesterUserId,
    required this.requesterName,
    required this.requesterRole,
    this.requesterPhotoUrl,
    required this.shiftDate,
    this.shiftWindow,
    this.boothOrStation,
    this.reason,
    this.conversationSnippet,
    required this.status,
    this.decisionNote,
    required this.createdAt,
    this.decidedAt,
    this.reviewSummary,
    this.aiRanked = false,
    this.hospitalName,
    this.direction,
    this.replacementUserId,
    this.replacementName,
    this.suggestions = const [],
  });

  bool get isPending => status.toUpperCase() == 'PENDING';
  bool get isApproved => status.toUpperCase() == 'APPROVED';
  bool get isDeclined => status.toUpperCase() == 'DECLINED';
  bool get isCancelled => status.toUpperCase() == 'CANCELLED';
  bool get isIncoming => (direction ?? '').toUpperCase() == 'INCOMING';
  bool get isOutgoing => !isIncoming;

  DateTime? get shiftDay {
    final raw = shiftDate.trim();
    if (raw.length < 10) return DateTime.tryParse(raw);
    return DateTime.tryParse(raw.substring(0, 10));
  }

  bool get isUpcoming {
    final day = shiftDay;
    if (day == null) return true;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return !DateTime(day.year, day.month, day.day).isBefore(today);
  }

  String get dateLabel {
    final raw = shiftDate.trim();
    if (raw.length < 10) return raw;
    final parsed = DateTime.tryParse(raw.substring(0, 10));
    if (parsed == null) return raw;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${parsed.day} ${months[parsed.month - 1]}';
  }

  String get shiftLine {
    final parts = <String>[dateLabel];
    final window = shiftWindow?.trim();
    if (window != null && window.isNotEmpty) parts.add(window);
    final booth = boothOrStation?.trim();
    if (booth != null && booth.isNotEmpty) parts.add(booth);
    return parts.join(' · ');
  }

  factory ShiftSwapRequestModel.fromJson(Map<String, dynamic> json) {
    return ShiftSwapRequestModel(
      id: json['id']?.toString() ?? '',
      shiftId: json['shiftId']?.toString() ?? '',
      requesterUserId: json['requesterUserId']?.toString() ?? '',
      requesterName: json['requesterName']?.toString() ?? 'Staff',
      requesterRole: json['requesterRole']?.toString() ?? '',
      requesterPhotoUrl: json['requesterPhotoUrl']?.toString(),
      shiftDate: json['shiftDate']?.toString() ?? '',
      shiftWindow: json['shiftWindow']?.toString(),
      boothOrStation: json['boothOrStation']?.toString(),
      reason: json['reason']?.toString(),
      conversationSnippet: json['conversationSnippet']?.toString(),
      status: json['status']?.toString() ?? 'Pending',
      decisionNote: json['decisionNote']?.toString(),
      createdAt: json['createdAt']?.toString() ?? '',
      decidedAt: json['decidedAt']?.toString(),
      reviewSummary: json['reviewSummary']?.toString(),
      aiRanked: json['aiRanked'] == true,
      hospitalName: json['hospitalName']?.toString(),
      direction: json['direction']?.toString(),
      replacementUserId: json['replacementUserId']?.toString(),
      replacementName: json['replacementName']?.toString(),
      suggestions: _parseSuggestions(json['suggestions']),
    );
  }
}

List<ShiftSwapReplacementModel> _parseSuggestions(dynamic raw) {
  if (raw is! List) return const [];
  return raw
      .whereType<Map<String, dynamic>>()
      .map(ShiftSwapReplacementModel.fromJson)
      .toList();
}

class ShiftSwapReplacementModel {
  final String affiliationId;
  final String staffUserId;
  final String staffName;
  final String staffRole;
  final String? staffPhotoUrl;
  final String? specialization;
  final String why;
  final bool available;

  const ShiftSwapReplacementModel({
    required this.affiliationId,
    required this.staffUserId,
    required this.staffName,
    required this.staffRole,
    this.staffPhotoUrl,
    this.specialization,
    required this.why,
    this.available = true,
  });

  factory ShiftSwapReplacementModel.fromJson(Map<String, dynamic> json) {
    return ShiftSwapReplacementModel(
      affiliationId: json['affiliationId']?.toString() ?? '',
      staffUserId: json['staffUserId']?.toString() ?? '',
      staffName: json['staffName']?.toString() ?? 'Staff',
      staffRole: json['staffRole']?.toString() ?? '',
      staffPhotoUrl: json['staffPhotoUrl']?.toString(),
      specialization: json['specialization']?.toString(),
      why: json['why']?.toString() ?? '',
      available: json['available'] != false,
    );
  }
}
