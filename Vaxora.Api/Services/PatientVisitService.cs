using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IPatientVisitService
{
    Task<PatientVisitTimelineDto> GetTimelineAsync(Guid patientProfileId);
    Task<List<PatientVisitDto>> GetUpcomingFollowUpsAsync(Guid patientProfileId);
    Task<PatientVisitDto> GetByIdAsync(Guid id);
    Task<PatientVisitSummaryDto> GetSummaryAsync(Guid id);
    Task<PatientVisitDto> CreateAsync(Guid actorUserId, Guid patientProfileId, CreatePatientVisitDto dto);
    Task<PatientVisitDto> UpdateAsync(Guid actorUserId, Guid id, UpdatePatientVisitDto dto);
    Task DeleteAsync(Guid actorUserId, Guid id);
    Task<bool> IsOwnedByUserAsync(Guid patientProfileId, Guid userId);
}

public class PatientVisitService : IPatientVisitService
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<PatientVisitService> _logger;

    public PatientVisitService(ApplicationDbContext context, ILogger<PatientVisitService> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<PatientVisitTimelineDto> GetTimelineAsync(Guid patientProfileId)
    {
        var patient = await _context.PatientProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == patientProfileId)
            ?? throw new KeyNotFoundException("Patient profile not found.");

        var visits = await _context.PatientVisits
            .AsNoTracking()
            .Include(v => v.PatientProfile)
            .Where(v => v.PatientProfileId == patientProfileId)
            .OrderByDescending(v => v.VisitDate)
            .ToListAsync();

        var nextFollowUp = visits
            .Where(v => v.FollowUpDate.HasValue && v.FollowUpDate.Value > DateTime.UtcNow)
            .OrderBy(v => v.FollowUpDate)
            .FirstOrDefault()?.FollowUpDate;

        return new PatientVisitTimelineDto
        {
            PatientProfileId = patient.Id,
            PatientName = patient.FullName,
            NicNumber = patient.NicNumber,
            TotalVisits = visits.Count,
            LastVisitDate = visits.FirstOrDefault()?.VisitDate,
            NextFollowUpDate = nextFollowUp,
            Visits = visits.Select(MapToDto).ToList()
        };
    }

    public async Task<List<PatientVisitDto>> GetUpcomingFollowUpsAsync(Guid patientProfileId)
    {
        var visits = await _context.PatientVisits
            .AsNoTracking()
            .Include(v => v.PatientProfile)
            .Where(v => v.PatientProfileId == patientProfileId
                        && v.FollowUpDate.HasValue
                        && v.FollowUpDate.Value >= DateTime.UtcNow)
            .OrderBy(v => v.FollowUpDate)
            .ToListAsync();

        return visits.Select(MapToDto).ToList();
    }

    public async Task<PatientVisitDto> GetByIdAsync(Guid id)
    {
        var visit = await _context.PatientVisits
            .AsNoTracking()
            .Include(v => v.PatientProfile)
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException("Visit not found.");

        return MapToDto(visit);
    }

    public async Task<PatientVisitSummaryDto> GetSummaryAsync(Guid id)
    {
        var visit = await _context.PatientVisits
            .AsNoTracking()
            .Include(v => v.PatientProfile)
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException("Visit not found.");

        var age = 0;
        if (visit.PatientProfile?.DateOfBirth is DateTime dob)
        {
            age = DateTime.UtcNow.Year - dob.Year;
            if (DateTime.UtcNow.Date < dob.Date.AddYears(age)) age--;
        }

        var vitals = new List<string>();
        if (!string.IsNullOrWhiteSpace(visit.BloodPressure)) vitals.Add($"BP {visit.BloodPressure}");
        if (!string.IsNullOrWhiteSpace(visit.Temperature)) vitals.Add($"Temp {visit.Temperature}°C");
        if (!string.IsNullOrWhiteSpace(visit.HeartRate)) vitals.Add($"HR {visit.HeartRate} bpm");
        if (!string.IsNullOrWhiteSpace(visit.WeightKg)) vitals.Add($"Wt {visit.WeightKg} kg");
        if (!string.IsNullOrWhiteSpace(visit.HeightCm)) vitals.Add($"Ht {visit.HeightCm} cm");
        if (!string.IsNullOrWhiteSpace(visit.OxygenSaturation)) vitals.Add($"SpO2 {visit.OxygenSaturation}%");

        return new PatientVisitSummaryDto
        {
            VisitId = visit.Id,
            VisitDate = visit.VisitDate,
            VisitType = visit.VisitType.ToString(),
            Status = visit.Status.ToString(),
            PatientName = visit.PatientProfile?.FullName ?? "Unknown",
            PatientNic = visit.PatientProfile?.NicNumber ?? "Unknown",
            PatientPhone = visit.PatientProfile?.PhoneNumber,
            DoctorName = visit.DoctorName,
            HospitalName = visit.HospitalProfile?.HospitalName,
            ChiefComplaint = visit.ChiefComplaint,
            VitalsSummary = vitals.Count > 0 ? string.Join(" • ", vitals) : null,
            DiagnosisSummary = visit.DiagnosisSummary,
            TreatmentPlan = visit.TreatmentPlan,
            FollowUpDate = visit.FollowUpDate,
            AgeYears = age
        };
    }

    public async Task<PatientVisitDto> CreateAsync(Guid actorUserId, Guid patientProfileId, CreatePatientVisitDto dto)
    {
        var patient = await _context.PatientProfiles
            .FirstOrDefaultAsync(p => p.Id == patientProfileId)
            ?? throw new KeyNotFoundException("Patient profile not found.");

        if (!Enum.TryParse<VisitType>(dto.VisitType, true, out var visitType))
            throw new InvalidOperationException("Invalid visit type.");

        var status = VisitStatus.Completed;
        if (!string.IsNullOrWhiteSpace(dto.Status) && !Enum.TryParse(dto.Status, true, out status))
            throw new InvalidOperationException("Invalid status.");

        await ValidateLinksAsync(patient.Id, dto);

        var (actorName, actorEmail) = await GetActorInfoAsync(actorUserId);

        var visitDate = dto.VisitDate.HasValue ? EnsureUtc(dto.VisitDate.Value) : DateTime.UtcNow;
        var followUp = dto.FollowUpDate.HasValue ? EnsureUtc(dto.FollowUpDate.Value) : (DateTime?)null;

        var visit = new PatientVisit
        {
            PatientProfileId = patient.Id,
            DoctorUserId = dto.DoctorUserId ?? actorUserId,
            DoctorName = dto.DoctorUserId.HasValue ? null : actorName,
            NurseUserId = dto.NurseUserId,
            HospitalProfileId = dto.HospitalProfileId,
            AppointmentId = dto.AppointmentId,
            VisitDate = visitDate,
            VisitType = visitType,
            Status = status,
            ChiefComplaint = dto.ChiefComplaint,
            BloodPressure = dto.BloodPressure,
            Temperature = dto.Temperature,
            WeightKg = dto.WeightKg,
            HeightCm = dto.HeightCm,
            HeartRate = dto.HeartRate,
            OxygenSaturation = dto.OxygenSaturation,
            DiagnosisSummary = dto.DiagnosisSummary,
            TreatmentPlan = dto.TreatmentPlan,
            Notes = dto.Notes,
            FollowUpDate = followUp
        };

        _context.PatientVisits.Add(visit);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "PATIENT_VISIT_RECORDED",
            Details = $"Recorded {visitType} visit for patient {patient.NicNumber} ({patient.FullName})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        _logger.LogInformation("Created visit {VisitId} for patient {PatientId}", visit.Id, patient.Id);

        return MapToDto(visit);
    }

    private async Task ValidateLinksAsync(Guid patientProfileId, CreatePatientVisitDto dto)
    {
        if (dto.AppointmentId.HasValue)
        {
            var appointment = await _context.Appointments.AsNoTracking()
                .Where(a => a.Id == dto.AppointmentId.Value)
                .Select(a => new { a.PatientProfileId, a.HospitalProfileId })
                .FirstOrDefaultAsync()
                ?? throw new InvalidOperationException("Appointment not found.");

            if (appointment.PatientProfileId != patientProfileId)
                throw new InvalidOperationException("Appointment does not belong to this patient.");

            if (dto.HospitalProfileId.HasValue && appointment.HospitalProfileId != dto.HospitalProfileId)
                throw new InvalidOperationException("Appointment belongs to a different hospital.");
        }

        var clinicianIds = new[] { dto.DoctorUserId, dto.NurseUserId }
            .Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
        if (clinicianIds.Count == 0 || !dto.HospitalProfileId.HasValue) return;

        var hospitalUserId = await _context.HospitalProfiles.AsNoTracking()
            .Where(h => h.Id == dto.HospitalProfileId.Value)
            .Select(h => (Guid?)h.UserId)
            .FirstOrDefaultAsync()
            ?? throw new InvalidOperationException("Hospital not found.");

        var affiliated = await _context.StaffAffiliations.AsNoTracking()
            .Where(a => a.HospitalUserId == hospitalUserId
                        && a.Status == AffiliationStatus.Active
                        && clinicianIds.Contains(a.StaffUserId))
            .Select(a => a.StaffUserId)
            .ToListAsync();

        if (clinicianIds.Any(id => !affiliated.Contains(id)))
            throw new InvalidOperationException("Assigned doctor or nurse is not an active staff member of this hospital.");
    }

    public async Task<bool> IsOwnedByUserAsync(Guid patientProfileId, Guid userId)
    {
        return await _context.PatientProfiles
            .AsNoTracking()
            .AnyAsync(p => p.Id == patientProfileId && p.UserId == userId);
    }

    public async Task<PatientVisitDto> UpdateAsync(Guid actorUserId, Guid id, UpdatePatientVisitDto dto)
    {
        var visit = await _context.PatientVisits
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException("Visit not found.");

        if (!Enum.TryParse<VisitType>(dto.VisitType, true, out var visitType))
            throw new InvalidOperationException("Invalid visit type.");

        if (!Enum.TryParse<VisitStatus>(dto.Status, true, out var status))
            throw new InvalidOperationException("Invalid status.");

        var (_, actorEmail) = await GetActorInfoAsync(actorUserId);

        visit.VisitType = visitType;
        visit.Status = status;
        visit.ChiefComplaint = dto.ChiefComplaint;
        visit.BloodPressure = dto.BloodPressure;
        visit.Temperature = dto.Temperature;
        visit.WeightKg = dto.WeightKg;
        visit.HeightCm = dto.HeightCm;
        visit.HeartRate = dto.HeartRate;
        visit.OxygenSaturation = dto.OxygenSaturation;
        visit.DiagnosisSummary = dto.DiagnosisSummary;
        visit.TreatmentPlan = dto.TreatmentPlan;
        visit.Notes = dto.Notes;
        visit.FollowUpDate = dto.FollowUpDate.HasValue ? EnsureUtc(dto.FollowUpDate.Value) : null;
        visit.UpdatedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "PATIENT_VISIT_UPDATED",
            Details = $"Updated visit {visit.Id} to status {status}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return MapToDto(visit);
    }

    public async Task DeleteAsync(Guid actorUserId, Guid id)
    {
        var visit = await _context.PatientVisits
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException("Visit not found.");

        var (_, actorEmail) = await GetActorInfoAsync(actorUserId);

        _context.PatientVisits.Remove(visit);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "PATIENT_VISIT_DELETED",
            Details = $"Deleted visit {visit.Id} for patient {visit.PatientProfileId}",
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
            name = $"Dr. {docName}";
        else if (user.NurseProfile?.FullName is { Length: > 0 } nurseName)
            name = $"Nurse {nurseName}";
        else
            name = user.Email;

        return (name, user.Email);
    }

    private static DateTime EnsureUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static PatientVisitDto MapToDto(PatientVisit v) => new()
    {
        Id = v.Id,
        PatientProfileId = v.PatientProfileId,
        PatientName = v.PatientProfile?.FullName ?? "Unknown",
        PatientNic = v.PatientProfile?.NicNumber ?? "Unknown",
        DoctorUserId = v.DoctorUserId,
        DoctorName = v.DoctorName,
        NurseUserId = v.NurseUserId,
        NurseName = v.NurseName,
        HospitalProfileId = v.HospitalProfileId,
        HospitalName = v.HospitalProfile?.HospitalName,
        AppointmentId = v.AppointmentId,
        VisitDate = v.VisitDate,
        VisitType = v.VisitType.ToString(),
        Status = v.Status.ToString(),
        ChiefComplaint = v.ChiefComplaint,
        BloodPressure = v.BloodPressure,
        Temperature = v.Temperature,
        WeightKg = v.WeightKg,
        HeightCm = v.HeightCm,
        HeartRate = v.HeartRate,
        OxygenSaturation = v.OxygenSaturation,
        DiagnosisSummary = v.DiagnosisSummary,
        TreatmentPlan = v.TreatmentPlan,
        Notes = v.Notes,
        FollowUpDate = v.FollowUpDate,
        CreatedAt = v.CreatedAt,
        UpdatedAt = v.UpdatedAt
    };
}
