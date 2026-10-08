import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/inventory/data/models/batch_model.dart';
import 'package:mobile/features/inventory/presentation/widgets/batch_card.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  BatchModel makeBatch({
    String name = 'Pfizer',
    String lotNumber = 'LOT-001',
    int available = 100,
    int capacity = 200,
    int minThreshold = 50,
    String expiry = '2027-01-15',
    String expiryStatus = 'healthy',
  }) =>
      BatchModel(
        id: 'b1',
        vaccineId: 'v1',
        name: name,
        manufacturer: 'BioNTech',
        category: 'mrna',
        lotNumber: lotNumber,
        available: available,
        capacity: capacity,
        minThreshold: minThreshold,
        dosesPerVial: 6,
        expiry: expiry,
        expiryStatus: expiryStatus,
        temp: '2-8C',
        storageUnit: 'Vault',
        statusColor: 'bar-green',
        lastRestocked: '2026-10-01',
      );

  testWidgets('renders the vaccine name', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(name: 'Moderna Spikevax'),
      onTap: () {},
    )));
    expect(find.text('Moderna Spikevax'), findsOneWidget);
  });

  testWidgets('renders lot number and expiry', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(lotNumber: 'LOT-2026-X', expiry: '2027-06-30'),
      onTap: () {},
    )));
    expect(
      find.textContaining('LOT-2026-X'),
      findsOneWidget,
    );
    expect(
      find.textContaining('2027-06-30'),
      findsOneWidget,
    );
  });

  testWidgets('renders available and capacity vials', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(available: 42, capacity: 100),
      onTap: () {},
    )));
    expect(find.text('42 / 100 vials'), findsOneWidget);
  });

  testWidgets('shows Healthy chip when batch is healthy', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(available: 200, minThreshold: 50, expiryStatus: 'healthy'),
      onTap: () {},
    )));
    expect(find.text('Healthy'), findsOneWidget);
    expect(find.text('Low stock'), findsNothing);
    expect(find.text('Expired'), findsNothing);
  });

  testWidgets('shows Low stock chip when available is at or below threshold', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(available: 50, minThreshold: 50),
      onTap: () {},
    )));
    expect(find.text('Low stock'), findsOneWidget);
    expect(find.text('Healthy'), findsNothing);
  });

  testWidgets('shows Expired chip when batch is expired', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(expiryStatus: 'expired'),
      onTap: () {},
    )));
    expect(find.text('Expired'), findsOneWidget);
  });

  testWidgets('shows Expiring chip when expiry is soon', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(expiryStatus: 'expiring_soon'),
      onTap: () {},
    )));
    expect(find.text('Expiring'), findsOneWidget);
  });

  testWidgets('tap invokes the onTap callback', (tester) async {
    var tapped = false;
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(),
      onTap: () => tapped = true,
    )));
    await tester.tap(find.byType(InkWell));
    await tester.pump();
    expect(tapped, isTrue);
  });

  testWidgets('renders a LinearProgressIndicator for stock level', (tester) async {
    await tester.pumpWidget(wrap(BatchCard(
      batch: makeBatch(available: 100, capacity: 200),
      onTap: () {},
    )));
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
  });
}