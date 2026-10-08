import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/models/selected_file.dart';

export '../../data/models/selected_file.dart';

class FileUploadPickerBox extends StatefulWidget {
  final String label;
  final String placeholder;
  final bool isRequired;
  final String? initialFileName;
  final List<String>? allowedExtensions;
  final Function(SelectedFile? file)? onFileSelected;
  final Function(String fileName)? onLegacyFileSelected;

  const FileUploadPickerBox({
    super.key,
    required this.label,
    required this.placeholder,
    this.isRequired = false,
    this.initialFileName,
    this.allowedExtensions,
    this.onFileSelected,
    this.onLegacyFileSelected,
  });

  @override
  State<FileUploadPickerBox> createState() => _FileUploadPickerBoxState();
}

class _FileUploadPickerBoxState extends State<FileUploadPickerBox> {
  SelectedFile? _selectedFile;
  String? _displayName;

  @override
  void initState() {
    super.initState();
    _displayName = widget.initialFileName;
    if (widget.initialFileName != null && widget.initialFileName!.isNotEmpty) {
      _selectedFile = SelectedFile(name: widget.initialFileName!);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final XFile? picked = await picker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );

      if (picked != null) {
        List<int>? bytes;
        if (kIsWeb) {
          bytes = await picked.readAsBytes();
        }
        final file = SelectedFile(
          name: picked.name,
          path: picked.path,
          bytes: bytes,
        );

        setState(() {
          _selectedFile = file;
          _displayName = picked.name;
        });

        widget.onFileSelected?.call(file);
        widget.onLegacyFileSelected?.call(picked.name);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to pick image: $e'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  Future<void> _pickDocument() async {
    try {
      final extensions = widget.allowedExtensions ?? ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: extensions,
        withData: kIsWeb,
      );

      if (result != null && result.files.isNotEmpty) {
        final platformFile = result.files.first;
        final file = SelectedFile(
          name: platformFile.name,
          path: platformFile.path,
          bytes: platformFile.bytes,
          size: platformFile.size,
        );

        setState(() {
          _selectedFile = file;
          _displayName = platformFile.name;
        });

        widget.onFileSelected?.call(file);
        widget.onLegacyFileSelected?.call(platformFile.name);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to pick document: $e'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  void _clearFile() {
    setState(() {
      _selectedFile = null;
      _displayName = null;
    });
    widget.onFileSelected?.call(null);
  }

  void _handlePickFile() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.label,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textTitle,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf, color: AppColors.brandBlue),
                  title: const Text('Browse Files (PDF, Docs, Images)'),
                  subtitle: const Text('Upload documents or certificates from device'),
                  onTap: () async {
                    Navigator.pop(context);
                    await _pickDocument();
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library, color: AppColors.brandBlue),
                  title: const Text('Choose from Photo Gallery'),
                  subtitle: const Text('Select a photo or scanned copy'),
                  onTap: () async {
                    Navigator.pop(context);
                    await _pickImage(ImageSource.gallery);
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.camera_alt, color: AppColors.brandBlue),
                  title: const Text('Take Photo / Scan Document'),
                  subtitle: const Text('Capture live document with device camera'),
                  onTap: () async {
                    Navigator.pop(context);
                    await _pickImage(ImageSource.camera);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasFile = _selectedFile != null || (_displayName != null && _displayName!.isNotEmpty);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${widget.label} ${widget.isRequired ? '*' : ''}',
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textBody,
          ),
        ),
        const SizedBox(height: 5),
        InkWell(
          onTap: _handlePickFile,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.inputAuthBg,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: hasFile ? AppColors.brandBlue : AppColors.borderAuthInput,
                width: 1.5,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  hasFile ? Icons.check_circle : Icons.upload_file,
                  size: 20,
                  color: hasFile ? AppColors.success : AppColors.textBody,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _displayName ?? widget.placeholder,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: hasFile ? AppColors.textTitle : AppColors.textBody,
                    ),
                  ),
                ),
                if (hasFile) ...[
                  const SizedBox(width: 4),
                  InkWell(
                    onTap: _clearFile,
                    child: const Padding(
                      padding: EdgeInsets.all(4.0),
                      child: Icon(Icons.close, size: 18, color: AppColors.textMuted),
                    ),
                  ),
                ],
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppColors.borderAuthInput),
                  ),
                  child: const Text(
                    'Browse',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryDark,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
