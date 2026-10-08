import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../models/payhere_init_model.dart';

class PaymentRepository {
  /// Calls POST /api/payment/payhere-init to generate security MD5 hash, Order ID, and checkout params
  static Future<PayHereInitModel> initPayHere(String appointmentId) async {
    final response = await ApiClient.post(
      ApiConstants.payHereInit,
      body: {'appointmentId': appointmentId},
    );

    if (response is Map<String, dynamic>) {
      return PayHereInitModel.fromJson(response);
    }
    throw ApiException('Failed to initialize PayHere checkout.');
  }

  /// Checks whether the server has confirmed payment through PayHere's IPN.
  static Future<Map<String, dynamic>> confirmPayment({
    required String appointmentId,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.confirmPayment,
      body: {'appointmentId': appointmentId},
    );

    if (response is Map<String, dynamic>) {
      return response;
    }
    throw ApiException('Failed to confirm PayHere payment.');
  }
}
