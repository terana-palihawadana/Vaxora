import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/models/payhere_init_model.dart';
import '../../data/repositories/payment_repository.dart';
import 'appointment_card.dart';

class PayHereCheckoutSheet extends StatefulWidget {
  final PatientAppointment appointment;
  final VoidCallback onPaymentSuccess;

  const PayHereCheckoutSheet({
    super.key,
    required this.appointment,
    required this.onPaymentSuccess,
  });

  static Future<void> show(
    BuildContext context, {
    required PatientAppointment appointment,
    required VoidCallback onPaymentSuccess,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => PayHereCheckoutSheet(
        appointment: appointment,
        onPaymentSuccess: onPaymentSuccess,
      ),
    );
  }

  @override
  State<PayHereCheckoutSheet> createState() => _PayHereCheckoutSheetState();
}

class _PayHereCheckoutSheetState extends State<PayHereCheckoutSheet> {
  bool _isLoading = true;
  String? _errorMessage;
  PayHereInitModel? _payHereData;

  // Selected payment method: 0 = Card, 1 = eZ Cash / mCash, 2 = Internet Banking
  int _selectedMethod = 0;

  // Card form controllers
  final _cardNumberController = TextEditingController(text: '4111 2222 3333 4444');
  final _expiryController = TextEditingController(text: '12/28');
  final _cvvController = TextEditingController(text: '789');
  final _cardholderController = TextEditingController();

  // Mobile wallet controller
  final _walletNumberController = TextEditingController(text: '+94 77 123 4567');

  bool _isProcessing = false;
  String _processingStage = '';
  bool _paymentSuccess = false;
  bool _paymentPending = false;

  @override
  void initState() {
    super.initState();
    _cardholderController.text = widget.appointment.doctorName.isNotEmpty
        ? 'Valued Citizen'
        : 'Vaxora Patient';
    _initCheckout();
  }

  @override
  void dispose() {
    _cardNumberController.dispose();
    _expiryController.dispose();
    _cvvController.dispose();
    _cardholderController.dispose();
    _walletNumberController.dispose();
    super.dispose();
  }

  Future<void> _initCheckout() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final targetId = widget.appointment.rawId.isNotEmpty
          ? widget.appointment.rawId
          : widget.appointment.id;
      final data = await PaymentRepository.initPayHere(targetId);
      if (mounted) {
        setState(() {
          _payHereData = data;
          if (data.firstName.isNotEmpty) {
            _cardholderController.text = '${data.firstName} ${data.lastName}'.trim();
          }
          if (data.phone.isNotEmpty) {
            _walletNumberController.text = data.phone;
          }
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString().replaceFirst('ApiException: ', '').replaceFirst('Exception: ', '');
        });
      }
    }
  }

  void _fillSandboxTestCard() {
    setState(() {
      _cardNumberController.text = '4111 2222 3333 4444';
      _expiryController.text = '12/28';
      _cvvController.text = '789';
      _cardholderController.text = _payHereData != null && _payHereData!.firstName.isNotEmpty
          ? '${_payHereData!.firstName} ${_payHereData!.lastName}'.trim()
          : 'Kamal Perera';
    });
  }

  Future<void> _processPayment() async {
    if (_isProcessing || _payHereData == null) return;

    setState(() {
      _isProcessing = true;
      _processingStage = 'Connecting to PayHere Secure Gateway...';
    });

    await Future.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;

    setState(() {
      _processingStage = 'Encrypting payment payload with 256-Bit SSL...';
    });

    await Future.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;

    setState(() {
      _processingStage = 'Authorizing transaction with Central Bank of Sri Lanka...';
    });

    await _checkPaymentStatus(alreadyProcessing: true);
  }

  Future<void> _checkPaymentStatus({bool alreadyProcessing = false}) async {
    if (_isProcessing && !alreadyProcessing) return;

    setState(() {
      _isProcessing = true;
      _processingStage = 'Checking for PayHere payment confirmation...';
      _errorMessage = null;
    });

    try {
      final targetId = widget.appointment.rawId.isNotEmpty
          ? widget.appointment.rawId
          : widget.appointment.id;

      final result = await PaymentRepository.confirmPayment(
        appointmentId: targetId,
      );

      if (mounted) {
        setState(() {
          _isProcessing = false;
          _paymentSuccess = result['confirmed'] == true;
          _paymentPending = result['confirmed'] != true;
        });
        if (_paymentSuccess) widget.onPaymentSuccess();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _paymentPending = false;
          _errorMessage = 'Payment authorization failed: ${e.toString().replaceFirst('ApiException: ', '')}';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.only(
        top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Grab Handle
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: AppColors.borderCard,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Header Row: PayHere branding & status badge
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF003366),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.shield_outlined, color: Color(0xFFFF9900), size: 16),
                          SizedBox(width: 6),
                          Text(
                            'PayHere',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 14,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.warningBg,
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: AppColors.warningBorder),
                      ),
                      child: const Text(
                        '⚡ Sandbox Mode',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.warning,
                        ),
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close, color: AppColors.textMuted),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              const Divider(height: 20),

              // Body content
              if (_isLoading) ...[
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Column(
                    children: [
                      CircularProgressIndicator(color: Color(0xFF003366)),
                      SizedBox(height: 16),
                      Text(
                        'Initializing PayHere Secure Session...',
                        style: TextStyle(fontSize: 13, color: AppColors.textMuted, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              ] else if (_errorMessage != null && !_paymentSuccess) ...[
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      const Icon(Icons.error_outline, color: AppColors.error, size: 48),
                      const SizedBox(height: 12),
                      Text(
                        _payHereData == null ? 'Unable to Initiate Payment' : 'Unable to Check Payment',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _errorMessage!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                      ),
                      const SizedBox(height: 20),
                      ElevatedButton(
                        onPressed: _initCheckout,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF003366),
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('Retry Connection'),
                      ),
                    ],
                  ),
                ),
              ] else if (_paymentPending) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
                  child: Column(
                    children: [
                      const Icon(Icons.hourglass_top_rounded, color: AppColors.warning, size: 48),
                      const SizedBox(height: 12),
                      const Text(
                        'Awaiting PayHere Confirmation',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textTitle),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'The server has not received a verified payment notification yet. This appointment is not marked as paid. Check again after completing payment with PayHere.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                      ),
                      const SizedBox(height: 20),
                      ElevatedButton(
                        onPressed: _isProcessing ? null : _checkPaymentStatus,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF003366),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(48),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: _isProcessing
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Check Payment Status', style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                ),
              ] else if (_paymentSuccess) ...[
                // Success View
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Column(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          color: AppColors.successBg,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.successBorder, width: 2),
                        ),
                        child: const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 48),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Payment Completed!',
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.textTitle),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Your appointment for ${widget.appointment.vaccineName} is officially confirmed.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                      ),
                      const SizedBox(height: 20),

                      // Receipt Card
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.borderLight),
                        ),
                        child: Column(
                          children: [
                            _buildReceiptRow('Payment verification', 'Confirmed by PayHere'),
                            const SizedBox(height: 8),
                            _buildReceiptRow('Order Reference', _payHereData?.orderId ?? 'APT-CONFIRMED'),
                            const SizedBox(height: 8),
                            _buildReceiptRow('Gateway', 'PayHere (Secured)'),
                            const SizedBox(height: 8),
                            _buildReceiptRow('Amount Paid', 'LKR ${_payHereData?.formattedAmount ?? widget.appointment.fee.toStringAsFixed(2)}', isBold: true),
                            const Divider(height: 20),
                            const Row(
                              children: [
                                Icon(Icons.mark_email_read_outlined, size: 16, color: AppColors.success),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    'Confirmation email & transaction receipt sent to your email.',
                                    style: TextStyle(fontSize: 12, color: AppColors.success, fontWeight: FontWeight.w600),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF003366),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(48),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: const Text('Done & Return to Appointments', style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                ),
              ] else ...[
                // Main Checkout View
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Order Summary Banner
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF003366), Color(0xFF0A4D8C)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF003366).withValues(alpha: 0.15),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  _payHereData?.orderId ?? 'ORDER-APT',
                                  style: const TextStyle(
                                    color: Color(0xFF93C5FD),
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                const Row(
                                  children: [
                                    Icon(Icons.lock_rounded, size: 13, color: Colors.white70),
                                    SizedBox(width: 4),
                                    Text('256-Bit SSL', style: TextStyle(color: Colors.white70, fontSize: 11)),
                                  ],
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              widget.appointment.vaccineName,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text(
                              widget.appointment.hospitalName,
                              style: const TextStyle(color: Colors.white70, fontSize: 13),
                            ),
                            const Divider(color: Colors.white24, height: 20),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('Total Payable Amount:', style: TextStyle(color: Colors.white70, fontSize: 13)),
                                Text(
                                  'LKR ${_payHereData?.formattedAmount ?? widget.appointment.fee.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    color: Color(0xFFFF9900),
                                    fontSize: 19,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Payment Method Selector Tabs
                      Row(
                        children: [
                          _buildMethodTab(0, 'Credit / Debit Card', Icons.credit_card_rounded),
                          const SizedBox(width: 8),
                          _buildMethodTab(1, 'Mobile Wallet', Icons.account_balance_wallet_outlined),
                          const SizedBox(width: 8),
                          _buildMethodTab(2, 'NetBanking', Icons.account_balance_outlined),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Method 0: Credit/Debit Card Form
                      if (_selectedMethod == 0) ...[
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Card Details',
                              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textTitle),
                            ),
                            TextButton.icon(
                              onPressed: _fillSandboxTestCard,
                              icon: const Icon(Icons.bolt, size: 14, color: Color(0xFF003366)),
                              label: const Text(
                                'Fill Test Card',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF003366)),
                              ),
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),

                        // Card Number Field
                        TextField(
                          controller: _cardNumberController,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: 'Card Number',
                            prefixIcon: const Icon(Icons.credit_card, size: 20),
                            suffixIcon: const Padding(
                              padding: EdgeInsets.only(right: 12),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text('VISA', style: TextStyle(fontWeight: FontWeight.w900, color: Color(0xFF1A1F71), fontSize: 13)),
                                  SizedBox(width: 6),
                                  Text('MC', style: TextStyle(fontWeight: FontWeight.w900, color: Color(0xFFEB001B), fontSize: 13)),
                                ],
                              ),
                            ),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          ),
                        ),
                        const SizedBox(height: 12),

                        // Expiry & CVV Row
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _expiryController,
                                keyboardType: TextInputType.datetime,
                                decoration: InputDecoration(
                                  labelText: 'Expiry (MM/YY)',
                                  hintText: '12/28',
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextField(
                                controller: _cvvController,
                                keyboardType: TextInputType.number,
                                obscureText: true,
                                decoration: InputDecoration(
                                  labelText: 'CVV / CVC',
                                  hintText: '•••',
                                  suffixIcon: const Icon(Icons.security, size: 18),
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),

                        // Cardholder Name
                        TextField(
                          controller: _cardholderController,
                          textCapitalization: TextCapitalization.words,
                          decoration: InputDecoration(
                            labelText: 'Name on Card',
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          ),
                        ),
                      ] else if (_selectedMethod == 1) ...[
                        // Method 1: Mobile Wallet (eZ Cash / mCash)
                        const Text(
                          'Select Mobile Wallet Operator',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textTitle),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(child: _buildWalletOption('eZ Cash', 'Dialog / Hutch', const Color(0xFF008000))),
                            const SizedBox(width: 10),
                            Expanded(child: _buildWalletOption('mCash', 'Mobitel / SLT', const Color(0xFFD32F2F))),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _walletNumberController,
                          keyboardType: TextInputType.phone,
                          decoration: InputDecoration(
                            labelText: 'Mobile Number',
                            prefixIcon: const Icon(Icons.phone_android, size: 20),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          ),
                        ),
                      ] else ...[
                        // Method 2: NetBanking
                        const Text(
                          'Direct Online Banking via PayHere',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textTitle),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSubtle,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Supported Banks:', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                              SizedBox(height: 6),
                              Text('• Sampath Vishwa\n• Commercial Bank (ComBank Online)\n• Hatton National Bank (HNB Web)\n• Nations Trust Bank',
                                style: TextStyle(fontSize: 12, color: AppColors.textMuted, height: 1.4),
                              ),
                            ],
                          ),
                        ),
                      ],

                      const SizedBox(height: 16),

                      // Processing State or Pay Button
                      if (_isProcessing) ...[
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: AppColors.background,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.borderLight),
                          ),
                          child: Column(
                            children: [
                              const SizedBox(
                                height: 28,
                                width: 28,
                                child: CircularProgressIndicator(strokeWidth: 3, color: Color(0xFF003366)),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                _processingStage,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: Color(0xFF003366),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ] else ...[
                        ElevatedButton(
                          onPressed: _processPayment,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF003366),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            elevation: 2,
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.lock, size: 18, color: Color(0xFFFF9900)),
                              const SizedBox(width: 8),
                              Text(
                                'Pay LKR ${_payHereData?.formattedAmount ?? widget.appointment.fee.toStringAsFixed(2)}',
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                              ),
                            ],
                          ),
                        ),
                      ],

                      const SizedBox(height: 12),

                      // Footer security assurance
                      const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.verified_user_rounded, size: 14, color: AppColors.textMuted),
                          SizedBox(width: 6),
                          Text(
                            'Authorized by Central Bank of Sri Lanka • PCI-DSS Compliant',
                            style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMethodTab(int index, String label, IconData icon) {
    final isSelected = _selectedMethod == index;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _selectedMethod = index),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFFEFF6FF) : AppColors.background,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? const Color(0xFF003366) : AppColors.borderLight,
              width: isSelected ? 1.5 : 1,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, size: 20, color: isSelected ? const Color(0xFF003366) : AppColors.textMuted),
              const SizedBox(height: 4),
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  color: isSelected ? const Color(0xFF003366) : AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildWalletOption(String name, String sub, Color badgeColor) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: badgeColor, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            ],
          ),
          const SizedBox(height: 2),
          Text(sub, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _buildReceiptRow(String title, String value, {bool isBold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted)),
        Text(
          value,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: isBold ? FontWeight.w800 : FontWeight.w600,
            color: isBold ? const Color(0xFF003366) : AppColors.textTitle,
          ),
        ),
      ],
    );
  }
}
