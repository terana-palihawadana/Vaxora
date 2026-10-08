import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/batch_model.dart';
import '../../data/repositories/inventory_repository.dart';
import 'batch_detail_screen.dart';

class QrScannerScreen extends StatefulWidget {
  /// When set, the scanner resolves against these lots and pops the matched
  /// [BatchModel] instead of opening the batch detail screen.
  final List<BatchModel>? pickFromLots;

  const QrScannerScreen({super.key, this.pickFromLots});

  @override
  State<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends State<QrScannerScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode, BarcodeFormat.code128],
  );

  bool _isProcessing = false;
  String? _errorMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_isProcessing) return;

    final codes = capture.barcodes;
    if (codes.isEmpty) return;

    final rawValue = codes.first.rawValue;
    if (rawValue == null || rawValue.isEmpty) return;

    setState(() {
      _isProcessing = true;
      _errorMessage = null;
    });

    await _controller.stop();

    try {
      final batches =
          widget.pickFromLots ?? await InventoryRepository.getBatches();

      BatchModel? match;
      for (final b in batches) {
        if (b.id == rawValue || b.lotNumber == rawValue) {
          match = b;
          break;
        }
      }

      if (match != null) {
        if (!mounted) return;
        if (widget.pickFromLots != null) {
          Navigator.of(context).pop(match);
          return;
        }
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => BatchDetailScreen(batch: match!)),
        );
      } else {
        if (!mounted) return;
        setState(() {
          _errorMessage = widget.pickFromLots != null
              ? 'Scanned lot "$rawValue" is not usable stock for this vaccine.'
              : 'No batch found matching: "$rawValue"';
          _isProcessing = false;
        });
        await _controller.start();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Lookup failed: $e';
        _isProcessing = false;
      });
      await _controller.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: StaffSurfaces.appBar(title: 'Scan batch QR'),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          _buildOverlay(),
          if (_errorMessage != null) _buildErrorBanner(),
          if (_isProcessing) _buildLoadingOverlay(),
        ],
      ),
    );
  }

  Widget _buildOverlay() {
    return Positioned.fill(
      child: Stack(
        children: [
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 3),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          Positioned(
            bottom: 80,
            left: 24,
            right: 24,
            child: Column(
              children: [
                const Icon(Icons.qr_code_scanner, color: Colors.white, size: 40),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Text(
                    'Point camera at the batch QR code',
                    style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorBanner() {
    return Positioned(
      top: 16,
      left: 16,
      right: 16,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.errorBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.error, width: 1.5),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: AppColors.error),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _errorMessage!,
                style: const TextStyle(color: AppColors.error, fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close, color: AppColors.error, size: 20),
              onPressed: () => setState(() => _errorMessage = null),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadingOverlay() {
    return Positioned.fill(
      child: Container(
        color: Colors.black.withValues(alpha: 0.7),
        child: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(color: Colors.white),
              SizedBox(height: 16),
              Text(
                'Looking up batch…',
                style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    );
  }
}