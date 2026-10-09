import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../staff/presentation/widgets/staff_common_widgets.dart';
import '../../data/models/agent_models.dart';
import '../../data/repositories/agent_repository.dart';
import 'appointment_card.dart';
import 'payhere_checkout_sheet.dart';

class AgentBookingSheet extends StatefulWidget {
  final VoidCallback? onAppointmentBooked;

  const AgentBookingSheet({super.key, this.onAppointmentBooked});

  static Future<void> show(BuildContext context, {VoidCallback? onAppointmentBooked}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => AgentBookingSheet(onAppointmentBooked: onAppointmentBooked),
    );
  }

  @override
  State<AgentBookingSheet> createState() => _AgentBookingSheetState();
}

class _AgentBookingSheetState extends State<AgentBookingSheet> {
  final List<AgentMessage> _messages = [
    const AgentMessage(
      role: 'assistant',
      content:
          'Hello — I am the Vaxora booking concierge.\n\nI can:\n• Find hospitals that have your vaccine in stock\n• Show clinic dates and 20-minute slots\n• Reserve an appointment with confirmation\n\nHow can I help?',
    ),
  ];

  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isLoading = false;
  bool _isOnline = true;

  final List<String> _suggestedPrompts = [
    'Which hospitals have Pfizer COVID-19 vaccine?',
    'Book the next Influenza slot',
    'Show my booked appointments',
    'What vaccines are available right now?',
  ];

  @override
  void initState() {
    super.initState();
    _checkHealth();
  }

  Future<void> _checkHealth() async {
    final online = await AgentRepository.checkHealth();
    if (mounted) {
      setState(() => _isOnline = online);
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage([String? textToSend]) async {
    final text = (textToSend ?? _textController.text).trim();
    if (text.isEmpty || _isLoading) return;

    final userMsg = AgentMessage(role: 'user', content: text);
    setState(() {
      _messages.add(userMsg);
      _isLoading = true;
    });
    if (textToSend == null) {
      _textController.clear();
    }
    _scrollToBottom();

    try {
      final response = await AgentRepository.sendMessage(
        conversationHistory: _messages,
      );

      if (mounted) {
        setState(() {
          _messages.add(response);
          _isLoading = false;
        });
        _scrollToBottom();

        if (response.booking != null && response.booking!.success) {
          widget.onAppointmentBooked?.call();
          if (!response.booking!.isFree && response.booking!.payherePayload != null) {
            _launchPayHere(response.booking!);
          }
        } else if (response.cancellation != null ||
            (response.content.toLowerCase().contains('cancelled') &&
                response.content.toLowerCase().contains('appointment'))) {
          widget.onAppointmentBooked?.call();
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _messages.add(
            AgentMessage(
              role: 'assistant',
              content: '⚠️ **Connection Note**: $e',
              isError: true,
            ),
          );
          _isLoading = false;
        });
        _scrollToBottom();
      }
    }
  }

  void _approveProposal(AgentProposal proposal) {
    final prompt =
        'I approve and confirm booking for ${proposal.vaccineName} at ${proposal.hospitalName} on ${proposal.appointmentDate} at ${proposal.timeSlot}. Please proceed with booking.';
    _sendMessage(prompt);
  }

  void _approveCancellation(AgentProposal proposal) {
    final target = proposal.vaccineName.isNotEmpty ? proposal.vaccineName : 'my appointment';
    final dateStr = proposal.appointmentDate.isNotEmpty ? ' on ${proposal.appointmentDate}' : '';
    final idStr = (proposal.appointmentId != null && proposal.appointmentId!.isNotEmpty)
        ? ' (ID: ${proposal.appointmentId})'
        : '';
    final prompt =
        'I approve and confirm cancellation of $target$dateStr$idStr. Please proceed with cancellation.';
    _sendMessage(prompt);
  }

  void _declineCancellation() {
    _sendMessage("I want to keep my appointment. Please do not cancel it.");
  }

  void _launchPayHere(AgentBooking booking) {
    final aptMap = booking.appointment ?? {};
    final rawId = aptMap['id']?.toString() ?? aptMap['Id']?.toString() ?? '';
    final aptId = rawId.isNotEmpty && rawId.length >= 8
        ? 'VAX-${rawId.substring(0, 8).toUpperCase()}'
        : (aptMap['referenceNumber']?.toString() ?? 'VAX-APT');
    final fee = (aptMap['fee'] as num?)?.toDouble() ??
        ((booking.payherePayload?['amount'] as num?)?.toDouble() ?? 0.0);

    final appointment = PatientAppointment(
      id: aptId,
      rawId: rawId,
      vaccineName: aptMap['vaccineName']?.toString() ?? 'Vaccine',
      hospitalName: aptMap['hospitalName']?.toString() ?? 'Hospital',
      location: aptMap['hospitalName']?.toString() ?? 'Hospital Center',
      date: aptMap['appointmentDate']?.toString() ?? '',
      time: aptMap['timeSlot']?.toString() ?? '',
      doctorName: aptMap['doctorName']?.toString() ?? 'Assigned Medical Staff',
      status: 'PendingPayment',
      fee: fee,
      isPaid: false,
    );

    PayHereCheckoutSheet.show(
      context,
      appointment: appointment,
      onPaymentSuccess: () {
        widget.onAppointmentBooked?.call();
        if (mounted) {
          setState(() {
            _messages.add(
              const AgentMessage(
                role: 'assistant',
                content: '🎉 **Payment Verified Successfully!**\nYour vaccination appointment is now fully confirmed.',
              ),
            );
          });
          _scrollToBottom();
        }
      },
    );
  }

  void _declineProposal() {
    _sendMessage("I want to decline this booking proposal. Let's look for other options or dates.");
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      height: MediaQuery.of(context).size.height * 0.88,
      margin: EdgeInsets.only(bottom: bottomInset),
      decoration: const BoxDecoration(
        color: StaffSurfaces.appBarBg,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: StaffSurfaces.chipNeutralBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.aiBg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(Icons.auto_awesome, color: AppColors.ai),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'AI booking concierge',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: StaffSurfaces.textPrimary,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: _isOnline
                                  ? AppColors.success
                                  : AppColors.warning,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _isOnline
                                ? 'Online · booking assistant'
                                : 'Connecting…',
                            style: const TextStyle(
                              fontSize: 11.5,
                              color: StaffSurfaces.textSecondary,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close, color: StaffSurfaces.textSecondary),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          const Divider(height: 1, thickness: 1, color: StaffSurfaces.divider),

          // Messages
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg.role == 'user';
                return _buildMessageItem(msg, isUser);
              },
            ),
          ),

          // Suggested prompt chips
          if (_messages.length <= 2 && !_isLoading)
            Container(
              height: 44,
              margin: const EdgeInsets.symmetric(vertical: 4),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                itemCount: _suggestedPrompts.length,
                separatorBuilder: (context, index) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final prompt = _suggestedPrompts[index];
                  return ActionChip(
                    label: Text(
                      prompt,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: StaffSurfaces.textPrimary,
                      ),
                    ),
                    backgroundColor: StaffSurfaces.softPanel,
                    side: const BorderSide(color: StaffSurfaces.cardBorder),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                    ),
                    onPressed: () => _sendMessage(prompt),
                  );
                },
              ),
            ),

          if (_isLoading)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
              child: Row(
                children: [
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: StaffSurfaces.cta,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    'Checking schedules and stock…',
                    style: TextStyle(
                      fontSize: 12,
                      color: StaffSurfaces.textSecondary,
                    ),
                  ),
                ],
              ),
            ),

          // Input Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: const BoxDecoration(
              color: StaffSurfaces.appBarBg,
              border: Border(top: BorderSide(color: StaffSurfaces.divider)),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _textController,
                      decoration: InputDecoration(
                        hintText: 'Ask to find vaccines or book a slot…',
                        hintStyle: const TextStyle(
                          fontSize: 13,
                          color: StaffSurfaces.textMutedSoft,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
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
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: StaffSurfaces.brandSoft),
                        ),
                      ),
                      onSubmitted: (val) => _sendMessage(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Material(
                    color: StaffSurfaces.cta,
                    shape: const CircleBorder(),
                    child: IconButton(
                      icon: const Icon(
                        Icons.send_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                      onPressed: _isLoading ? null : () => _sendMessage(),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageItem(AgentMessage msg, bool isUser) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!isUser) ...[
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: msg.isError
                        ? AppColors.errorBg
                        : StaffSurfaces.softPanelDeep,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Icon(
                    msg.isError
                        ? Icons.error_outline
                        : Icons.auto_awesome,
                    size: 16,
                    color: msg.isError
                        ? AppColors.error
                        : StaffSurfaces.brandSoft,
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: isUser
                        ? StaffSurfaces.cta
                        : (msg.isError
                            ? AppColors.errorBg
                            : StaffSurfaces.softPanel),
                    borderRadius: BorderRadius.circular(14).copyWith(
                      bottomRight: isUser
                          ? const Radius.circular(4)
                          : const Radius.circular(14),
                      bottomLeft: !isUser
                          ? const Radius.circular(4)
                          : const Radius.circular(14),
                    ),
                    border: Border.all(
                      color: isUser
                          ? StaffSurfaces.cta
                          : (msg.isError
                              ? AppColors.error.withValues(alpha: 0.3)
                              : StaffSurfaces.cardBorder),
                    ),
                  ),
                  child: _buildFormattedText(
                    msg.content,
                    isUser,
                    isError: msg.isError,
                  ),
                ),
              ),
            ],
          ),

          // Interactive Proposal Card
          if (msg.proposal != null) ...[
            const SizedBox(height: 10),
            _buildProposalCard(msg.proposal!),
          ],

          // Booking Confirmation Success Card
          if (msg.booking != null && msg.booking!.success) ...[
            const SizedBox(height: 10),
            _buildBookingSuccessCard(msg.booking!),
          ],
        ],
      ),
    );
  }

  Widget _buildFormattedText(String text, bool isUser, {bool isError = false}) {
    if (text.isEmpty) return const SizedBox.shrink();

    final lines = text.split('\n');
    final List<Widget> widgets = [];

    for (int i = 0; i < lines.length; i++) {
      final line = lines[i];
      final trimmed = line.trim();

      if (trimmed.isEmpty) {
        widgets.add(const SizedBox(height: 6));
        continue;
      }

      final leadingSpaces = line.length - line.trimLeft().length;
      final indentPadding = leadingSpaces >= 2 ? 14.0 : 0.0;

      final isBullet = (trimmed.startsWith('- ') ||
          trimmed.startsWith('• ') ||
          (trimmed.startsWith('* ') && !trimmed.startsWith('**')));

      final numMatch = RegExp(r'^(\d+)\.\s+(.*)').firstMatch(trimmed);
      final isHeader = trimmed.startsWith('#');

      if (isBullet) {
        final content = trimmed.substring(2).trim();
        widgets.add(
          Padding(
            padding: EdgeInsets.only(left: 4 + indentPadding, top: 2, bottom: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  margin: const EdgeInsets.only(top: 6, right: 8),
                  width: 5,
                  height: 5,
                  decoration: BoxDecoration(
                    color: isUser
                        ? Colors.white70
                        : (isError ? AppColors.error : AppColors.primary),
                    shape: BoxShape.circle,
                  ),
                ),
                Expanded(
                  child: RichText(
                    text: TextSpan(
                      children: _parseInlineMarkdown(
                        content,
                        isUser,
                        isError: isError,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      } else if (numMatch != null) {
        final numStr = numMatch.group(1)!;
        final content = numMatch.group(2)!;
        widgets.add(
          Padding(
            padding: EdgeInsets.only(left: 4 + indentPadding, top: 3, bottom: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 22,
                  child: Text(
                    '$numStr.',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: isUser
                          ? Colors.white
                          : (isError ? AppColors.error : AppColors.primary),
                    ),
                  ),
                ),
                Expanded(
                  child: RichText(
                    text: TextSpan(
                      children: _parseInlineMarkdown(
                        content,
                        isUser,
                        isError: isError,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      } else if (isHeader) {
        final headerText = trimmed.replaceFirst(RegExp(r'^#+\s*'), '');
        widgets.add(
          Padding(
            padding: const EdgeInsets.only(top: 6, bottom: 4),
            child: RichText(
              text: TextSpan(
                children: _parseInlineMarkdown(
                  headerText,
                  isUser,
                  isError: isError,
                  fontSize: 14,
                  isBold: true,
                ),
              ),
            ),
          ),
        );
      } else {
        widgets.add(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: RichText(
              text: TextSpan(
                children: _parseInlineMarkdown(
                  line,
                  isUser,
                  isError: isError,
                  fontSize: 13,
                ),
              ),
            ),
          ),
        );
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: widgets,
    );
  }

  List<InlineSpan> _parseInlineMarkdown(
    String text,
    bool isUser, {
    bool isError = false,
    double fontSize = 13,
    bool isBold = false,
  }) {
    final List<InlineSpan> spans = [];
    final baseColor = isUser
        ? Colors.white
        : (isError ? AppColors.error : AppColors.textTitle);
    final boldColor = isUser
        ? Colors.white
        : (isError ? AppColors.error : AppColors.textTitle);
    final baseStyle = TextStyle(
      fontSize: fontSize,
      height: 1.45,
      color: baseColor,
      fontWeight: isBold ? FontWeight.w700 : FontWeight.w400,
    );

    final regex = RegExp(r'(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)');
    int lastIndex = 0;

    for (final match in regex.allMatches(text)) {
      if (match.start > lastIndex) {
        spans.add(
          TextSpan(
            text: text.substring(lastIndex, match.start),
            style: baseStyle,
          ),
        );
      }

      final matchedText = match.group(0)!;
      if (matchedText.startsWith('**') && matchedText.endsWith('**')) {
        spans.add(
          TextSpan(
            text: matchedText.substring(2, matchedText.length - 2),
            style: baseStyle.copyWith(
              fontWeight: FontWeight.w700,
              color: boldColor,
            ),
          ),
        );
      } else if (matchedText.startsWith('`') && matchedText.endsWith('`')) {
        spans.add(
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: isUser ? Colors.white24 : AppColors.borderLight,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                matchedText.substring(1, matchedText.length - 1),
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: fontSize * 0.9,
                  color: isUser ? Colors.white : AppColors.textTitle,
                ),
              ),
            ),
          ),
        );
      } else if (matchedText.startsWith('*') && matchedText.endsWith('*')) {
        spans.add(
          TextSpan(
            text: matchedText.substring(1, matchedText.length - 1),
            style: baseStyle.copyWith(fontStyle: FontStyle.italic),
          ),
        );
      }

      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      spans.add(
        TextSpan(
          text: text.substring(lastIndex),
          style: baseStyle,
        ),
      );
    }

    return spans;
  }

  Widget _buildProposalCard(AgentProposal p) {
    if (p.isCancellation) {
      return _buildCancellationProposalCard(p);
    }
    return Container(
      margin: const EdgeInsets.only(left: 38, top: 4),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        color: AppColors.successBg,
        borderColor: AppColors.success.withValues(alpha: 0.28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.event_available, color: AppColors.success, size: 18),
              const SizedBox(width: 6),
              const Text(
                'Proposed slot',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            p.vaccineName,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 14,
              color: StaffSurfaces.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            p.hospitalName,
            style: const TextStyle(
              fontSize: 12,
              color: StaffSurfaces.textSecondary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            '${p.appointmentDate}  ·  ${p.timeSlot}',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: StaffSurfaces.brandSoft,
            ),
          ),
          if (p.fee > 0) ...[
            const SizedBox(height: 2),
            Text(
              'Fee LKR ${p.fee.toStringAsFixed(2)}',
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.warning,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: _isLoading ? null : () => _approveProposal(p),
                  style: FilledButton.styleFrom(
                    backgroundColor: StaffSurfaces.cta,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    textStyle: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  child: const Text('Confirm & book'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: _isLoading ? null : _declineProposal,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  foregroundColor: StaffSurfaces.textSecondary,
                  side: const BorderSide(color: StaffSurfaces.cardBorder),
                ),
                child: const Text('Decline', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCancellationProposalCard(AgentProposal p) {
    return Container(
      margin: const EdgeInsets.only(left: 38, top: 4),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        color: AppColors.errorBg,
        borderColor: AppColors.error.withValues(alpha: 0.28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.warning_amber_rounded, color: AppColors.error, size: 20),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Cancellation Approval Required',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.error),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.errorBg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.errorBorder, width: 0.8),
                ),
                child: const Text(
                  'Action Needed',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.error),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            p.vaccineName,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 14,
              color: StaffSurfaces.textPrimary,
            ),
          ),
          if (p.hospitalName.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              p.hospitalName,
              style: const TextStyle(
                fontSize: 12,
                color: StaffSurfaces.textSecondary,
              ),
            ),
          ],
          if (p.appointmentDate.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              '${p.appointmentDate}${p.timeSlot.isNotEmpty ? "  ·  ${p.timeSlot}" : ""}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.error,
              ),
            ),
          ],
          const SizedBox(height: 8),
          const Text(
            'Confirm to cancel this session. The reserved slot will be released.',
            style: TextStyle(
              fontSize: 12,
              color: StaffSurfaces.textSecondary,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: _isLoading ? null : () => _approveCancellation(p),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.error,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    textStyle: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  child: const Text('Confirm cancel'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: _isLoading ? null : _declineCancellation,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  foregroundColor: StaffSurfaces.textSecondary,
                  side: const BorderSide(color: StaffSurfaces.cardBorder),
                ),
                child: const Text(
                  'Keep',
                  style: TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBookingSuccessCard(AgentBooking b) {
    return Container(
      margin: const EdgeInsets.only(left: 38, top: 4),
      padding: const EdgeInsets.all(14),
      decoration: StaffSurfaces.card(
        color: AppColors.successBg,
        borderColor: AppColors.success.withValues(alpha: 0.28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified, color: AppColors.success, size: 20),
              const SizedBox(width: 8),
              const Text(
                'Appointment confirmed',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  color: StaffSurfaces.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            b.message ??
                'Your appointment is registered in the immunization registry.',
            style: const TextStyle(
              fontSize: 12.5,
              color: StaffSurfaces.textSecondary,
              height: 1.4,
            ),
          ),
          if (!b.isFree && b.payherePayload != null) ...[
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: () => _launchPayHere(b),
              icon: const Icon(Icons.payment, size: 16),
              label: const Text('Pay with PayHere'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.success,
                foregroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                textStyle: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
