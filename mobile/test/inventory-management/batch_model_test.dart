import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/inventory/data/models/batch_model.dart';

void main() {
  group('BatchModel.fromJson', () {
    test('parses required fields from JSON', () {
      final json = {
        'id': 'batch-1',
        'vaccineId': 'vac-1',
        'name': 'Pfizer',
        'manufacturer': 'BioNTech',
        'category': 'covid',
        'lotNumber': 'LOT-2026-001',
        'available': 100,
        'capacity': 200,
        'minThreshold': 50,
        'dosesPerVial': 6,
        'openVialDosesRemaining': 3,
        'availableDoses': 603,
        'expiry': '2027-01-15',
        'expiryStatus': 'healthy',
        'temp': '2-8C',
        'storageUnit': 'Vault A',
        'statusColor': 'bar-green',
        'lastRestocked': '2026-10-01',
      };

      final batch = BatchModel.fromJson(json);

      expect(batch.id, 'batch-1');
      expect(batch.name, 'Pfizer');
      expect(batch.lotNumber, 'LOT-2026-001');
      expect(batch.available, 100);
      expect(batch.minThreshold, 50);
      expect(batch.dosesPerVial, 6);
      expect(batch.openVialDosesRemaining, 3);
      expect(batch.expiryStatus, 'healthy');
    });

    test('uses safe defaults when optional fields are missing', () {
      final json = {
        'id': 'batch-2',
        'lotNumber': 'LOT-2',
      };

      final batch = BatchModel.fromJson(json);

      expect(batch.name, 'Vaccine');
      expect(batch.category, 'routine');
      expect(batch.available, 0);
      expect(batch.minThreshold, 0);
      expect(batch.dosesPerVial, 1);
      expect(batch.expiryStatus, 'healthy');
      expect(batch.statusColor, 'bar-green');
    });

    test('computes availableDoses when not provided', () {
      final json = {
        'id': 'batch-3',
        'lotNumber': 'LOT-3',
        'available': 10,
        'dosesPerVial': 5,
        'openVialDosesRemaining': 2,
      };

      final batch = BatchModel.fromJson(json);

      // 10 vials * 5 doses + 2 open = 52
      expect(batch.availableDoses, 52);
    });
  });

  group('BatchModel business rules', () {
    BatchModel makeBatch({
      int available = 100,
      int minThreshold = 50,
      int capacity = 200,
      String expiryStatus = 'healthy',
    }) =>
        BatchModel(
          id: 'b1',
          vaccineId: 'v1',
          name: 'Pfizer',
          manufacturer: 'BioNTech',
          category: 'covid',
          lotNumber: 'LOT-1',
          available: available,
          capacity: capacity,
          minThreshold: minThreshold,
          dosesPerVial: 6,
          expiry: '2027-01-15',
          expiryStatus: expiryStatus,
          temp: '2-8C',
          storageUnit: 'Vault A',
          statusColor: 'bar-green',
          lastRestocked: '2026-10-01',
        );

    test('isLowStock is true when available is at or below threshold', () {
      expect(makeBatch(available: 40, minThreshold: 50).isLowStock, isTrue);
      expect(makeBatch(available: 50, minThreshold: 50).isLowStock, isTrue);
    });

    test('isLowStock is false when available is above threshold', () {
      expect(makeBatch(available: 200, minThreshold: 50).isLowStock, isFalse);
    });

    test('isExpiringSoon is true only for expiring_soon status', () {
      expect(makeBatch(expiryStatus: 'expiring_soon').isExpiringSoon, isTrue);
      expect(makeBatch(expiryStatus: 'healthy').isExpiringSoon, isFalse);
    });

    test('isExpired is true only for expired status', () {
      expect(makeBatch(expiryStatus: 'expired').isExpired, isTrue);
      expect(makeBatch(expiryStatus: 'healthy').isExpired, isFalse);
    });

    test('stockPercent is available divided by capacity', () {
      final batch = makeBatch(available: 50, capacity: 200);
      expect(batch.stockPercent, 0.25);
    });

    test('stockPercent is zero when capacity is zero', () {
      final batch = makeBatch(available: 10, capacity: 0);
      expect(batch.stockPercent, 0.0);
    });
  });
}