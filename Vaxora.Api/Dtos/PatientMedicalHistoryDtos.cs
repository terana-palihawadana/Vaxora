using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

// ==================== RESPONSE DTOs ====================

public class PatientMedicalHistoryDto
{
    public Guid Id { get; set; }
    public Guid PatientProfileId { get; set; }
    public string RecordType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Severity { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Icd10Code { get; set; }
    public DateTime DiagnosedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public Guid? RecordedByUserId { get; set; }
    public string RecordedByName { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public class PatientMedicalTimelineDto
{
    public Guid PatientProfileId { get; set; }
    public string PatientName { get; set; } = string.Empty;
    public string NicNumber { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string? PhoneNumber { get; set; }
    public int TotalRecords { get; set; }
    public int ActiveConditions { get; set; }
    public int CriticalOrSevere { get; set; }
    public List<PatientMedicalHistoryDto> Records { get; set; } = new();
}

// ==================== REQUEST DTOs ====================

public class CreatePatientMedicalHistoryDto
{
    [Required]
    public string RecordType { get; set; } = "Diagnosis";

    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    [Required]
    public string Severity { get; set; } = "Info";

    public string? Status { get; set; }

    [MaxLength(20)]
    public string? Icd10Code { get; set; }

    public DateTime? DiagnosedAt { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }
}

public class UpdatePatientMedicalHistoryDto
{
    [MaxLength(2000)]
    public string? Description { get; set; }

    [Required]
    public string Severity { get; set; } = "Info";

    [Required]
    public string Status { get; set; } = "Active";

    [MaxLength(20)]
    public string? Icd10Code { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public bool MarkResolved { get; set; } = false;
}
