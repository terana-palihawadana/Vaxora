class BatchModel {
  final String id;
  final String vaccineId;
  final String name;
  final String manufacturer;
  final String category;
  final String lotNumber;
  final int available;
  final int capacity;
  final int minThreshold;
  final int dosesPerVial;
  final int openVialDosesRemaining;
  final int availableDoses;
  final String expiry;
  final String expiryStatus; // 'healthy' | 'expiring_soon' | 'expired'
  final String temp;
  final String storageUnit;
  final String statusColor; // 'bar-green' | 'bar-orange' | 'bar-red' | 'bar-blue'
  final String lastRestocked;
  // Vaccine-level flag from the API: all unexpired lots together are at or
  // below the threshold. Null when the API did not send it.
  final bool? lowStock;
  // 'ordered' marks a purchase order awaiting delivery: no usable stock yet.
  final String status;

  const BatchModel({
    required this.id,
    required this.vaccineId,
    required this.name,
    required this.manufacturer,
    required this.category,
    required this.lotNumber,
    required this.available,
    required this.capacity,
    required this.minThreshold,
    required this.dosesPerVial,
    this.openVialDosesRemaining = 0,
    this.availableDoses = 0,
    required this.expiry,
    required this.expiryStatus,
    required this.temp,
    required this.storageUnit,
    required this.statusColor,
    required this.lastRestocked,
    this.lowStock,
    this.status = 'active',
  });

  bool get isOnOrder => status == 'ordered';
  bool get isLowStock => lowStock ?? available <= minThreshold;
  bool get isExpiringSoon => expiryStatus == 'expiring_soon';
  bool get isExpired => expiryStatus == 'expired';
  double get stockPercent => capacity > 0 ? (available / capacity) : 0.0;

  int get usableDoses {
    if (availableDoses > 0) return availableDoses;
    final sealed = available * (dosesPerVial <= 0 ? 1 : dosesPerVial);
    return sealed + (openVialDosesRemaining < 0 ? 0 : openVialDosesRemaining);
  }

  factory BatchModel.fromJson(Map<String, dynamic> json) {
    final available = (json['available'] as num?)?.toInt() ?? 0;
    final dosesPerVial = (json['dosesPerVial'] as num?)?.toInt() ?? 1;
    final open = (json['openVialDosesRemaining'] as num?)?.toInt() ?? 0;
    final availableDoses = (json['availableDoses'] as num?)?.toInt() ??
        (available * (dosesPerVial <= 0 ? 1 : dosesPerVial) +
            (open < 0 ? 0 : open));
    return BatchModel(
      id: json['id']?.toString() ?? '',
      vaccineId: json['vaccineId']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Vaccine',
      manufacturer: json['manufacturer']?.toString() ?? '',
      category: json['category']?.toString() ?? 'routine',
      lotNumber: json['lotNumber']?.toString() ?? '',
      available: available,
      capacity: (json['capacity'] as num?)?.toInt() ?? 0,
      minThreshold: (json['minThreshold'] as num?)?.toInt() ?? 0,
      dosesPerVial: dosesPerVial,
      openVialDosesRemaining: open,
      availableDoses: availableDoses,
      expiry: json['expiry']?.toString() ?? '',
      expiryStatus: json['expiryStatus']?.toString() ?? 'healthy',
      temp: json['temp']?.toString() ?? '',
      storageUnit: json['storageUnit']?.toString() ?? '',
      statusColor: json['statusColor']?.toString() ?? 'bar-green',
      lastRestocked: json['lastRestocked']?.toString() ?? '',
      lowStock: json['isLowStock'] as bool?,
      status: json['status']?.toString() ?? 'active',
    );
  }
}
