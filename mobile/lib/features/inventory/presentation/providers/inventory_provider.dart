import 'package:flutter/foundation.dart';
import '../../data/models/batch_model.dart';
import '../../data/models/formulary_entry_model.dart';
import '../../data/models/inventory_summary_model.dart';
import '../../data/repositories/inventory_repository.dart';

class InventoryProvider extends ChangeNotifier {
  List<BatchModel> _batches = [];
  List<FormularyEntryModel> _formulary = [];
  InventorySummaryModel? _summary;
  bool _isLoading = false;
  String? _errorMessage;
  String _searchQuery = '';
  String _statusFilter = 'all'; // all | low | expiring | sufficient

  List<BatchModel> get batches => _filteredBatches;
  List<FormularyEntryModel> get formulary => _formulary;
  InventorySummaryModel? get summary => _summary;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String get searchQuery => _searchQuery;
  String get statusFilter => _statusFilter;

  int get totalVials => _batches.fold(0, (sum, b) => sum + b.available);
  int get lowStockCount => _batches.where((b) => b.isLowStock).length;
  int get expiringCount => _batches.where((b) => b.isExpiringSoon).length;

  List<BatchModel> get _filteredBatches {
    return _batches.where((b) {
      final q = _searchQuery.toLowerCase();
      final matchesSearch = q.isEmpty ||
          b.name.toLowerCase().contains(q) ||
          b.lotNumber.toLowerCase().contains(q) ||
          b.manufacturer.toLowerCase().contains(q);

      if (!matchesSearch) return false;

      switch (_statusFilter) {
        case 'low':
          return b.isLowStock;
        case 'expiring':
          return b.isExpiringSoon;
        case 'sufficient':
          return !b.isLowStock;
        default:
          return true;
      }
    }).toList();
  }

  void setSearchQuery(String q) {
    _searchQuery = q;
    notifyListeners();
  }

  void setStatusFilter(String filter) {
    _statusFilter = filter;
    notifyListeners();
  }

  Future<void> loadAll() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final results = await Future.wait([
        InventoryRepository.getBatches(),
        InventoryRepository.getSummary(),
        InventoryRepository.getFormulary(),
      ]);
      _batches = results[0] as List<BatchModel>;
      _summary = results[1] as InventorySummaryModel?;
      _formulary = results[2] as List<FormularyEntryModel>;
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> loadFormulary() async {
    try {
      _formulary = await InventoryRepository.getFormulary();
      notifyListeners();
    } catch (_) {}
  }

  Future<bool> registerVaccine(String name, String manufacturer) async {
    try {
      _errorMessage = null;
      await InventoryRepository.registerFormulary(
        vaccineName: name,
        manufacturer: manufacturer,
      );
      await loadFormulary();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> removeVaccine(String id) async {
    try {
      _errorMessage = null;
      await InventoryRepository.removeFormulary(id);
      await loadFormulary();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> restockBatch({
    required String vaccineName,
    required String lotNumber,
    required int quantity,
    required String storageUnit,
    required String expiryDate,
    required String supplier,
  }) async {
    try {
      _errorMessage = null;
      final existing = _batches.where(
        (b) => b.name.toLowerCase() == vaccineName.toLowerCase(),
      );
      await InventoryRepository.restockBatch(
        category: existing.isEmpty ? null : existing.first.category,
        vaccineName: vaccineName,
        lotNumber: lotNumber,
        quantity: quantity,
        storageUnit: storageUnit,
        expiryDate: expiryDate,
        supplier: supplier,
      );
      await loadAll();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> refresh() => loadAll();
}