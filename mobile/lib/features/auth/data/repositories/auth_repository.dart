import 'dart:io' show File;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../../../../core/services/storage_service.dart';
import '../models/selected_file.dart';
import '../models/user_model.dart';

class AuthRepository {
  static Future<http.MultipartFile> _createMultipartFile(
    String fieldName,
    SelectedFile file,
  ) async {
    if (kIsWeb || file.path == null) {
      final bytes = file.bytes ??
          (file.path != null ? await File(file.path!).readAsBytes() : <int>[]);
      return http.MultipartFile.fromBytes(fieldName, bytes, filename: file.name);
    }
    return await http.MultipartFile.fromPath(
      fieldName,
      file.path!,
      filename: file.name,
    );
  }

  /// Persist API user payload + normalized fields so photo URLs are not dropped.
  static Future<void> _persistUser(
    UserModel user, [
    Map<String, dynamic>? raw,
  ]) async {
    final merged = <String, dynamic>{...?raw, ...user.toJson()};

    // Never let a null model field wipe a photo URL that came from the API payload.
    final fromModel = user.profilePhotoUrl?.trim();
    final fromRawTop =
        raw?['profilePhotoUrl']?.toString().trim() ??
        raw?['ProfilePhotoUrl']?.toString().trim();
    String? fromDetails;
    final details = raw?['profileDetails'] ?? raw?['ProfileDetails'];
    if (details is Map) {
      fromDetails =
          details['profilePhotoUrl']?.toString().trim() ??
          details['ProfilePhotoUrl']?.toString().trim() ??
          details['logoUrl']?.toString().trim() ??
          details['LogoUrl']?.toString().trim();
    }

    final photo =
        [
          fromModel,
          fromRawTop,
          fromDetails,
          merged['profilePhotoUrl']?.toString().trim(),
        ].firstWhere(
          (v) => v != null && v.isNotEmpty && v.toLowerCase() != 'null',
          orElse: () => null,
        );

    if (photo != null) {
      merged['profilePhotoUrl'] = photo;
    } else {
      merged.remove('profilePhotoUrl');
    }

    await StorageService.saveUser(merged);
  }

  static Future<UserModel> login({
    required String email,
    required String password,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.login,
      body: {'email': email.trim(), 'password': password},
    );

    if (response is Map<String, dynamic>) {
      final token = response['token']?.toString();
      if (token != null && token.isNotEmpty) {
        await StorageService.saveToken(token);
      }

      if (response['user'] != null &&
          response['user'] is Map<String, dynamic>) {
        final userMap = Map<String, dynamic>.from(
          response['user'] as Map<String, dynamic>,
        );
        final user = UserModel.fromJson(userMap);
        await _persistUser(user, userMap);
        return user;
      }
    }

    throw ApiException(
      'Malformed response received from authentication server.',
    );
  }

  static Future<void> requestPasswordReset({required String email}) async {
    await ApiClient.post(
      ApiConstants.forgotPassword,
      body: {'email': email.trim()},
    );
  }

  static Future<void> resetPassword({
    required String email,
    required String resetToken,
    required String newPassword,
    required String confirmPassword,
  }) async {
    await ApiClient.post(
      ApiConstants.resetPassword,
      body: {
        'email': email.trim(),
        'resetToken': resetToken.trim(),
        'newPassword': newPassword,
        'confirmPassword': confirmPassword,
      },
    );
  }

  static Future<Map<String, dynamic>> registerPatient({
    required String email,
    required String password,
    required String fullName,
    required String nicNumber,
    required String dateOfBirth,
    String? phoneNumber,
    SelectedFile? profilePhoto,
  }) async {
    final fields = <String, String>{
      'Email': email.trim(),
      'Password': password,
      'FullName': fullName.trim(),
      'NicNumber': nicNumber.trim(),
      'DateOfBirth': dateOfBirth,
    };

    if (phoneNumber != null && phoneNumber.trim().isNotEmpty) {
      fields['PhoneNumber'] = phoneNumber.trim();
    }

    final files = <http.MultipartFile>[];
    if (profilePhoto != null && profilePhoto.hasContent) {
      files.add(await _createMultipartFile('ProfilePhoto', profilePhoto));
    }

    final response = await ApiClient.postMultipart(
      ApiConstants.signupPatient,
      fields: fields,
      files: files,
    );

    if (response is Map<String, dynamic>) {
      final token = response['token']?.toString();
      if (token != null && token.isNotEmpty) {
        await StorageService.saveToken(token);
      }
      if (response['user'] != null && response['user'] is Map<String, dynamic>) {
        final userMap = Map<String, dynamic>.from(response['user'] as Map<String, dynamic>);
        final user = UserModel.fromJson(userMap);
        await _persistUser(user, userMap);
      }
      return response;
    }

    return {'message': 'Patient registration submitted successfully.'};
  }

  static Future<Map<String, dynamic>> registerDoctor({
    required String email,
    required String password,
    required String fullName,
    required String slmcNumber,
    String? specialization,
    String? phoneNumber,
    SelectedFile? profilePhoto,
    SelectedFile? slmcCertificate,
    SelectedFile? supportingDocument,
  }) async {
    final fields = <String, String>{
      'Email': email.trim(),
      'Password': password,
      'FullName': fullName.trim(),
      'SlmcNumber': slmcNumber.trim(),
    };

    if (specialization != null && specialization.trim().isNotEmpty) {
      fields['Specialization'] = specialization.trim();
    }
    if (phoneNumber != null && phoneNumber.trim().isNotEmpty) {
      fields['PhoneNumber'] = phoneNumber.trim();
    }

    final files = <http.MultipartFile>[];
    if (profilePhoto != null && profilePhoto.hasContent) {
      files.add(await _createMultipartFile('ProfilePhoto', profilePhoto));
    }
    if (slmcCertificate != null && slmcCertificate.hasContent) {
      files.add(await _createMultipartFile('SlmcCertificate', slmcCertificate));
    }
    if (supportingDocument != null && supportingDocument.hasContent) {
      files.add(await _createMultipartFile('SupportingDocument', supportingDocument));
    }

    final response = await ApiClient.postMultipart(
      ApiConstants.signupDoctor,
      fields: fields,
      files: files,
    );

    if (response is Map<String, dynamic>) {
      return response;
    }

    return {'message': 'Doctor registration submitted successfully.'};
  }

  static Future<Map<String, dynamic>> registerNurse({
    required String email,
    required String password,
    required String fullName,
    required String slncNumber,
    String? phoneNumber,
    SelectedFile? profilePhoto,
    SelectedFile? slncCertificate,
    SelectedFile? supportingDocument,
  }) async {
    final fields = <String, String>{
      'Email': email.trim(),
      'Password': password,
      'FullName': fullName.trim(),
      'SlncNumber': slncNumber.trim(),
    };

    if (phoneNumber != null && phoneNumber.trim().isNotEmpty) {
      fields['PhoneNumber'] = phoneNumber.trim();
    }

    final files = <http.MultipartFile>[];
    if (profilePhoto != null && profilePhoto.hasContent) {
      files.add(await _createMultipartFile('ProfilePhoto', profilePhoto));
    }
    if (slncCertificate != null && slncCertificate.hasContent) {
      files.add(await _createMultipartFile('SlncCertificate', slncCertificate));
    }
    if (supportingDocument != null && supportingDocument.hasContent) {
      files.add(await _createMultipartFile('SupportingDocument', supportingDocument));
    }

    final response = await ApiClient.postMultipart(
      ApiConstants.signupNurse,
      fields: fields,
      files: files,
    );

    if (response is Map<String, dynamic>) {
      return response;
    }

    return {'message': 'Nurse registration submitted successfully.'};
  }

  static Future<Map<String, dynamic>> registerHospital({
    required String email,
    required String password,
    required String hospitalName,
    required String registrationNumber,
    String? hospitalType,
    String? operatingHours,
    String? address,
    String? district,
    String? province,
    String? contactNumber,
    SelectedFile? logo,
    SelectedFile? registrationCertificate,
    SelectedFile? mohDocument,
  }) async {
    final fields = <String, String>{
      'Email': email.trim(),
      'Password': password,
      'HospitalName': hospitalName.trim(),
      'RegistrationNumber': registrationNumber.trim(),
    };

    if (hospitalType != null && hospitalType.trim().isNotEmpty) {
      fields['HospitalType'] = hospitalType.trim();
    }
    if (operatingHours != null && operatingHours.trim().isNotEmpty) {
      fields['OperatingHours'] = operatingHours.trim();
    }
    if (address != null && address.trim().isNotEmpty) {
      fields['Address'] = address.trim();
    }
    if (district != null && district.trim().isNotEmpty) {
      fields['District'] = district.trim();
    }
    if (province != null && province.trim().isNotEmpty) {
      fields['Province'] = province.trim();
    }
    if (contactNumber != null && contactNumber.trim().isNotEmpty) {
      fields['ContactNumber'] = contactNumber.trim();
    }

    final files = <http.MultipartFile>[];
    if (logo != null && logo.hasContent) {
      files.add(await _createMultipartFile('Logo', logo));
    }
    if (registrationCertificate != null && registrationCertificate.hasContent) {
      files.add(await _createMultipartFile('RegistrationCertificate', registrationCertificate));
    }
    if (mohDocument != null && mohDocument.hasContent) {
      files.add(await _createMultipartFile('MohDocument', mohDocument));
    }

    final response = await ApiClient.postMultipart(
      ApiConstants.signupHospital,
      fields: fields,
      files: files,
    );

    if (response is Map<String, dynamic>) {
      return response;
    }

    return {'message': 'Hospital registration submitted successfully.'};
  }

  static Future<UserModel?> getCurrentUser({bool forceRefresh = false}) async {
    if (!forceRefresh) {
      final cached = await StorageService.getUser();
      if (cached != null) {
        return UserModel.fromJson(cached);
      }
    }

    try {
      final response = await ApiClient.get(ApiConstants.currentUser);
      if (response is Map<String, dynamic>) {
        final raw = Map<String, dynamic>.from(response);
        final user = UserModel.fromJson(raw);
        await _persistUser(user, raw);
        return user;
      }
    } catch (_) {
      if (!forceRefresh) return null;
      final cached = await StorageService.getUser();
      if (cached != null) return UserModel.fromJson(cached);
      rethrow;
    }

    return null;
  }

  static Future<UserModel> updateProfile({
    String? fullName,
    String? phoneNumber,
    DateTime? dateOfBirth,
    String? specialization,
    String? hospitalName,
    String? hospitalType,
    String? operatingHours,
    String? address,
    String? district,
    String? province,
  }) async {
    final body = <String, dynamic>{};
    if (fullName != null) body['fullName'] = fullName.trim();
    if (phoneNumber != null) body['phoneNumber'] = phoneNumber.trim();
    if (dateOfBirth != null) {
      body['dateOfBirth'] = dateOfBirth.toIso8601String();
    }
    if (specialization != null) body['specialization'] = specialization.trim();
    if (hospitalName != null) body['hospitalName'] = hospitalName.trim();
    if (hospitalType != null) body['hospitalType'] = hospitalType.trim();
    if (operatingHours != null) body['operatingHours'] = operatingHours.trim();
    if (address != null) body['address'] = address.trim();
    if (district != null) body['district'] = district.trim();
    if (province != null) body['province'] = province.trim();

    final response = await ApiClient.put(
      ApiConstants.updateProfile,
      body: body,
    );

    // Preferred path: the PUT response carries the full user DTO (with
    // profileDetails). Parse it directly and cache via the standard helper.
    if (response is Map<String, dynamic> &&
        response.containsKey('profileDetails')) {
      final raw = Map<String, dynamic>.from(response);
      final user = UserModel.fromJson(raw);
      await _persistUser(user, raw);
      return user;
    }

    // Fallback 1: re-fetch /auth/me. This guarantees we get the full user
    // shape even if PUT returned a partial payload — without it, we can
    // accidentally wipe patientProfileId / nicNumber / registrationNumber.
    try {
      final fresh = await ApiClient.get(ApiConstants.currentUser);
      if (fresh is Map<String, dynamic>) {
        final raw = Map<String, dynamic>.from(fresh);
        final user = UserModel.fromJson(raw);
        await _persistUser(user, raw);
        return user;
      }
    } catch (_) {
      // Fall through to cache merge
    }

    // Fallback 2: merge the new values into the cached user.
    final cached = await StorageService.getUser();
    if (cached != null) {
      final merged = Map<String, dynamic>.from(cached);
      if (fullName != null) merged['name'] = fullName.trim();
      if (phoneNumber != null) merged['phoneNumber'] = phoneNumber.trim();
      if (dateOfBirth != null) {
        merged['dateOfBirth'] = dateOfBirth.toIso8601String();
      }
      if (specialization != null) merged['specialization'] = specialization.trim();
      if (hospitalName != null) merged['name'] = hospitalName.trim();
      final details = Map<String, dynamic>.from(
        (merged['profileDetails'] as Map?)?.cast<String, dynamic>() ?? const {},
      );
      if (specialization != null) details['specialization'] = specialization.trim();
      if (hospitalName != null) details['hospitalName'] = hospitalName.trim();
      if (phoneNumber != null && hospitalName != null) {
        details['contactNumber'] = phoneNumber.trim();
      }
      if (hospitalType != null) details['hospitalType'] = hospitalType.trim();
      if (operatingHours != null) details['operatingHours'] = operatingHours.trim();
      if (address != null) details['address'] = address.trim();
      if (district != null) details['district'] = district.trim();
      if (province != null) details['province'] = province.trim();
      if (details.isNotEmpty) merged['profileDetails'] = details;
      await StorageService.saveUser(merged);
      return UserModel.fromJson(merged);
    }

    throw ApiException('Profile updated but could not refresh user data.');
  }

  static Future<UserModel> updateProfilePhoto(XFile photo) async {
    final response = await ApiClient.postMultipartFile(
      ApiConstants.updateProfilePhoto,
      fieldName: 'photo',
      bytes: await photo.readAsBytes(),
      filename: photo.name,
    );

    if (response is Map<String, dynamic>) {
      final raw = Map<String, dynamic>.from(response);
      final user = UserModel.fromJson(raw);
      await _persistUser(user, raw);
      return user;
    }

    throw ApiException('Profile photo uploaded but the response was invalid.');
  }

  static Future<void> logout() async {
    await StorageService.clearAuth();
  }

  static Future<void> deleteAccount() async {
    await ApiClient.delete(ApiConstants.deleteAccount);
    await StorageService.clearAuth();
  }
}
