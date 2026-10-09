import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../models/hospital_schedule_model.dart';

class HospitalScheduleRepository {
  HospitalScheduleRepository._();

  static Future<List<HospitalScheduleModel>> list() async {
    final response = await ApiClient.get(ApiConstants.hospitalSchedules);
    if (response is! List) return [];
    return response
        .map((e) => HospitalScheduleModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<void> create({
    required String boothId,
    required String vaccineName,
    String? vaccineId,
    required String scheduleType,
    String? specificDate,
    List<String> daysOfWeek = const [],
    String? startDate,
    String? endDate,
    required String startTime,
    required String endTime,
    required double price,
  }) async {
    final body = <String, dynamic>{
      'boothId': boothId,
      'vaccineName': vaccineName,
      if (vaccineId != null && vaccineId.isNotEmpty) 'vaccineId': vaccineId,
      'scheduleType': scheduleType,
      'startTime': startTime,
      'endTime': endTime,
      'price': price,
    };
    if (scheduleType.toLowerCase() == 'weekly') {
      body['daysOfWeek'] = daysOfWeek;
      body['startDate'] = startDate;
      body['endDate'] = endDate;
      body['specificDate'] = null;
    } else {
      body['specificDate'] = specificDate;
      body['daysOfWeek'] = <String>[];
      body['startDate'] = null;
      body['endDate'] = null;
    }
    await ApiClient.post(ApiConstants.createSchedule, body: body);
  }

  static Future<void> cancel(String scheduleId) async {
    await ApiClient.delete(ApiConstants.cancelSchedule(scheduleId));
  }
}
