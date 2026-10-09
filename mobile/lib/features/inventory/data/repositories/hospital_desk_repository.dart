import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../../../staff/data/models/staff_appointment_model.dart';

/// Hospital-owner desk queue: walk-ins, check-in, mark paid, no-show.
class HospitalDeskRepository {
  HospitalDeskRepository._();

  static List<StaffAppointmentModel> _parse(dynamic response) {
    if (response is! List) return [];
    return response
        .map((e) => StaffAppointmentModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<StaffAppointmentModel>> getQueue({String? date}) async {
    final query = <String, String>{};
    if (date != null && date.trim().isNotEmpty) {
      query['date'] = date.trim();
    }
    final response = await ApiClient.get(
      ApiConstants.hospitalAppointments,
      queryParams: query.isEmpty ? null : query,
    );
    return _parse(response);
  }

  static Future<StaffAppointmentModel> createWalkIn({
    required String patientNic,
    required String patientName,
    required String patientEmail,
    required String patientPhone,
    required String vaccineName,
    String? dose,
    String? boothLabel,
    int? age,
    String? gender,
  }) async {
    final body = <String, dynamic>{
      'patientNic': patientNic.trim(),
      'patientName': patientName.trim(),
      'patientEmail': patientEmail.trim(),
      'patientPhone': patientPhone.trim(),
      'vaccineName': vaccineName.trim(),
    };
    if (dose != null && dose.trim().isNotEmpty) body['dose'] = dose.trim();
    if (boothLabel != null && boothLabel.trim().isNotEmpty) {
      body['boothLabel'] = boothLabel.trim();
    }
    if (age != null) body['age'] = age;
    if (gender != null && gender.trim().isNotEmpty) {
      body['gender'] = gender.trim();
    }

    final response = await ApiClient.post(
      ApiConstants.hospitalWalkIn,
      body: body,
    );
    if (response is Map<String, dynamic>) {
      return StaffAppointmentModel.fromJson(response);
    }
    throw ApiException('Failed to register walk-in.');
  }

  static Future<void> checkIn(String appointmentId) async {
    await ApiClient.post(ApiConstants.appointmentCheckIn(appointmentId));
  }

  /// Desk counter payment: PendingPayment → Confirmed (sets PaymentStatus Paid).
  static Future<void> markPaid(String appointmentId) async {
    await ApiClient.patch(
      ApiConstants.appointmentStatus(appointmentId),
      body: {'status': 'Confirmed'},
    );
  }

  static Future<void> markNoShow(String appointmentId) async {
    await ApiClient.patch(
      ApiConstants.appointmentStatus(appointmentId),
      body: {
        'status': 'Cancelled',
        'remarks': 'No-show — patient did not arrive',
      },
    );
  }

  static Future<void> declineUnpaid(String appointmentId) async {
    await ApiClient.patch(
      ApiConstants.appointmentStatus(appointmentId),
      body: {'status': 'Rejected'},
    );
  }
}
