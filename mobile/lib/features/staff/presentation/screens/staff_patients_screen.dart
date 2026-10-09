import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_constants.dart';
import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/repositories/staff_repository.dart';
import '../widgets/clinical_context_panel.dart';
import '../widgets/network_avatar.dart';
import '../widgets/staff_common_widgets.dart';

/// Staff patient history search — mirrors web Doctor/Nurse Patients tab.
class StaffPatientsScreen extends StatefulWidget {
  const StaffPatientsScreen({super.key});

  @override
  State<StaffPatientsScreen> createState() => _StaffPatientsScreenState();
}

class _StaffPatientsScreenState extends State<StaffPatientsScreen> {
  final _search = TextEditingController();
  String _displayName = 'Staff';
  String? _photoUrl;
  List<Map<String, dynamic>> _results = [];
  Map<String, dynamic>? _selected;
  bool _searching = false;
  bool _loadingDetail = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final user = await StorageService.getUser();
    if (!mounted || user == null) return;
    setState(() {
      _displayName = user['name']?.toString().trim().isNotEmpty == true
          ? user['name'].toString().trim()
          : 'Staff';
      _photoUrl = resolveMediaUrl(user['profilePhotoUrl']?.toString());
    });
  }

  Future<void> _runSearch() async {
    final q = _search.text.trim();
    if (q.length < 2) {
      setState(() => _error = 'Enter at least 2 characters.');
      return;
    }
    setState(() {
      _searching = true;
      _error = null;
      _selected = null;
    });
    try {
      final response = await ApiClient.get(
        ApiConstants.clinicalPatientsSearch,
        queryParams: {'q': q, 'limit': '20'},
      );
      final list = response is List
          ? response
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        _results = list;
        _searching = false;
        if (list.isEmpty) _error = 'No patients matched that search.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _searching = false;
        _error = e is ApiException ? e.message : 'Search failed.';
        _results = [];
      });
    }
  }

  Future<void> _openPatient(Map<String, dynamic> row) async {
    final vaxoraId = row['vaxoraId']?.toString() ??
        row['vaxoraID']?.toString() ??
        row['registrationNumber']?.toString();
    setState(() {
      _loadingDetail = true;
      _error = null;
    });
    try {
      Map<String, dynamic> detail = Map<String, dynamic>.from(row);
      if (vaxoraId != null && vaxoraId.isNotEmpty) {
        final response = await ApiClient.get(
          ApiConstants.clinicalPatientByVaxoraId(vaxoraId),
        );
        if (response is Map<String, dynamic>) detail = response;
      }
      if (!mounted) return;
      setState(() {
        _selected = detail;
        _loadingDetail = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingDetail = false;
        _selected = row;
        _error = e is ApiException
            ? e.message
            : 'Could not load full profile — showing search hit.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileId = _selected?['patientProfileId']?.toString();

    return Scaffold(
      backgroundColor: StaffSurfaces.pageBg,
      appBar: StaffScreenHeader.appBar(
        displayName: _displayName,
        subtitle: 'Clinical · Patient history',
        photoUrl: _photoUrl,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
        children: [
          StaffPageIntro(
            eyebrow: 'Records',
            title: 'Patient history',
            subtitle: 'Search by name, NIC, phone, or Vaxora ID.',
            stats: const [],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _runSearch(),
            decoration: InputDecoration(
              hintText: 'Search patients…',
              filled: true,
              fillColor: StaffSurfaces.softPanel,
              prefixIcon: Icon(Icons.search, color: StaffSurfaces.brandSoft),
              suffixIcon: IconButton(
                icon: const Icon(Icons.arrow_forward_rounded),
                onPressed: _searching ? null : _runSearch,
              ),
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
                borderSide:
                    const BorderSide(color: StaffSurfaces.cta, width: 1.4),
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: TextStyle(
                color: _results.isEmpty ? AppColors.error : StaffSurfaces.textSecondary,
                fontWeight: FontWeight.w600,
                fontSize: 12.5,
              ),
            ),
          ],
          const SizedBox(height: 14),
          if (_searching || _loadingDetail)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: CircularProgressIndicator(color: StaffSurfaces.brandSoft),
              ),
            )
          else if (_selected != null) ...[
            TextButton.icon(
              onPressed: () => setState(() => _selected = null),
              icon: const Icon(Icons.arrow_back, size: 18),
              label: const Text('Back to results'),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: StaffSurfaces.card(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _selected!['name']?.toString() ??
                        _selected!['fullName']?.toString() ??
                        'Patient',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: StaffSurfaces.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    [
                      if ((_selected!['vaxoraId'] ?? '').toString().isNotEmpty)
                        'ID ${_selected!['vaxoraId']}',
                      if ((_selected!['nic'] ?? '').toString().isNotEmpty)
                        'NIC ${_selected!['nic']}',
                      if ((_selected!['phone'] ?? '').toString().isNotEmpty)
                        _selected!['phone'].toString(),
                    ].join(' · '),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: StaffSurfaces.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            ClinicalContextPanel(patientProfileId: profileId),
            const SizedBox(height: 8),
            FutureBuilder<List<Map<String, dynamic>>>(
              future: profileId == null || profileId.isEmpty
                  ? Future.value(const [])
                  : StaffRepository.getVaccinationTimeline(profileId),
              builder: (context, snap) {
                final rows = snap.data ?? const [];
                if (snap.connectionState == ConnectionState.waiting) {
                  return const SizedBox.shrink();
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StaffSectionHeader(
                      title: 'Vaccination timeline',
                      count: rows.length,
                    ),
                    if (rows.isEmpty)
                      const StaffEmptyCard(
                        message: 'No vaccination records on file.',
                        icon: Icons.vaccines_outlined,
                      )
                    else
                      ...rows.take(20).map((v) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(12),
                            decoration: StaffSurfaces.card(),
                            child: Text(
                              '${v['vaccineName'] ?? 'Vaccine'} · dose ${v['doseNumber'] ?? '—'}'
                              '${v['administeredAt'] != null ? ' · ${v['administeredAt']}' : ''}',
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: StaffSurfaces.textPrimary,
                              ),
                            ),
                          ),
                        );
                      }),
                  ],
                );
              },
            ),
          ] else if (_results.isNotEmpty) ...[
            StaffSectionHeader(title: 'Results', count: _results.length),
            ..._results.map((row) {
              final name = row['name']?.toString() ??
                  row['fullName']?.toString() ??
                  'Patient';
              final meta = [
                row['vaxoraId']?.toString(),
                row['nic']?.toString(),
                row['phone']?.toString(),
              ].where((e) => e != null && e.trim().isNotEmpty).join(' · ');
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => _openPatient(row),
                    borderRadius:
                        BorderRadius.circular(StaffSurfaces.cardRadius),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: StaffSurfaces.card(),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  name,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    color: StaffSurfaces.textPrimary,
                                  ),
                                ),
                                if (meta.isNotEmpty)
                                  Text(
                                    meta,
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      color: StaffSurfaces.textSecondary,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          Icon(
                            Icons.chevron_right,
                            color: StaffSurfaces.brandSoft,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}
