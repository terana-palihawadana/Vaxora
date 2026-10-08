class FeedbackModel {
  final String id;
  final String userId;
  final bool isAnonymous;
  final String? submitterName;
  final String? submitterEmail;
  final String? submitterPhone;
  final String? hospitalName;
  final String category;
  final String? subject;
  final String message;
  final int rating;
  final String status; // New | InReview | Resolved | Escalated
  final String? adminResponse;
  final DateTime? repliedAt;
  final String? internalNotes;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const FeedbackModel({
    required this.id,
    required this.userId,
    required this.isAnonymous,
    this.submitterName,
    this.submitterEmail,
    this.submitterPhone,
    this.hospitalName,
    required this.category,
    this.subject,
    required this.message,
    required this.rating,
    required this.status,
    this.adminResponse,
    this.repliedAt,
    this.internalNotes,
    required this.createdAt,
    this.updatedAt,
  });

  bool get isResolved => status.toLowerCase() == 'resolved';

  factory FeedbackModel.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic raw) {
      if (raw == null) return null;
      return DateTime.tryParse(raw.toString());
    }

    return FeedbackModel(
      id: json['id']?.toString() ?? '',
      userId: json['userId']?.toString() ?? '',
      isAnonymous: json['isAnonymous'] == true,
      submitterName: json['submitterName']?.toString(),
      submitterEmail: json['submitterEmail']?.toString(),
      submitterPhone: json['submitterPhone']?.toString(),
      hospitalName: json['hospitalName']?.toString(),
      category: json['category']?.toString() ?? 'General Feedback',
      subject: json['subject']?.toString(),
      message: json['message']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toInt() ?? 5,
      status: json['status']?.toString() ?? 'New',
      adminResponse: json['adminResponse']?.toString(),
      repliedAt: parseDate(json['repliedAt']),
      internalNotes: json['internalNotes']?.toString(),
      createdAt: parseDate(json['createdAt']) ?? DateTime.now(),
      updatedAt: parseDate(json['updatedAt']),
    );
  }
}
