import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:flutter/foundation.dart';

import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/models/user_model.dart';
import '../../data/models/agent_models.dart';
import '../../services/care_plan_pdf_service.dart';
import '../../services/care_plan_storage_service.dart';

/// Bottom sheet that mirrors the React CarePlanModal.
///
/// Usage:
/// ```
/// // Fresh generation (autosaves to history):
/// CarePlanSheet.show(
///   context,
///   loader: () => AgentRepository.generatePatientCarePlan(profileId),
/// );
///
/// // Re-opening a saved plan (no autosave):
/// CarePlanSheet.show(
///   context,
///   loader: () async => saved.result,
///   saveToHistory: false,
/// );
/// ```
class CarePlanSheet {
  static Future<void> show(
    BuildContext context, {
    required Future<CarePlanResponseModel> Function() loader,
    bool saveToHistory = true,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      isDismissible: true,
      builder: (_) =>
          CarePlanLoader(loader: loader, saveToHistory: saveToHistory),
    );
  }
}

class CarePlanLoader extends StatefulWidget {
  final Future<CarePlanResponseModel> Function() loader;
  final bool saveToHistory;

  const CarePlanLoader({
    super.key,
    required this.loader,
    this.saveToHistory = true,
  });

  @override
  State<CarePlanLoader> createState() => _CarePlanLoaderState();
}

class _CarePlanLoaderState extends State<CarePlanLoader> {
  bool _isLoading = true;
  bool _isDownloading = false;
  bool _downloadSuccess = false;
  CarePlanResponseModel? _result;
  String? _error;

  static const _loadingMessages = [
    'Retrieving your health records…',
    'Analysing your medical history…',
    'Cross-referencing clinical guidelines…',
    'Generating your personalised care plan…',
  ];
  int _messageIndex = 0;

  @override
  void initState() {
    super.initState();
    _run();
    _startMessageRotation();
  }

  void _startMessageRotation() {
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 4));
      if (!mounted || !_isLoading) return false;
      setState(
        () => _messageIndex = (_messageIndex + 1) % _loadingMessages.length,
      );
      return true;
    });
  }

  Future<void> _run() async {
    setState(() {
      _isLoading = true;
      _error = null;
      _result = null;
      _downloadSuccess = false;
    });
    try {
      final r = await widget.loader();
      if (!mounted) return;
      setState(() {
        _result = r;
        _isLoading = false;
        if (!r.success) {
          _error =
              r.error ?? 'The AI assistant could not generate a care plan.';
        }
      });
      // Only autosave FRESH generations — never when re-opening a saved plan,
      // otherwise every view creates a duplicate entry in history.
      if (widget.saveToHistory && r.success && r.carePlan != null) {
        try {
          await CarePlanStorageService.save(r);
        } catch (_) {
          // Non-fatal — the plan is still visible
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  /// Builds the PDF bytes and opens a full-screen in-app preview.
  ///
  /// This path works on any emulator — it does not rely on Android's print
  /// service or share targets, which are missing on bare AVD images and
  /// were the reason the previous "Download PDF" button appeared to do
  /// nothing.
  Future<void> _openPdfPreview() async {
    final r = _result;
    debugPrint(
      '[CarePlanSheet] _openPdfPreview triggered, result=${r != null}, plan=${r?.carePlan != null}',
    );
    if (r == null || r.carePlan == null) return;
    debugPrint('[CarePlanSheet] building PDF…');

    setState(() {
      _isDownloading = true;
      _downloadSuccess = false;
    });

    try {
      final cached = await StorageService.getUser();
      final user = cached != null ? UserModel.fromJson(cached) : null;
      final bytes = await CarePlanPdfService.buildPdf(
        r,
        patientName: user?.name,
        registrationNumber: user?.registrationNumber,
      );
      if (!mounted) return;
      setState(() {
        _isDownloading = false;
        _downloadSuccess = true;
      });

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => _PdfPreviewPage(
            bytes: bytes,
            fileName: CarePlanPdfService.suggestedFileName(user?.name),
          ),
        ),
      );

      // Reset the checkmark after the preview is closed
      if (mounted) {
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) setState(() => _downloadSuccess = false);
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isDownloading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.error,
          content: Text('Could not generate PDF: $e'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.of(context).size.height * 0.9;

    return Container(
      height: height,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 6),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.borderCard,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 6, 12, 10),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: const Text('🩺', style: TextStyle(fontSize: 20)),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'AI Care Plan',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textTitle,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Generated by PatientDataAgent + CarePlanningAgent',
                        style: TextStyle(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppColors.textMuted),
                  onPressed: _isLoading
                      ? null
                      : () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.borderLight),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) return _buildLoading();
    if (_error != null) return _buildError();
    return _buildResult();
  }

  Widget _buildLoading() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(color: AppColors.brandBlue),
            const SizedBox(height: 20),
            Text(
              _loadingMessages[_messageIndex],
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textTitle,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'This usually takes 30–90 seconds. Please keep this window open.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 56, color: AppColors.error),
            const SizedBox(height: 12),
            const Text(
              'Could not generate care plan',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textTitle,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.errorBg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.errorBorder),
              ),
              child: Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppColors.error),
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _run,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResult() {
    final r = _result!;
    final plan = r.carePlan;
    final summary = r.patientSummary;

    if (plan == null) {
      return const Center(child: Text('No care plan was returned.'));
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _patientCard(summary),
          const SizedBox(height: 14),

          if (plan.warnings.isNotEmpty) ...[
            _sectionHeader('Warnings'),
            ...plan.warnings.map(_warningTile),
            const SizedBox(height: 14),
          ],

          if (plan.immediateActions.isNotEmpty) ...[
            _sectionHeader('Immediate Actions'),
            ...plan.immediateActions.map(_actionTile),
            const SizedBox(height: 14),
          ],

          if (plan.upcomingVaccines.isNotEmpty) ...[
            _sectionHeader('Upcoming Vaccines'),
            ...plan.upcomingVaccines.map(_vaccineTile),
            const SizedBox(height: 14),
          ],

          if (plan.recommendedScreenings.isNotEmpty) ...[
            _sectionHeader('Recommended Screenings'),
            _bulletList(plan.recommendedScreenings),
            const SizedBox(height: 14),
          ],

          if (plan.lifestyleRecommendations.isNotEmpty) ...[
            _sectionHeader('Lifestyle'),
            _bulletList(plan.lifestyleRecommendations),
            const SizedBox(height: 14),
          ],

          if (plan.referrals.isNotEmpty) ...[
            _sectionHeader('Referrals'),
            _bulletList(plan.referrals),
            const SizedBox(height: 14),
          ],

          if (plan.followUpRecommendation.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.successBg,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.successBorder),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'FOLLOW-UP RECOMMENDATION',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: AppColors.success,
                      letterSpacing: 0.6,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    plan.followUpRecommendation,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.success,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],

          _trajectory(r),

          // ---- Download Care Plan banner (mirrors web) ----
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.successBg,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.successBorder, width: 1.5),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      alignment: Alignment.center,
                      child: const Text('📄', style: TextStyle(fontSize: 20)),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Export Official Care Plan (PDF)',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                              color: AppColors.textTitle,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Download a verified clinical PDF report for your records or doctor consultation.',
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.textMuted,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ElevatedButton.icon(
                  onPressed: _isDownloading ? null : _openPdfPreview,
                  icon: _isDownloading
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          _downloadSuccess
                              ? Icons.check_circle
                              : Icons.download_rounded,
                          size: 18,
                        ),
                  label: Text(
                    _isDownloading
                        ? 'Preparing PDF…'
                        : _downloadSuccess
                        ? 'PDF Ready'
                        : 'Download Care Plan (PDF)',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 12,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          // ---- Regenerate ----
          OutlinedButton.icon(
            onPressed: _isDownloading ? null : _run,
            icon: const Icon(Icons.refresh, size: 16),
            label: const Text('Regenerate Plan'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.textTitle,
              side: const BorderSide(color: AppColors.borderCard),
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ... all the existing widget builders (_patientCard, _sectionHeader,
  // _warningTile, _actionTile, _vaccineTile, _bulletList, _trajectory)
  // are UNCHANGED — copy them from your current file.

  Widget _patientCard(PatientSummaryModel? summary) {
    if (summary == null) return const SizedBox.shrink();
    final demo = summary.demographics;
    final name = demo['name']?.toString() ?? '—';
    final age = demo['age_years'];

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.infoBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.infoBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'PATIENT',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: AppColors.info,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            age != null ? '$name · $age years' : name,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textTitle,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          color: AppColors.textTitle,
          letterSpacing: 0.6,
        ),
      ),
    );
  }

  Widget _warningTile(CarePlanWarningModel w) {
    final s = w.severity.toLowerCase();
    Color bg, fg, border;
    if (s == 'critical') {
      bg = AppColors.errorBg;
      fg = AppColors.error;
      border = AppColors.error;
    } else if (s == 'warning') {
      bg = AppColors.warningBg;
      fg = AppColors.warning;
      border = AppColors.warningBorder;
    } else {
      bg = AppColors.infoBg;
      fg = AppColors.primary;
      border = AppColors.info;
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: bg,
        border: Border(left: BorderSide(color: border, width: 4)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: RichText(
        text: TextSpan(
          style: TextStyle(fontSize: 13, color: fg, height: 1.45),
          children: [
            TextSpan(
              text: '${w.severity}  ',
              style: TextStyle(fontWeight: FontWeight.w800, color: fg),
            ),
            TextSpan(text: w.message),
          ],
        ),
      ),
    );
  }

  Widget _actionTile(CarePlanActionModel a) {
    final p = a.priority.toLowerCase();
    Color bg, fg;
    if (p == 'high') {
      bg = AppColors.errorBg;
      fg = AppColors.error;
    } else if (p == 'medium') {
      bg = AppColors.warningBg;
      fg = AppColors.warning;
    } else {
      bg = AppColors.infoBg;
      fg = AppColors.info;
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  a.priority,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: fg,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  a.action,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textTitle,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            a.reason,
            style: const TextStyle(
              fontSize: 12,
              color: AppColors.textBody,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _vaccineTile(CarePlanVaccineModel v) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.infoBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.infoBorder),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  v.vaccine,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.info,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  v.reason,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textBody,
                  ),
                ),
              ],
            ),
          ),
          if (v.dueWithinDays != null)
            Text(
              'Due in ${v.dueWithinDays}d',
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
        ],
      ),
    );
  }

  Widget _bulletList(List<String> items) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: items
          .map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 6, right: 8),
                    child: SizedBox(
                      width: 5,
                      height: 5,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: AppColors.brandBlue,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      s,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.textBody,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _trajectory(CarePlanResponseModel r) {
    if (r.steps.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.only(top: 12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Agent trajectory',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: AppColors.textMuted,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 6),
          ...r.steps.map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text(
                '✓ ${s.agent} — ${s.durationMs}ms'
                '${s.toolsUsed.isNotEmpty ? ' · ${s.toolsUsed.length} tool${s.toolsUsed.length > 1 ? 's' : ''}: ${s.toolsUsed.join(', ')}' : ''}',
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.textMuted,
                  height: 1.4,
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Total: ${r.durationMs}ms',
            style: const TextStyle(
              fontSize: 10,
              color: AppColors.textPlaceholder,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// =========================================================================
// Full-screen in-app PDF preview
// =========================================================================

/// Renders the PDF bytes in-app using the `printing` package's `PdfPreview`
/// widget. No Android print service or share target is required — this is
/// why it works on every emulator.
class _PdfPreviewPage extends StatelessWidget {
  final Uint8List bytes;
  final String fileName;

  const _PdfPreviewPage({required this.bytes, required this.fileName});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        iconTheme: const IconThemeData(color: AppColors.textTitle),
        title: const Text(
          'Care Plan PDF',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.textTitle,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.share),
            tooltip: 'Share',
            onPressed: () async {
              try {
                await Printing.sharePdf(bytes: bytes, filename: fileName);
              } catch (_) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Share not available on this device.'),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                }
              }
            },
          ),
        ],
      ),
      body: PdfPreview(
        build: (_) async => bytes,
        canChangeOrientation: false,
        canChangePageFormat: false,
        canDebug: false,
        allowSharing: false,
        allowPrinting: false,
        pdfFileName: fileName,
      ),
    );
  }
}
