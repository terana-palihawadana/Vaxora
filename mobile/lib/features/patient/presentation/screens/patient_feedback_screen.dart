import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/repositories/auth_repository.dart';
import '../../../staff/presentation/widgets/network_avatar.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/feedback_model.dart';
import '../../data/repositories/patient_repository.dart';

class PatientFeedbackScreen extends StatefulWidget {
  const PatientFeedbackScreen({super.key});

  @override
  State<PatientFeedbackScreen> createState() => _PatientFeedbackScreenState();
}

class _PatientFeedbackScreenState extends State<PatientFeedbackScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _messageController = TextEditingController();

  int _rating = 5;
  bool _isAnonymous = false;

  bool _submitting = false;
  bool _submitted = false;
  String? _errorMessage;

  String _displayName = 'Citizen';
  String? _photoUrl;

  // Past feedbacks
  List<FeedbackModel> _pastFeedbacks = const [];
  bool _loadingPast = true;

  @override
  void initState() {
    super.initState();
    _loadUserAndHistory();
  }

  Future<void> _loadUserAndHistory() async {
    await Future.wait([_loadUser(), _loadPastFeedbacks()]);
  }

  Future<void> _loadUser() async {
    final user = await AuthRepository.getCurrentUser();
    if (user != null && mounted) {
      setState(() {
        _nameController.text = user.name;
        _emailController.text = user.email;
        _displayName = user.name.isNotEmpty ? user.name : 'Citizen';
        _photoUrl = resolveMediaUrl(user.profilePhotoUrl);
        if (user.phoneNumber != null && user.phoneNumber!.isNotEmpty) {
          _phoneController.text = user.phoneNumber!;
        }
      });
    }
  }

  Future<void> _loadPastFeedbacks() async {
    setState(() => _loadingPast = true);
    final list = await PatientRepository.getMyFeedback();
    if (mounted) {
      setState(() {
        _pastFeedbacks = list;
        _loadingPast = false;
      });
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  void _handleAnonymousToggle(bool checked) {
    setState(() {
      _isAnonymous = checked;
      if (checked) {
        _nameController.clear();
        _emailController.clear();
        _phoneController.clear();
      } else {
        // Re-populate from user
        _loadUser();
      }
    });
  }

  Future<void> _handleSubmit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_submitting) return;

    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    try {
      await PatientRepository.submitFeedback(
        message: _messageController.text.trim(),
        rating: _rating,
        isAnonymous: _isAnonymous,
        submitterName: _isAnonymous ? null : _nameController.text.trim(),
        submitterEmail: _isAnonymous ? null : _emailController.text.trim(),
        submitterPhone: _isAnonymous ? null : _phoneController.text.trim(),
      );

      if (!mounted) return;
      setState(() {
        _submitting = false;
        _submitted = true;
      });
      await _loadPastFeedbacks();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _errorMessage = e.toString().replaceFirst('ApiException: ', '');
      });
    }
  }

  void _handleReset() {
    setState(() {
      _messageController.clear();
      _rating = 5;
      _submitted = false;
      _errorMessage = null;
    });
    // Re-fill user identity fields
    _loadUser();
  }

  // ============================================================
  // Edit dialog
  // ============================================================

  Future<void> _handleEdit(FeedbackModel fb) async {
    final msgController = TextEditingController(text: fb.message);
    int editedRating = fb.rating;
    bool saving = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          return AlertDialog(
            backgroundColor: StaffSurfaces.cardBg,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: const Text(
              'Edit Feedback',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (i) {
                      final v = i + 1;
                      return IconButton(
                        onPressed: () => setDialogState(() => editedRating = v),
                        icon: Icon(
                          v <= editedRating
                              ? Icons.star_rounded
                              : Icons.star_outline_rounded,
                          color: AppColors.rating,
                          size: 28,
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: msgController,
                    maxLines: 5,
                    decoration: InputDecoration(
                      hintText: 'Your feedback message…',
                      filled: true,
                      fillColor: StaffSurfaces.softPanel,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(
                          color: StaffSurfaces.cardBorder,
                        ),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(
                          color: StaffSurfaces.cardBorder,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: saving
                    ? null
                    : () async {
                        final trimmed = msgController.text.trim();
                        if (trimmed.isEmpty) return;
                        setDialogState(() => saving = true);
                        try {
                          await PatientRepository.updateFeedback(
                            id: fb.id,
                            message: trimmed,
                            rating: editedRating,
                            isAnonymous: fb.isAnonymous,
                            submitterName: fb.submitterName,
                            submitterEmail: fb.submitterEmail,
                            submitterPhone: fb.submitterPhone,
                          );
                          if (!mounted) return;
                          Navigator.pop(ctx);
                          await _loadPastFeedbacks();
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              backgroundColor: AppColors.success,
                              content: Text('Feedback updated.'),
                              behavior: SnackBarBehavior.floating,
                            ),
                          );
                        } catch (e) {
                          setDialogState(() => saving = false);
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              backgroundColor: AppColors.error,
                              content: Text('Update failed: $e'),
                              behavior: SnackBarBehavior.floating,
                            ),
                          );
                        }
                      },
                style: FilledButton.styleFrom(
                  backgroundColor: StaffSurfaces.cta,
                ),
                child: Text(saving ? 'Saving…' : 'Save'),
              ),
            ],
          );
        },
      ),
    );
    msgController.dispose();
  }

  // ============================================================
  // Input decorations & helpers
  // ============================================================

  InputDecoration _field(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(
        color: StaffSurfaces.textMutedSoft,
        fontSize: 13,
      ),
      filled: true,
      fillColor: StaffSurfaces.cardBg,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StaffSurfaces.cardBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: StaffSurfaces.brandSoft),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    return '${dt.day.toString().padLeft(2, '0')}/'
        '${dt.month.toString().padLeft(2, '0')}/${dt.year}';
  }

  String _statusLabel(String status) {
    switch (status.toLowerCase()) {
      case 'inreview':
        return 'In Review';
      case 'new':
        return 'New';
      case 'resolved':
        return 'Resolved';
      case 'escalated':
        return 'Escalated';
      default:
        return status;
    }
  }

  StaffChipTone _statusTone(String status) {
    switch (status.toLowerCase()) {
      case 'resolved':
        return StaffChipTone.success;
      case 'inreview':
        return StaffChipTone.warning;
      case 'escalated':
        return StaffChipTone.danger;
      default:
        return StaffChipTone.brand;
    }
  }

  Widget _stars(int rating, {double size = 16}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        return Icon(
          i < rating ? Icons.star_rounded : Icons.star_outline_rounded,
          size: size,
          color: AppColors.rating,
        );
      }),
    );
  }

  // ============================================================
  // Build
  // ============================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _displayName,
        subtitle: 'Patient · Feedback',
        photoUrl: _photoUrl,
      ),
      body: RefreshIndicator(
        onRefresh: _loadPastFeedbacks,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            StaffPageIntro(
              eyebrow: 'Service quality',
              title: 'Share feedback',
              subtitle:
                  'Rate a recent vaccination visit so centres can improve.',
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: StaffSurfaces.card(),
              child: _submitted ? _buildSuccessCard() : _buildForm(),
            ),
            const SizedBox(height: 20),
            _buildPastFeedbacksSection(),
          ],
        ),
      ),
    );
  }

  Widget _buildSuccessCard() {
    return Column(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppColors.successBg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: AppColors.success.withValues(alpha: 0.28),
            ),
          ),
          child: const Icon(
            Icons.check_circle_outline,
            color: AppColors.success,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'Thanks for the feedback',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: StaffSurfaces.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          _isAnonymous
              ? 'Your $_rating-star rating was submitted anonymously.'
              : 'Your $_rating-star rating and comments are recorded.',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 13,
            color: StaffSurfaces.textSecondary,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _handleReset,
          style: FilledButton.styleFrom(
            backgroundColor: StaffSurfaces.cta,
            elevation: 0,
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          ),
          child: const Text('Submit another'),
        ),
      ],
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Your experience',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: StaffSurfaces.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Tap a star, then add a short note.',
            style: TextStyle(
              fontSize: 12.5,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          const SizedBox(height: 14),

          // Anonymous toggle
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: StaffSurfaces.softWell(),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text(
                        'Submit anonymously',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Your name, email and phone will not be recorded.',
                        style: TextStyle(
                          fontSize: 11,
                          color: StaffSurfaces.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                Switch.adaptive(
                  value: _isAnonymous,
                  activeColor: StaffSurfaces.cta,
                  onChanged: _submitting ? null : _handleAnonymousToggle,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Rating
          Container(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
            decoration: StaffSurfaces.softWell(),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (index) {
                final starValue = index + 1;
                return IconButton(
                  onPressed: _submitting
                      ? null
                      : () => setState(() => _rating = starValue),
                  icon: Icon(
                    starValue <= _rating
                        ? Icons.star_rounded
                        : Icons.star_outline_rounded,
                    color: AppColors.rating,
                    size: 30,
                  ),
                );
              }),
            ),
          ),
          const SizedBox(height: 14),

          // Identity fields — disabled when anonymous
          Opacity(
            opacity: _isAnonymous ? 0.5 : 1,
            child: Column(
              children: [
                TextFormField(
                  controller: _nameController,
                  enabled: !_isAnonymous && !_submitting,
                  decoration: _field('Your name'),
                  validator: (v) {
                    if (_isAnonymous) return null;
                    return (v == null || v.trim().isEmpty)
                        ? 'Please enter name'
                        : null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _emailController,
                  enabled: !_isAnonymous && !_submitting,
                  keyboardType: TextInputType.emailAddress,
                  decoration: _field('Email'),
                  validator: (v) {
                    if (_isAnonymous) return null;
                    return (v == null || v.trim().isEmpty)
                        ? 'Please enter email'
                        : null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _phoneController,
                  enabled: !_isAnonymous && !_submitting,
                  keyboardType: TextInputType.phone,
                  decoration: _field('Contact number'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          TextFormField(
            controller: _messageController,
            enabled: !_submitting,
            maxLines: 4,
            decoration: _field('Tell us about your visit…'),
            validator: (v) => (v == null || v.trim().isEmpty)
                ? 'Please write your feedback'
                : null,
          ),

          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.errorBg,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: AppColors.error.withValues(alpha: 0.28),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.error_outline,
                    color: AppColors.error,
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.error,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _handleSubmit,
            style: FilledButton.styleFrom(
              backgroundColor: StaffSurfaces.cta,
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 14),
              textStyle: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
            child: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Submit feedback'),
          ),
        ],
      ),
    );
  }

  Widget _buildPastFeedbacksSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(
              Icons.history,
              size: 18,
              color: StaffSurfaces.textPrimary,
            ),
            const SizedBox(width: 8),
            const Text(
              'My Past Feedbacks',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: StaffSurfaces.textPrimary,
              ),
            ),
            const Spacer(),
            if (!_loadingPast && _pastFeedbacks.isNotEmpty)
              Text(
                '${_pastFeedbacks.length}',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: StaffSurfaces.textSecondary,
                ),
              ),
          ],
        ),
        const SizedBox(height: 10),
        if (_loadingPast)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          )
        else if (_pastFeedbacks.isEmpty)
          Container(
            padding: const EdgeInsets.all(20),
            decoration: StaffSurfaces.card(),
            child: const Text(
              "You haven't submitted any feedback yet.",
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                fontStyle: FontStyle.italic,
                color: StaffSurfaces.textSecondary,
              ),
            ),
          )
        else
          ..._pastFeedbacks.map(_buildPastFeedbackCard),
      ],
    );
  }

  Widget _buildPastFeedbackCard(FeedbackModel fb) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _stars(fb.rating, size: 14),
              const Spacer(),
              StaffStatusChip(
                label: _statusLabel(fb.status),
                tone: _statusTone(fb.status),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            fb.message,
            style: const TextStyle(
              fontSize: 13,
              color: StaffSurfaces.textPrimary,
              height: 1.4,
            ),
          ),
          if (fb.adminResponse != null && fb.adminResponse!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.successBg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppColors.success.withValues(alpha: 0.28),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.reply,
                        size: 13,
                        color: AppColors.success,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Admin response',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.success.withValues(alpha: 0.9),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    fb.adminResponse!,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.success,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Text(
                _formatDate(fb.createdAt),
                style: const TextStyle(
                  fontSize: 11,
                  color: StaffSurfaces.textMutedSoft,
                ),
              ),
              const Spacer(),
              if (fb.isResolved)
                const Text(
                  'Locked',
                  style: TextStyle(
                    fontSize: 11,
                    color: StaffSurfaces.textMutedSoft,
                    fontStyle: FontStyle.italic,
                  ),
                )
              else
                TextButton.icon(
                  onPressed: () => _handleEdit(fb),
                  icon: const Icon(Icons.edit_outlined, size: 14),
                  label: const Text('Edit', style: TextStyle(fontSize: 12)),
                  style: TextButton.styleFrom(
                    foregroundColor: StaffSurfaces.brandSoft,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
