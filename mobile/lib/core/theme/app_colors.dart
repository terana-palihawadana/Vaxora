import 'package:flutter/material.dart';

class AppColors {
  // Brand & Primary
  static const Color primary = Color(0xFF087F78);
  static const Color primaryHover = Color(0xFF066D68);
  static const Color primaryDark = Color(0xFF12384B);
  static const Color primaryDeep = Color(0xFF0B2C3D);
  static const Color brandBlue = Color(0xFF123E5D);
  static const Color accent = Color(0xFF168B91);
  static const Color accentTeal = Color(0xFF087F78);

  // Background & Surfaces
  static const Color background = Color(0xFFF5F8F7);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceSubtle = Color(0xFFF1F6F4);
  static const Color inputBg = Color(0xFFF8FAF9);
  static const Color inputAuthBg = Color(0xFFF6F9F7);

  // Borders
  static const Color borderLight = Color(0xFFE1E9E6);
  static const Color borderCard = Color(0xFFD5E1DD);
  static const Color borderPill = Color(0xFFD5E1DD);
  static const Color borderFocus = Color(0xFF087F78);
  static const Color borderAuthCard = Color(0xFFD5E4DF);
  static const Color borderAuthInput = Color(0xFFD5E1DD);

  // Typography
  static const Color textTitle = Color(0xFF12384B);
  static const Color textSubtitle = Color(0xFF087F78);
  static const Color textBody = Color(0xFF354E59);
  static const Color textMuted = Color(0xFF667B83);
  static const Color textPlaceholder = Color(0xFF7B8E94);
  static const Color textInverse = Color(0xFFFFFFFF);

  // Status
  static const Color success = Color(0xFF238252);
  static const Color successBg = Color(0xFFEDF7F0);
  static const Color successBorder = Color(0xFFC3E3CF);
  static const Color error = Color(0xFFB54743);
  static const Color errorBg = Color(0xFFFFF1EF);
  static const Color errorBorder = Color(0xFFFECACA);
  static const Color info = Color(0xFF276D82);
  static const Color infoBg = Color(0xFFEDF6F8);
  static const Color infoBorder = Color(0xFFC7E0E7);
  static const Color warning = Color(0xFFB2660A);
  static const Color warningBg = Color(0xFFFFF4E5);
  static const Color warningBorder = Color(0xFFF5B168);

  // AI assistant accents
  static const Color ai = Color(0xFF6D5BAE);
  static const Color aiBg = Color(0xFFEDE9F8);
  static const Color aiBorder = Color(0xFFDCD4F0);

  // Star ratings
  static const Color rating = Color(0xFFF59E0B);

  // Gradients
  static const LinearGradient authButtonGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Color(0xFF0B8279),
      Color(0xFF066D68),
    ],
  );
}
