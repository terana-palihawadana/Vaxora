using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IPatientMedicalHistoryService
{
    Task<PatientMedicalTimelineDto> GetTimelineAsync(Guid patientProfileId);
    Task<List<PatientMedicalHistoryDto>> GetActiveConditionsAsync(Guid patientProfileId);
    Task<PatientMedicalHistoryDto> GetByIdAsync(Guid id);
    Task<bool> IsOwnedByUserAsync(Guid patientProfileId, Guid userId);
    Task<bool> IsRecordOwnedByUserAsync(Guid recordId, Guid userId);
    Task<PatientMedicalHistoryDto> CreateAsync(Guid actorUserId, Guid patientProfileId, CreatePatientMedicalHistoryDto dto);
    Task<PatientMedicalHistoryDto> UpdateAsync(Guid actorUserId, Guid id, UpdatePatientMedicalHistoryDto dto);
    Task DeleteAsync(Guid actorUserId, Guid id);
}

public class PatientMedicalHistoryService : IPatientMedicalHistoryService
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<PatientMedicalHistoryService> _logger;

    public PatientMedicalHistoryService(ApplicationDbContext context, ILogger<PatientMedicalHistoryService> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<PatientMedicalTimelineDto> GetTimelineAsync(Guid patientProfileId)
    {
        var patient = await _context.PatientProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == patientProfileId)
            ?? throw new KeyNotFoundException("Patient profile not found.");

        var records = await _context.PatientMedicalHistories
            .AsNoTracking()
            .Where(r => r.PatientProfileId == patientProfileId)
            .OrderByDescending(r => r.DiagnosedAt)
            .ToListAsync();

        return new PatientMedicalTimelineDto
        {
            PatientProfileId = patient.Id,
            PatientName = patient.FullName,
            NicNumber = patient.NicNumber,
            DateOfBirth = patient.DateOfBirth,
            PhoneNumber = patient.PhoneNumber,
            TotalRecords = records.Count,
            ActiveConditions = records.Count(r => r.Status == MedicalRecordStatus.Active || r.Status == MedicalRecordStatus.Chronic),
            CriticalOrSevere = records.Count(r => r.Severity == MedicalRecordSeverity.Severe || r.Severity == MedicalRecordSeverity.Critical),
            Records = records.Select(MapToDto).ToList()
        };
    }

    public async Task<List<PatientMedicalHistoryDto>> GetActiveConditionsAsync(Guid patientProfileId)
    {
        var records = await _context.PatientMedicalHistories
            .AsNoTracking()
            .Where(r => r.PatientProfileId == patientProfileId
                        && (r.Status == MedicalRecordStatus.Active || r.Status == MedicalRecordStatus.Chronic))
            .OrderByDescending(r => r.Severity)
            .ThenByDescending(r => r.DiagnosedAt)
            .ToListAsync();

        return records.Select(MapToDto).ToList();
    }

    public async Task<PatientMedicalHistoryDto> GetByIdAsync(Guid id)
    {
        var record = await _context.PatientMedicalHistories
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id)
            ?? throw new KeyNotFoundException("Medical history record not found.");

        return MapToDto(record);
    }

    public async Task<bool> IsOwnedByUserAsync(Guid patientProfileId, Guid userId)
    {
        return await _context.PatientProfiles
            .AsNoTracking()
            .AnyAsync(p => p.Id == patientProfileId && p.UserId == userId);
    }

    public async Task<bool> IsRecordOwnedByUserAsync(Guid recordId, Guid userId)
    {
        return await _context.PatientMedicalHistories
            .AsNoTracking()
            .AnyAsync(r => r.Id == recordId && r.PatientProfile.UserId == userId);
    }

    public async Task<PatientMedicalHistoryDto> CreateAsync(Guid actorUserId, Guid patientProfileId, CreatePatientMedicalHistoryDto dto)
    {
        var patient = await _context.PatientProfiles
            .FirstOrDefaultAsync(p => p.Id == patientProfileId)
            ?? throw new KeyNotFoundException("Patient profile not found.");

        if (!Enum.TryParse<MedicalRecordType>(dto.RecordType, true, out var type))
            throw new InvalidOperationException("Invalid record type.");

        if (!Enum.TryParse<MedicalRecordSeverity>(dto.Severity, true, out var severity))
            throw new InvalidOperationException("Invalid severity.");

        var status = MedicalRecordStatus.Active;
        if (!string.IsNullOrWhiteSpace(dto.Status) && !Enum.TryParse(dto.Status, true, out status))
            throw new InvalidOperationException("Invalid status.");

        var (actorName, actorEmail) = await GetActorInfoAsync(actorUserId);

        var diagnosedAt = dto.DiagnosedAt.HasValue
            ? EnsureUtc(dto.DiagnosedAt.Value)
            : DateTime.UtcNow;

        var record = new PatientMedicalHistory
        {
            PatientProfileId = patient.Id,
            RecordType = type,
            Title = dto.Title.Trim(),
            Description = dto.Description,
            Severity = severity,
            Status = status,
            Icd10Code = dto.Icd10Code,
            DiagnosedAt = diagnosedAt,
            RecordedByUserId = actorUserId,
            RecordedByName = actorName,
            Notes = dto.Notes
        };

        _context.PatientMedicalHistories.Add(record);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "MEDICAL_HISTORY_ADDED",
            Details = $"Added {type} '{dto.Title}' ({severity}) for patient {patient.NicNumber} ({patient.FullName})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        _logger.LogInformation("Created medical history {RecordId} for patient {PatientId}", record.Id, patient.Id);

        return MapToDto(record);
    }

    public async Task<PatientMedicalHistoryDto> UpdateAsync(Guid actorUserId, Guid id, UpdatePatientMedicalHistoryDto dto)
    {
        var record = await _context.PatientMedicalHistories
            .FirstOrDefaultAsync(r => r.Id == id)
            ?? throw new KeyNotFoundException("Medical history record not found.");

        if (!Enum.TryParse<MedicalRecordSeverity>(dto.Severity, true, out var severity))
            throw new InvalidOperationException("Invalid severity.");

        if (!Enum.TryParse<MedicalRecordStatus>(dto.Status, true, out var status))
            throw new InvalidOperationException("Invalid status.");

        var (_, actorEmail) = await GetActorInfoAsync(actorUserId);

        record.Description = dto.Description;
        record.Severity = severity;
        record.Status = status;
        record.Icd10Code = dto.Icd10Code;
        record.Notes = dto.Notes;
        record.UpdatedAt = DateTime.UtcNow;

        if (dto.MarkResolved && record.ResolvedAt is null
            && (status == MedicalRecordStatus.Resolved || status == MedicalRecordStatus.InRemission))
        {
            record.ResolvedAt = DateTime.UtcNow;
        }
        else if (status == MedicalRecordStatus.Active || status == MedicalRecordStatus.Chronic)
        {
            record.ResolvedAt = null;
        }

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "MEDICAL_HISTORY_UPDATED",
            Details = $"Updated medical record {record.Id} ({record.Title}) to status {status}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return MapToDto(record);
    }

    public async Task DeleteAsync(Guid actorUserId, Guid id)
    {
        var record = await _context.PatientMedicalHistories
            .FirstOrDefaultAsync(r => r.Id == id)
            ?? throw new KeyNotFoundException("Medical history record not found.");

        var (_, actorEmail) = await GetActorInfoAsync(actorUserId);

        _context.PatientMedicalHistories.Remove(record);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "MEDICAL_HISTORY_DELETED",
            Details = $"Deleted medical record {record.Id} ({record.Title}) for patient {record.PatientProfileId}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
    }

    private async Task<(string Name, string Email)> GetActorInfoAsync(Guid userId)
    {
        var user = await _context.Users
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null) return ("System", "system@vaxora.local");

        string name;
        if (user.DoctorProfile?.FullName is { Length: > 0 } docName)
        {
            name = StaffNameFormatter.WithRolePrefix(docName, "Dr.");
        }
        else if (user.NurseProfile?.FullName is { Length: > 0 } nurseName)
        {
            name = StaffNameFormatter.WithRolePrefix(nurseName, "Nurse");
        }
        else
        {
            name = user.Email;
        }

        return (name, user.Email);
    }

    private static DateTime EnsureUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static PatientMedicalHistoryDto MapToDto(PatientMedicalHistory r) => new()
    {
        Id = r.Id,
        PatientProfileId = r.PatientProfileId,
        RecordType = r.RecordType.ToString(),
        Title = r.Title,
        Description = r.Description,
        Severity = r.Severity.ToString(),
        Status = r.Status.ToString(),
        Icd10Code = r.Icd10Code,
        DiagnosedAt = r.DiagnosedAt,
        ResolvedAt = r.ResolvedAt,
        RecordedByUserId = r.RecordedByUserId,
        RecordedByName = r.RecordedByName ?? "Unknown",
        Notes = r.Notes,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt
    };
}
