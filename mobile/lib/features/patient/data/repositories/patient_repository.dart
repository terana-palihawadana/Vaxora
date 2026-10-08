import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../models/schedule_model.dart';
import '../models/vaccination_record_model.dart';
import '../models/medical_history_model.dart';
import '../models/feedback_model.dart';

class PatientRepository {
  /// Fetch vaccination timeline and historical records for a patient
  static Future<PatientVaccinationTimelineModel?> getVaccinationTimeline(
    String patientProfileId,
  ) async {
    try {
      final endpoint =
          '${ApiConstants.patientVaccinations}/patients/$patientProfileId/timeline';
      final response = await ApiClient.get(endpoint);
      if (response is Map<String, dynamic>) {
        return PatientVaccinationTimelineModel.fromJson(response);
      }
    } catch (_) {}
    return null;
  }

  /// Fetch active schedules from hospitals across the country
  static Future<List<HospitalScheduleModel>> getAvailableSchedules({
    String? hospitalUserId,
    String? vaccineName,
  }) async {
    try {
      String endpoint = ApiConstants.availableSchedules;
      final queryParams = <String>[];
      if (hospitalUserId != null && hospitalUserId.isNotEmpty) {
        queryParams.add('hospitalUserId=$hospitalUserId');
      }
      if (vaccineName != null && vaccineName.isNotEmpty) {
        queryParams.add('vaccineName=${Uri.encodeComponent(vaccineName)}');
      }
      if (queryParams.isNotEmpty) {
        endpoint += '?${queryParams.join('&')}';
      }

      final response = await ApiClient.get(endpoint);
      if (response is List) {
        return response
            .map(
              (e) => HospitalScheduleModel.fromJson(e as Map<String, dynamic>),
            )
            .toList();
      }
    } catch (_) {}
    return [];
  }

  /// Fetch available time slots for booking on a specific date
  static Future<List<AvailableSlotModel>> getAvailableSlots({
    required String hospitalUserId,
    required String vaccineName,
    required String date,
  }) async {
    try {
      final endpoint =
          '${ApiConstants.availableSlots}?hospitalUserId=$hospitalUserId&vaccineName=${Uri.encodeComponent(vaccineName)}&date=$date';
      final response = await ApiClient.get(endpoint);
      if (response is List) {
        return response
            .map((e) => AvailableSlotModel.fromJson(e as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {}
    return [];
  }

  /// Fetch registered vaccines list from inventory formulary
  static Future<List<VaccineItemModel>> getVaccines() async {
    try {
      final response = await ApiClient.get(ApiConstants.vaccines);
      if (response is List) {
        return response
            .map((e) => VaccineItemModel.fromJson(e as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {}
    return [];
  }

  // ============================================================
  // Medical History
  // ============================================================

  /// Fetch the patient's medical history timeline.
  static Future<PatientMedicalHistoryTimelineModel?> getMedicalHistoryTimeline(
    String patientProfileId,
  ) async {
    try {
      final endpoint =
          '${ApiConstants.patientMedicalHistory}/patients/$patientProfileId/timeline';
      final response = await ApiClient.get(endpoint);
      if (response is Map<String, dynamic>) {
        return PatientMedicalHistoryTimelineModel.fromJson(response);
      }
    } catch (_) {}
    return null;
  }

  // ============================================================
  // Feedback
  // ============================================================

  /// Submit new feedback. When [isAnonymous] is true, the submitter
  /// fields are sent as null and the backend will not persist them.
  static Future<FeedbackModel?> submitFeedback({
    required String message,
    required int rating,
    required bool isAnonymous,
    String? submitterName,
    String? submitterEmail,
    String? submitterPhone,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.feedback,
      body: {
        'message': message,
        'rating': rating,
        'isAnonymous': isAnonymous,
        'submitterName': isAnonymous ? null : submitterName,
        'submitterEmail': isAnonymous ? null : submitterEmail,
        'submitterPhone': isAnonymous ? null : submitterPhone,
      },
    );
    if (response is Map<String, dynamic>) {
      return FeedbackModel.fromJson(response);
    }
    return null;
  }

  /// Get the current user's own feedback history.
  static Future<List<FeedbackModel>> getMyFeedback() async {
    try {
      final response = await ApiClient.get(ApiConstants.myFeedback);
      if (response is List) {
        return response
            .whereType<Map<String, dynamic>>()
            .map(FeedbackModel.fromJson)
            .toList();
      }
    } catch (_) {}
    return [];
  }

  /// Update an existing feedback (owner only, before resolution).
  static Future<FeedbackModel?> updateFeedback({
    required String id,
    required String message,
    required int rating,
    required bool isAnonymous,
    String? submitterName,
    String? submitterEmail,
    String? submitterPhone,
  }) async {
    final response = await ApiClient.put(
      ApiConstants.feedbackById(id),
      body: {
        'message': message,
        'rating': rating,
        'isAnonymous': isAnonymous,
        'submitterName': isAnonymous ? null : submitterName,
        'submitterEmail': isAnonymous ? null : submitterEmail,
        'submitterPhone': isAnonymous ? null : submitterPhone,
      },
    );
    if (response is Map<String, dynamic>) {
      return FeedbackModel.fromJson(response);
    }
    return null;
  }
}
