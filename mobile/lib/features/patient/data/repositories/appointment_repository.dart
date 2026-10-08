import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../models/appointment_model.dart';

class AppointmentRepository {
  static Future<List<AppointmentModel>> getMyAppointments() async {
    final response = await ApiClient.get(ApiConstants.myAppointments);
    if (response is! List) {
      throw ApiException('Failed to parse appointments from server response.');
    }

    return response.map((item) {
      if (item is! Map<String, dynamic>) {
        throw ApiException('Failed to parse an appointment from server response.');
      }
      return AppointmentModel.fromJson(item);
    }).toList();
  }

  static Future<AppointmentModel> bookAppointment({
    required String hospitalUserId,
    required String vaccineName,
    required String appointmentDate,
    required String timeSlot,
    String? doseNumber,
    String? notes,
    String paymentMethod = 'Free',
  }) async {
    final response = await ApiClient.post(
      ApiConstants.bookAppointment,
      body: {
        'hospitalUserId': hospitalUserId,
        'vaccineName': vaccineName,
        'appointmentDate': appointmentDate,
        'timeSlot': timeSlot,
        'doseNumber': doseNumber ?? 'Dose 1',
        'notes': notes ?? '',
        'paymentMethod': paymentMethod,
      },
    );

    if (response is Map<String, dynamic>) {
      return AppointmentModel.fromJson(response);
    }

    throw ApiException('Failed to parse booked appointment from server response.');
  }

  static Future<void> cancelAppointment(String appointmentId) async {
    await ApiClient.delete('/appointments/$appointmentId/cancel');
  }
}
