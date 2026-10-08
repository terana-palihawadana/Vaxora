import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../models/batch_model.dart';
import '../models/inventory_summary_model.dart';
import '../models/audit_entry_model.dart';
import '../models/formulary_entry_model.dart';

class InventoryRepository {
  // ============ LIST ============
  static Future<List<BatchModel>> getBatches({String? hospitalUserId}) async {
    try {
      final query = <String, String>{};
      if (hospitalUserId != null && hospitalUserId.trim().isNotEmpty) {
        query['hospitalUserId'] = hospitalUserId.trim();
      }
      final response = await ApiClient.get(
        ApiConstants.inventoryBatches,
        queryParams: query.isEmpty ? null : query,
      );
      if (response is List) {
        return response
            .map((e) => BatchModel.fromJson(e as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {
      rethrow;
    }
    return [];
  }

  static Future<List<BatchModel>> getExpiringBatches({int days = 60}) async {
    try {
      final response = await ApiClient.get(
        ApiConstants.inventoryExpiring,
        queryParams: {'daysThreshold': days.toString()},
      );
      if (response is List) {
        return response
            .map((e) => BatchModel.fromJson(e as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {
      rethrow;
    }
    return [];
  }

  // ============ SUMMARY ============
  static Future<InventorySummaryModel?> getSummary() async {
    try {
      final response = await ApiClient.get(ApiConstants.inventorySummary);
      if (response is Map<String, dynamic>) {
        return InventorySummaryModel.fromJson(response);
      }
    } catch (_) {
      rethrow;
    }
    return null;
  }

  // ============ FORMULARY ============
  static Future<List<FormularyEntryModel>> getFormulary() async {
    try {
      final response = await ApiClient.get(ApiConstants.inventoryFormulary);
      if (response is List) {
        return response
            .map((e) => FormularyEntryModel.fromJson(e as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {
      rethrow;
    }
    return [];
  }

  static Future<FormularyEntryModel?> registerFormulary({
    required String vaccineName,
    String? manufacturer,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.inventoryFormulary,
      body: {
        'vaccineName': vaccineName,
        'manufacturer': manufacturer ?? '',
      },
    );
    if (response is Map<String, dynamic>) {
      return FormularyEntryModel.fromJson(response);
    }
    throw ApiException('Failed to register vaccine.');
  }

  static Future<void> removeFormulary(String id) async {
    await ApiClient.delete(ApiConstants.formularyEntry(id));
  }

  // ============ RESTOCK ============
  static Future<Map<String, dynamic>> restockBatch({
    required String vaccineName,
    required String lotNumber,
    required int quantity,
    required String storageUnit,
    required String expiryDate,
    required String supplier,
    String? category,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.inventoryRestock,
      body: {
        if (category != null && category.isNotEmpty) 'category': category,
        'vaccineName': vaccineName,
        'lotNumber': lotNumber,
        'quantity': quantity,
        'storageUnit': storageUnit,
        'expiryDate': expiryDate,
        'supplier': supplier,
      },
    );
    if (response is Map<String, dynamic>) return response;
    throw ApiException('Failed to log restock.');
  }

  // ============ BUSINESS OPERATIONS ============
  static Future<Map<String, dynamic>> issueStock({
    required String batchId,
    required int quantity,
    required String sessionReference,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.batchIssue(batchId),
      body: {
        'quantity': quantity,
        'sessionReference': sessionReference,
      },
    );
    if (response is Map<String, dynamic>) return response;
    throw ApiException('Failed to issue stock.');
  }

  static Future<Map<String, dynamic>> logWastage({
    required String batchId,
    required int quantity,
    required String reason,
    required String reportedBy,
    String? notes,
    String? incidentDate,
  }) async {
    final response = await ApiClient.post(
      ApiConstants.batchWastage(batchId),
      body: {
        'quantity': quantity,
        'reason': reason,
        'reportedBy': reportedBy,
        'notes': notes ?? '',
        'incidentDate': incidentDate,
      },
    );
    if (response is Map<String, dynamic>) return response;
    throw ApiException('Failed to log wastage.');
  }

  // ============ AUDIT ============
  static Future<BatchAuditModel?> getBatchAudit(String batchId) async {
    try {
      final response = await ApiClient.get(ApiConstants.batchAudit(batchId));
      if (response is Map<String, dynamic>) {
        return BatchAuditModel.fromJson(response);
      }
    } catch (_) {}
    return null;
  }
}