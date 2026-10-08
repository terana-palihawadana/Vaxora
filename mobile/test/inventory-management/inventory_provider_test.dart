import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/inventory/presentation/providers/inventory_provider.dart';

void main() {
  group('InventoryProvider — initial state', () {
    test('starts with no batches loaded', () {
      final provider = InventoryProvider();
      expect(provider.batches, isEmpty);
    });

    test('starts with empty formulary', () {
      final provider = InventoryProvider();
      expect(provider.formulary, isEmpty);
    });

    test('starts with null summary', () {
      final provider = InventoryProvider();
      expect(provider.summary, isNull);
    });

    test('starts not loading', () {
      final provider = InventoryProvider();
      expect(provider.isLoading, isFalse);
    });

    test('starts with no error message', () {
      final provider = InventoryProvider();
      expect(provider.errorMessage, isNull);
    });

    test('starts with empty search query', () {
      final provider = InventoryProvider();
      expect(provider.searchQuery, '');
    });

    test('starts with "all" status filter', () {
      final provider = InventoryProvider();
      expect(provider.statusFilter, 'all');
    });

    test('computed getters return zero when no data', () {
      final provider = InventoryProvider();
      expect(provider.totalVials, 0);
      expect(provider.lowStockCount, 0);
      expect(provider.expiringCount, 0);
    });
  });

  group('InventoryProvider — search and filter state', () {
    test('setSearchQuery updates the query and notifies listeners', () {
      final provider = InventoryProvider();
      var notified = 0;
      provider.addListener(() => notified++);

      provider.setSearchQuery('pfizer');

      expect(provider.searchQuery, 'pfizer');
      expect(notified, 1);
    });

    test('setSearchQuery can be cleared', () {
      final provider = InventoryProvider();
      provider.setSearchQuery('pfizer');
      provider.setSearchQuery('');
      expect(provider.searchQuery, '');
    });

    test('setStatusFilter to "low" updates state', () {
      final provider = InventoryProvider();
      provider.setStatusFilter('low');
      expect(provider.statusFilter, 'low');
    });

    test('setStatusFilter to "expiring" updates state', () {
      final provider = InventoryProvider();
      provider.setStatusFilter('expiring');
      expect(provider.statusFilter, 'expiring');
    });

    test('setStatusFilter to "sufficient" updates state', () {
      final provider = InventoryProvider();
      provider.setStatusFilter('sufficient');
      expect(provider.statusFilter, 'sufficient');
    });

    test('setStatusFilter notifies listeners', () {
      final provider = InventoryProvider();
      var notified = 0;
      provider.addListener(() => notified++);

      provider.setStatusFilter('low');

      expect(notified, 1);
    });

    test('multiple filter changes notify each time', () {
      final provider = InventoryProvider();
      var notified = 0;
      provider.addListener(() => notified++);

      provider.setSearchQuery('a');
      provider.setStatusFilter('low');
      provider.setSearchQuery('');

      expect(notified, 3);
    });
  });
}