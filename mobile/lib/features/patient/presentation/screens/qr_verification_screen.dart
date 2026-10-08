import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/vaccination_record_model.dart';
import '../../data/repositories/patient_repository.dart';
import '../../../../core/theme/app_colors.dart';

/// QR certificate verification.
///
/// Three input paths:
///   1. Live camera scan (mobile_scanner)
///   2. Gallery image pick → mobile_scanner.analyzeImage
///   3. Manual UUID entry
///
/// The QR payload may be a raw UUID, a JSON blob with `patientProfileId`,
/// or a URL containing `?pid=` — all three are handled.
class QrVerificationScreen extends StatefulWidget {
  const QrVerificationScreen({super.key});

  @override
  State<QrVerificationScreen> createState() => _QrVerificationScreenState();
}

enum _Phase { scanning, looking, verified, failed }

class _QrVerificationScreenState extends State<QrVerificationScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );
  final TextEditingController _manualController = TextEditingController();

  _Phase _phase = _Phase.scanning;
  String? _statusMessage;
  String? _scannedRaw;
  PatientVaccinationTimelineModel? _timeline;

  @override
  void dispose() {
    _controller.dispose();
    _manualController.dispose();
    super.dispose();
  }

  // ---------------- QR payload parsing ----------------

  String? _extractProfileId(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;

    // Try JSON
    try {
      final decoded = jsonDecode(text);
      if (decoded is Map<String, dynamic>) {
        for (final key in [
          'patientProfileId',
          'patient_profile_id',
          'patientId',
          'patient_id',
          'pid',
          'id',
        ]) {
          final v = decoded[key];
          if (v is String && _looksLikeUuid(v)) return v;
        }
      }
    } catch (_) {
      // Not JSON
    }

    // Try URL query param
    final uri = Uri.tryParse(text);
    if (uri != null && uri.hasQuery) {
      for (final key in ['pid', 'patientProfileId', 'id']) {
        final v = uri.queryParameters[key];
        if (v != null && _looksLikeUuid(v)) return v;
      }
    }

    // Try raw UUID
    if (_looksLikeUuid(text)) return text;

    return null;
  }

  bool _looksLikeUuid(String s) {
    final re = RegExp(
      r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    );
    return re.hasMatch(s.trim());
  }

  // ---------------- Verification flow ----------------

  Future<void> _verify(String rawPayload) async {
    setState(() {
      _scannedRaw = rawPayload;
      _phase = _Phase.looking;
      _statusMessage = 'Verifying certificate…';
    });

    final profileId = _extractProfileId(rawPayload);
    if (profileId == null) {
      if (mounted) {
        setState(() {
          _phase = _Phase.failed;
          _statusMessage =
              'Could not read a patient ID from this QR code.\n'
              'Scanned: ${rawPayload.length > 80 ? '${rawPayload.substring(0, 80)}…' : rawPayload}';
        });
      }
      return;
    }

    try {
      final timeline = await PatientRepository.getVaccinationTimeline(
        profileId,
      );
      if (!mounted) return;
      if (timeline == null) {
        setState(() {
          _phase = _Phase.failed;
          _statusMessage = 'No records found for this patient ID.';
        });
        return;
      }
      setState(() {
        _timeline = timeline;
        _phase = _Phase.verified;
        _statusMessage = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failed;
        _statusMessage = 'Verification failed: $e';
      });
    }
  }

  Future<void> _onBarcodeDetected(BarcodeCapture capture) async {
    if (_phase != _Phase.scanning) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;
    await _verify(raw);
  }

  Future<void> _pickFromGallery() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery);
    if (file == null) return;

    setState(() {
      _phase = _Phase.looking;
      _statusMessage = 'Reading QR from image…';
    });

    try {
      final capture = await _controller.analyzeImage(file.path);
      final raw = capture?.barcodes.firstOrNull?.rawValue;
      if (raw == null || raw.isEmpty) {
        if (mounted) {
          setState(() {
            _phase = _Phase.scanning;
            _statusMessage = 'No QR code found in that image. Try another.';
          });
        }
        return;
      }
      await _verify(raw);
    } catch (e) {
      if (mounted) {
        setState(() {
          _phase = _Phase.scanning;
          _statusMessage = 'Could not read image: $e';
        });
      }
    }
  }

  Future<void> _manualEntry() async {
    final id = _manualController.text.trim();
    if (id.isEmpty) return;
    await _verify(id);
  }

  void _reset() {
    _manualController.clear();
    setState(() {
      _phase = _Phase.scanning;
      _statusMessage = null;
      _scannedRaw = null;
      _timeline = null;
    });
  }

  // ---------------- UI ----------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffSurfaces.appBar(
        title: 'Verify certificate',
        actions: [
          if (_phase == _Phase.verified || _phase == _Phase.failed)
            StaffHeaderAction(
              icon: Icons.refresh,
              tooltip: 'Scan another',
              onPressed: _reset,
            ),
        ],
      ),
      body: SafeArea(child: _buildBody()),
    );
  }

  Widget _buildBody() {
    switch (_phase) {
      case _Phase.scanning:
        return _buildScanner();
      case _Phase.looking:
        return _buildLoading();
      case _Phase.verified:
        return _buildResult();
      case _Phase.failed:
        return _buildFailure();
    }
  }

  Widget _buildScanner() {
    return Column(
      children: [
        Expanded(
          flex: 5,
          child: Stack(
            children: [
              MobileScanner(
                controller: _controller,
                onDetect: _onBarcodeDetected,
                // mobile_scanner 5.x errorBuilder signature requires a
                // third `child` parameter — pass it through as `_`.
                errorBuilder: (ctx, err, _) => _buildNoCameraNotice(err),
              ),
              Align(
                alignment: Alignment.center,
                child: Container(
                  width: 240,
                  height: 240,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.white, width: 3),
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(flex: 3, child: _buildBottomControls()),
      ],
    );
  }

  Widget _buildNoCameraNotice(MobileScannerException err) {
    return Container(
      color: StaffSurfaces.softPanel,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.no_photography_outlined,
                size: 56,
                color: StaffSurfaces.textMutedSoft,
              ),
              const SizedBox(height: 12),
              const Text(
                'Camera not available',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Use the gallery or manual options below.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                err.errorCode.name,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11,
                  color: StaffSurfaces.textMutedSoft,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBottomControls() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      decoration: BoxDecoration(
        color: StaffSurfaces.cardBg,
        border: const Border(top: BorderSide(color: StaffSurfaces.divider)),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_statusMessage != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: StaffSurfaces.softPanelDeep,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _statusMessage!,
                  style: TextStyle(
                    fontSize: 12,
                    color: StaffSurfaces.brandSoft,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            const Text(
              'Position the QR code inside the frame, or use one of the options below.',
              style: TextStyle(
                fontSize: 12,
                color: StaffSurfaces.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickFromGallery,
                    icon: const Icon(Icons.image_outlined, size: 18),
                    label: const Text('Gallery'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: StaffSurfaces.textPrimary,
                      side: const BorderSide(color: StaffSurfaces.cardBorder),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _showManualDialog,
                    icon: const Icon(Icons.keyboard_outlined, size: 18),
                    label: const Text('Enter ID'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: StaffSurfaces.textPrimary,
                      side: const BorderSide(color: StaffSurfaces.cardBorder),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoading() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(color: StaffSurfaces.brandSoft),
          const SizedBox(height: 18),
          Text(
            _statusMessage ?? 'Verifying…',
            style: const TextStyle(
              fontSize: 14,
              color: StaffSurfaces.textPrimary,
            ),
          ),
          if (_scannedRaw != null) ...[
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                _scannedRaw!.length > 100
                    ? '${_scannedRaw!.substring(0, 100)}…'
                    : _scannedRaw!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11,
                  color: StaffSurfaces.textMutedSoft,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildFailure() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: 16),
            const Text(
              'Verification failed',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _statusMessage ?? 'Unknown error.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                color: StaffSurfaces.textSecondary,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _reset,
              icon: const Icon(Icons.qr_code_scanner, size: 18),
              label: const Text('Try again'),
              style: FilledButton.styleFrom(
                backgroundColor: StaffSurfaces.cta,
                elevation: 0,
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResult() {
    final t = _timeline!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
      children: [
        // Success banner
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.successBg,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.successBorder, width: 1.5),
          ),
          child: Row(
            children: [
              const Icon(Icons.verified, color: AppColors.success, size: 28),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Certificate verified',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.success,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Cross-checked against the National Immunization Registry',
                      style: TextStyle(
                        fontSize: 11,
                        color: StaffSurfaces.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Citizen card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: StaffSurfaces.card(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'CITIZEN',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textMutedSoft,
                  letterSpacing: 1,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                t.patientName.isEmpty ? '—' : t.patientName.toUpperCase(),
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'NIC: ${t.nicNumber.isEmpty ? '—' : t.nicNumber}',
                style: const TextStyle(
                  fontSize: 12,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _metricBox(
                    '${t.totalDoses}',
                    'Doses',
                    StaffSurfaces.brandSoft,
                  ),
                  const SizedBox(width: 8),
                  _metricBox(
                    '${t.distinctVaccines}',
                    'Vaccines',
                    AppColors.ai,
                  ),
                  const SizedBox(width: 8),
                  _metricBox(
                    t.lastVaccinatedAt != null
                        ? '${t.lastVaccinatedAt!.year}-${t.lastVaccinatedAt!.month.toString().padLeft(2, '0')}-${t.lastVaccinatedAt!.day.toString().padLeft(2, '0')}'
                        : '—',
                    'Last dose',
                    AppColors.success,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),

        StaffSectionHeader(
          title: 'Administered records',
          count: t.records.length,
        ),

        if (t.records.isEmpty)
          const StaffEmptyCard(
            message: 'No records on file',
            icon: Icons.verified_user_outlined,
          )
        else
          ...t.records.map(_recordTile),
      ],
    );
  }

  Widget _metricBox(String value, String label, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: color,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: StaffSurfaces.textMutedSoft,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _recordTile(PatientVaccinationRecordModel r) {
    final d = r.administeredAt;
    final dateStr =
        '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.successBg,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.check, size: 16, color: AppColors.success),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.vaccineName,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: StaffSurfaces.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Dose ${r.doseNumber} · $dateStr',
                  style: const TextStyle(
                    fontSize: 12,
                    color: StaffSurfaces.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'By ${r.administeredByName}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: StaffSurfaces.textMutedSoft,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showManualDialog() async {
    _manualController.clear();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: StaffSurfaces.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Enter Patient ID',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: StaffSurfaces.textPrimary,
          ),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Paste the patient profile UUID.',
              style: TextStyle(
                fontSize: 12,
                color: StaffSurfaces.textSecondary,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _manualController,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                isDense: true,
              ),
              style: const TextStyle(fontSize: 12),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              _manualEntry();
            },
            style: FilledButton.styleFrom(
              backgroundColor: StaffSurfaces.cta,
              elevation: 0,
            ),
            child: const Text('Verify'),
          ),
        ],
      ),
    );
  }
}
