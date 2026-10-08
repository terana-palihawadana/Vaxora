import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';

class ReviewItem {
  final int id;
  final String name;
  final String comment;
  final String role;

  const ReviewItem({
    required this.id,
    required this.name,
    required this.comment,
    required this.role,
  });
}

class ReviewsCarousel extends StatefulWidget {
  const ReviewsCarousel({super.key});

  @override
  State<ReviewsCarousel> createState() => _ReviewsCarouselState();
}

class _ReviewsCarouselState extends State<ReviewsCarousel> {
  final PageController _pageController = PageController();
  int _currentIndex = 0;

  static const List<ReviewItem> reviews = [
    ReviewItem(
      id: 1,
      name: 'Kumar',
      comment: 'thank you for the services',
      role: 'Verified Citizen',
    ),
    ReviewItem(
      id: 2,
      name: 'Anura',
      comment: "It's more helpful for me",
      role: 'Patient',
    ),
    ReviewItem(
      id: 3,
      name: 'Kajol',
      comment: 'thank you',
      role: 'Parent',
    ),
    ReviewItem(
      id: 4,
      name: 'Dr. Dilshan',
      comment: 'Seamless scheduling and verified digital vaccination records.',
      role: 'Medical Officer',
    ),
    ReviewItem(
      id: 5,
      name: 'Nimali',
      comment: 'Got my booster dose reminder right on time. Highly recommended!',
      role: 'Verified Citizen',
    ),
    ReviewItem(
      id: 6,
      name: 'Tharindu',
      comment: 'Quick booking process with clear hospital directions and timely alerts.',
      role: 'Patient',
    ),
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _nextPage() {
    if (_currentIndex < reviews.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _pageController.animateToPage(
        0,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  void _prevPage() {
    if (_currentIndex > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _pageController.animateToPage(
        reviews.length - 1,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Watch our user reviews',
                style: AppTextStyles.h2,
              ),
              Row(
                children: [
                  IconButton(
                    onPressed: _prevPage,
                    icon: const Icon(Icons.arrow_back_ios_new, size: 16),
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.surfaceSubtle,
                      side: const BorderSide(color: AppColors.borderLight),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: _nextPage,
                    icon: const Icon(Icons.arrow_forward_ios, size: 16),
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.surfaceSubtle,
                      side: const BorderSide(color: AppColors.borderLight),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Swipeable Cards PageView
          SizedBox(
            height: 160,
            child: PageView.builder(
              controller: _pageController,
              itemCount: reviews.length,
              onPageChanged: (index) {
                setState(() {
                  _currentIndex = index;
                });
              },
              itemBuilder: (context, index) {
                final review = reviews[index];
                return Padding(
                  padding: const EdgeInsets.only(right: 6, bottom: 6),
                  child: Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.borderLight, width: 1.5),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primaryDark.withValues(alpha: 0.05),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              radius: 16,
                              backgroundColor: AppColors.brandBlue.withValues(alpha: 0.1),
                              child: Text(
                                review.name.isNotEmpty ? review.name[0] : 'U',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.brandBlue,
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  review.name,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.textTitle,
                                  ),
                                ),
                                Text(
                                  review.role,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: AppColors.textMuted,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          '"${review.comment}"',
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.textBody,
                            fontStyle: FontStyle.italic,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 14),

          // Dots Indicator
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              reviews.length,
              (index) => Container(
                margin: const EdgeInsets.symmetric(horizontal: 4),
                width: _currentIndex == index ? 22 : 7,
                height: 7,
                decoration: BoxDecoration(
                  color: _currentIndex == index
                      ? AppColors.brandBlue
                      : AppColors.borderCard,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
