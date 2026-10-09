import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../../../staff/data/models/shift_model.dart';
import '../models/hospital_booth_model.dart';
import '../models/hospital_staff_candidate_model.dart';
import '../models/hospital_staff_member_model.dart';
import '../models/shift_swap_request_model.dart';

class HospitalStaffRepository {
  HospitalStaffRepository._();

  static List<HospitalStaffMemberModel> _parse(dynamic response) {
    if (response is! List) return [];
    return response
        .map((e) =>
            HospitalStaffMemberModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static List<HospitalStaffCandidateModel> _parseCandidates(dynamic response) {
    if (response is! List) return [];
    return response
        .map((e) =>
            HospitalStaffCandidateModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// List of staff affiliated with this hospital.
  /// Filters (all optional): role, dutyStatus, search, status.
  /// [status] defaults to Active on the server when omitted; pass 'All'
  /// to include Pending and Rejected too.
  static Future<List<HospitalStaffMemberModel>> getStaff({
    String? role,
    String? dutyStatus,
    String? search,
    String? status,
  }) async {
    final query = <String, String>{};
    if (role != null && role.isNotEmpty) query['role'] = role;
    if (dutyStatus != null && dutyStatus.isNotEmpty) {
      query['dutyStatus'] = dutyStatus;
    }
    if (search != null && search.trim().isNotEmpty) {
      query['search'] = search.trim();
    }
    if (status != null && status.isNotEmpty) query['status'] = status;

    try {
      final response = await ApiClient.get(
        ApiConstants.hospitalStaffRoster,
        queryParams: query.isEmpty ? null : query,
      );
      return _parse(response);
    } on ApiException {
      rethrow;
    } catch (_) {
      return [];
    }
  }

  /// Search doctors / nurses this hospital can invite.
  /// Matches on registration number, name, or email.
  static Future<List<HospitalStaffCandidateModel>> searchCandidates(
    String query, {
    int limit = 10,
  }) async {
    final params = <String, String>{'limit': '$limit'};
    if (query.trim().isNotEmpty) params['q'] = query.trim();

    try {
      final response = await ApiClient.get(
        ApiConstants.hospitalStaffCandidates,
        queryParams: params,
      );
      return _parseCandidates(response);
    } on ApiException {
      rethrow;
    } catch (_) {
      return [];
    }
  }

  /// Send an invitation using the staff member's registration number.
  static Future<HospitalStaffMemberModel> invite(
    String registrationNumber,
  ) async {
    final response = await ApiClient.post(
      ApiConstants.hospitalStaffInvite,
      body: {'registrationNumber': registrationNumber.trim()},
    );
    if (response is Map<String, dynamic>) {
      return HospitalStaffMemberModel.fromJson(response);
    }
    throw ApiException('Failed to parse invitation response.');
  }

  /// Cover requests from affiliated doctors / nurses.
  static Future<List<ShiftSwapRequestModel>> getShiftSwaps({
    String? status,
  }) async {
    final query = <String, String>{};
    if (status != null && status.isNotEmpty) query['status'] = status;

    try {
      final response = await ApiClient.get(
        ApiConstants.hospitalShiftSwaps,
        queryParams: query.isEmpty ? null : query,
      );
      if (response is! List) return [];
      return response
          .map((e) =>
              ShiftSwapRequestModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on ApiException {
      rethrow;
    } catch (_) {
      return [];
    }
  }

  /// Re-orders one pending request's replacements with the AI agent (on demand).
  static Future<ShiftSwapRequestModel> rankShiftSwap(String requestId) async {
    final response =
        await ApiClient.post(ApiConstants.hospitalShiftSwapRank(requestId));
    if (response is Map<String, dynamic>) {
      return ShiftSwapRequestModel.fromJson(response);
    }
    throw ApiException('AI ranking unavailable right now.');
  }

  static Future<ShiftSwapRequestModel> decideShiftSwap({
    required String requestId,
    required bool approved,
    String? note,
    String? replacementAffiliationId,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.hospitalShiftSwapDecision(requestId),
      body: {
        'approved': approved,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        if (replacementAffiliationId != null &&
            replacementAffiliationId.trim().isNotEmpty)
          'replacementAffiliationId': replacementAffiliationId.trim(),
      },
    );
    if (response is Map<String, dynamic>) {
      return ShiftSwapRequestModel.fromJson(response);
    }
    throw ApiException('Failed to record decision.');
  }

  /// Shifts scheduled at this hospital in the given ISO date range.
  static Future<List<ShiftModel>> getShifts({
    String? from,
    String? to,
  }) async {
    final query = <String, String>{};
    if (from != null && from.isNotEmpty) query['from'] = from;
    if (to != null && to.isNotEmpty) query['to'] = to;

    try {
      final response = await ApiClient.get(
        ApiConstants.hospitalStaffShifts,
        queryParams: query.isEmpty ? null : query,
      );
      if (response is! List) return [];
      return response
          .map((e) => ShiftModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on ApiException {
      rethrow;
    } catch (_) {
      return [];
    }
  }

  static Future<List<HospitalBoothModel>> getBooths({
    bool activeOnly = false,
  }) async {
    final response = await ApiClient.get(
      ApiConstants.hospitalBooths,
      queryParams: activeOnly ? {'activeOnly': 'true'} : null,
    );
    if (response is! List) return [];
    return response
        .map((e) => HospitalBoothModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<HospitalBoothModel> createBooth({
    required String code,
    required String name,
    List<String> vaccineIds = const [],
  }) async {
    final response = await ApiClient.post(
      ApiConstants.hospitalBooths,
      body: {
        'code': code.trim(),
        'name': name.trim(),
        'vaccineIds': vaccineIds,
      },
    );
    if (response is Map<String, dynamic>) {
      return HospitalBoothModel.fromJson(response);
    }
    throw ApiException('Failed to create booth.');
  }

  static Future<HospitalBoothModel> updateBooth({
    required String boothId,
    required String code,
    required String name,
    required bool isActive,
    int? sortOrder,
    List<String> vaccineIds = const [],
  }) async {
    final response = await ApiClient.put(
      ApiConstants.hospitalBooth(boothId),
      body: {
        'code': code.trim(),
        'name': name.trim(),
        'isActive': isActive,
        if (sortOrder != null) 'sortOrder': sortOrder,
        'vaccineIds': vaccineIds,
      },
    );
    if (response is Map<String, dynamic>) {
      return HospitalBoothModel.fromJson(response);
    }
    throw ApiException('Failed to update booth.');
  }

  static Future<void> deactivateBooth(String boothId) async {
    await ApiClient.delete(ApiConstants.hospitalBooth(boothId));
  }

  static Future<ShiftModel> createShift({
    required String affiliationId,
    required String shiftDate,
    required String startTime,
    required String endTime,
    String? boothId,
    String? boothOrStation,
    String? notes,
  }) async {
    String norm(String t) {
      final s = t.trim();
      if (s.length == 5) return '$s:00';
      return s;
    }

    final date = shiftDate.length >= 10 ? shiftDate.substring(0, 10) : shiftDate;
    final response = await ApiClient.post(
      ApiConstants.hospitalCreateShift,
      body: {
        'affiliationId': affiliationId,
        'shiftDate': date,
        'startTime': norm(startTime),
        'endTime': norm(endTime),
        if (boothId != null && boothId.isNotEmpty) 'boothId': boothId,
        if (boothOrStation != null && boothOrStation.trim().isNotEmpty)
          'boothOrStation': boothOrStation.trim(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
    );
    if (response is Map<String, dynamic>) {
      return ShiftModel.fromJson(response);
    }
    throw ApiException('Failed to create shift.');
  }

  /// Rules-based fallback when the AI agent is offline.
  static Future<Map<String, dynamic>> suggestWeek({
    required String from,
    required String to,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.hospitalSuggestWeek,
      body: {'from': from, 'to': to},
    );
    if (response is Map<String, dynamic>) return response;
    throw ApiException('Failed to suggest week coverage.');
  }

  /// Chat with StaffSchedulingAgent. Returns content + proposals + workflowId.
  static Future<Map<String, dynamic>> chatSchedulingAgent({
    required List<Map<String, String>> messages,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.agentChat,
      body: {
        'targetAgent': 'StaffSchedulingAgent',
        'messages': messages,
      },
    );
    if (response is Map<String, dynamic>) return response;
    throw ApiException('Scheduling agent returned an unexpected response.');
  }

  static Future<void> recordAgentDecision({
    required String workflowId,
    required bool approved,
    String? note,
  }) async {
    try {
      await ApiClient.post(
        ApiConstants.agentWorkflowDecision(workflowId),
        body: {
          'approved': approved,
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        },
      );
    } catch (_) {
      // Shift writes already succeeded; workflow note is optional.
    }
  }
}
