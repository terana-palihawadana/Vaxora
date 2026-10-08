using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IPatientVaccinationService
{
    Task<PatientVaccinationTimelineDto> GetTimelineAsync(Guid patientProfileId);
    Task<PatientVaccinationRecordDto> GetByIdAsync(Guid id);
    Task<PatientVaccinationRecordDto> CreateAsync(Guid actorUserId, Guid patientProfileId, CreatePatientVaccinationDto dto);
    Task<bool> IsOwnedByUserAsync(Guid patientProfileId, Guid userId);
}

public class PatientVaccinationService : IPatientVaccinationService
{
    private readonly ApplicationDbContext _context;
    private readonly IClinicalScopeService _scope;
    private readonly ILogger<PatientVaccinationService> _logger;

    public PatientVaccinationService(ApplicationDbContext context, IClinicalScopeService scope, ILogger<PatientVaccinationService> logger)
    {
        _context = context;
        _scope = scope;
        _logger = logger;
    }

    public async Task<PatientVaccinationTimelineDto> GetTimelineAsync(Guid patientProfileId)
    {
        var patient = await _context.PatientProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == patientProfileId)
            ?? throw new KeyNotFoundException("Patient profile not found.");

        var records = await _context.PatientVaccinationRecords
            .AsNoTracking()
            .Where(r => r.PatientProfileId == patientProfileId)
            .Include(r => r.Vaccine)
            .OrderByDescending(r => r.AdministeredAt)
            .ToListAsync();

        return new PatientVaccinationTimelineDto
        {
            PatientProfileId = patient.Id,
            PatientName = patient.FullName,
            NicNumber = patient.NicNumber,
            TotalDoses = records.Count,
            DistinctVaccines = records.Select(r => r.VaccineId).Distinct().Count(),
            LastVaccinatedAt = records.FirstOrDefault()?.AdministeredAt,
            Records = records.Select(MapToDto).ToList()
        };
    }

    public async Task<PatientVaccinationRecordDto> GetByIdAsync(Guid id)
    {
        var record = await _context.PatientVaccinationRecords
            .AsNoTracking()
            .Include(r => r.Vaccine)
            .FirstOrDefaultAsync(r => r.Id == id)
            ?? throw new KeyNotFoundException("Vaccination record not found.");

        return MapToDto(record);
    }

    public async Task<PatientVaccinationRecordDto> CreateAsync(Guid actorUserId, Guid patientProfileId, CreatePatientVaccinationDto dto)
    {
        var patient = await _context.PatientProfiles
            .FirstOrDefaultAsync(p => p.Id == patientProfileId)
            ?? throw new KeyNotFoundException("Patient profile not found.");

        var vaccine = await _context.Vaccines
            .FirstOrDefaultAsync(v => v.Id == dto.VaccineId)
            ?? throw new KeyNotFoundException("Vaccine not found.");

        if (!Enum.TryParse<VaccineRoute>(dto.Route, true, out var route))
            throw new InvalidOperationException("Invalid route. Valid values: Intramuscular, Subcutaneous, Intradermal, Oral, Nasal.");

        InjectionSite? site = null;
        if (!string.IsNullOrWhiteSpace(dto.Site))
        {
            if (!Enum.TryParse<InjectionSite>(dto.Site, true, out var parsedSite))
                throw new InvalidOperationException("Invalid injection site.");
            site = parsedSite;
        }

        var (actorName, actorEmail) = await GetActorInfoAsync(actorUserId);

        Batch? batch = null;
        if (dto.BatchId.HasValue)
        {
            batch = await _context.Batches
                .Include(b => b.Vaccine)
                .FirstOrDefaultAsync(b => b.Id == dto.BatchId.Value)
                ?? throw new KeyNotFoundException("Batch not found.");

            var actorRole = await _context.Users.Where(u => u.Id == actorUserId).Select(u => u.Role.ToString()).FirstOrDefaultAsync() ?? string.Empty;
            if (!await _scope.CanActForHospitalAsync(actorUserId, actorRole, batch.HospitalProfileId))
                throw new UnauthorizedAccessException("The selected batch belongs to a different hospital.");

            if (batch.VaccineId != vaccine.Id)
                throw new InvalidOperationException("The selected batch does not match the vaccine being administered.");

            if (batch.ExpiryDate < DateTime.UtcNow)
                throw new InvalidOperationException($"Batch {batch.BatchNumber} has expired.");

            if (!InventoryDoseHelper.HasUsableDose(batch))
                throw new InvalidOperationException($"Batch {batch.BatchNumber} has no doses remaining.");

            InventoryDoseHelper.ConsumeOneDose(batch, vaccine);

            _context.InventoryTransactions.Add(new InventoryTransaction
            {
                BatchId = batch.Id,
                Type = TransactionType.Issue,
                Quantity = 1,
                Reason = $"Administered 1 dose to patient {patient.NicNumber} ({patient.FullName})",
                PerformedByUserId = actorUserId,
                PerformedByName = actorName
            });
        }

        var administeredAt = dto.AdministeredAt.HasValue
            ? EnsureUtc(dto.AdministeredAt.Value)
            : DateTime.UtcNow;

        var record = new PatientVaccinationRecord
        {
            PatientProfileId = patient.Id,
            VaccineId = vaccine.Id,
            BatchId = batch?.Id,
            AdministeredByUserId = actorUserId,
            AdministeredByName = actorName,
            AdministeredAt = administeredAt,
            DoseNumber = dto.DoseNumber,
            Route = route,
            Site = site,
            LotNumber = string.IsNullOrWhiteSpace(dto.LotNumber) ? batch?.BatchNumber : dto.LotNumber,
            Notes = dto.Notes,
            AdverseEventReported = dto.AdverseEventReported,
            AdverseEventNotes = dto.AdverseEventNotes
        };

        _context.PatientVaccinationRecords.Add(record);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actorEmail,
            Role = "STAFF",
            Action = "VACCINATION_RECORDED",
            Details = $"Recorded {vaccine.Name} (dose {dto.DoseNumber}) for patient {patient.NicNumber} ({patient.FullName})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        record.Vaccine = vaccine;
        _logger.LogInformation("Recorded vaccination {RecordId} for patient {PatientId}", record.Id, patient.Id);

        return MapToDto(record);
    }

    private async Task<(string Name, string Email)> GetActorInfoAsync(Guid userId)
    {
        var user = await _context.Users
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null) return ("System", "system@vaxora.local");

        var name = user.DoctorProfile?.FullName is { Length: > 0 } docName ? StaffNameFormatter.WithRolePrefix(docName, "Dr.")
            : user.NurseProfile?.FullName is { Length: > 0 } nurseName ? StaffNameFormatter.WithRolePrefix(nurseName, "Nurse")
            : user.HospitalProfile?.HospitalName
            ?? user.Email;

        return (name, user.Email);
    }

    private static DateTime EnsureUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static PatientVaccinationRecordDto MapToDto(PatientVaccinationRecord r) => new()
    {
        Id = r.Id,
        PatientProfileId = r.PatientProfileId,
        VaccineId = r.VaccineId,
        VaccineName = r.Vaccine?.Name ?? "Unknown",
        Manufacturer = r.Vaccine?.Manufacturer ?? "Unknown",
        Category = r.Vaccine?.Category.ToString() ?? "Routine",
        DoseNumber = r.DoseNumber,
        Route = r.Route.ToString(),
        Site = r.Site?.ToString(),
        LotNumber = r.LotNumber,
        Notes = r.Notes,
        AdministeredAt = r.AdministeredAt,
        AdministeredByName = r.AdministeredByName ?? "Unknown",
        AdministeredByUserId = r.AdministeredByUserId,
        BatchId = r.BatchId,
        AdverseEventReported = r.AdverseEventReported,
        AdverseEventNotes = r.AdverseEventNotes,
        CreatedAt = r.CreatedAt
    };

    public async Task<bool> IsOwnedByUserAsync(Guid patientProfileId, Guid userId)
    {
        return await _context.PatientProfiles
            .AsNoTracking()
            .AnyAsync(p => p.Id == patientProfileId && p.UserId == userId);
    }
}
