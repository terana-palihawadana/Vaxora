using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IClinicalPatientService
{
    Task<List<ClinicalPatientSearchResultDto>> SearchPatientsAsync(
        string query,
        Guid viewerUserId,
        int limit = 10);
    Task<ClinicalPatientDetailDto> GetPatientByVaxoraIdAsync(
        string vaxoraId,
        Guid viewerUserId);
    Task<List<ClinicalRecentUpdateDto>> GetRecentDosageUpdatesAsync(Guid viewerUserId, int limit = 10);
    Task<ClinicalPendingVaccineDto> UpdatePrescribedDosageAsync(Guid doctorUserId, Guid appointmentId, UpdatePrescribedDosageDto dto);
}

public class ClinicalPatientService : IClinicalPatientService
{
    private static readonly HashSet<string> PendingStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Confirmed",
        "PendingPayment"
    };

    private readonly ApplicationDbContext _context;
    private readonly IClinicalScopeService _clinicalScope;
    private readonly ILogger<ClinicalPatientService> _logger;

    public ClinicalPatientService(
        ApplicationDbContext context,
        ILogger<ClinicalPatientService> logger,
        IClinicalScopeService? clinicalScope = null)
    {
        _context = context;
        _clinicalScope = clinicalScope ?? new ClinicalScopeService(context);
        _logger = logger;
    }

    public async Task<List<ClinicalPatientSearchResultDto>> SearchPatientsAsync(
        string query,
        Guid viewerUserId,
        int limit = 10)
    {
        var term = query?.Trim() ?? string.Empty;
        if (term.Length < 2)
            return new List<ClinicalPatientSearchResultDto>();

        limit = Math.Clamp(limit, 1, 20);
        var like = $"%{term}%";
        var viewer = await GetActiveClinicalViewerAsync(viewerUserId);
        if (viewer == null)
            return new List<ClinicalPatientSearchResultDto>();

        var allowedHospitalProfileIds = await GetHospitalProfileIdsAsync(viewer);
        if (allowedHospitalProfileIds.Length == 0)
            return new List<ClinicalPatientSearchResultDto>();

        var patientQuery = _context.PatientProfiles
            .AsNoTracking()
            .Include(p => p.User)
            .Where(p =>
                p.User.Status == UserStatus.Active &&
                p.User.Role == UserRole.PATIENT &&
                (
                    (p.User.RegistrationNumber != null && EF.Functions.ILike(p.User.RegistrationNumber, like)) ||
                    EF.Functions.ILike(p.FullName, like) ||
                    EF.Functions.ILike(p.NicNumber, like) ||
                    EF.Functions.ILike(p.User.Email, like)
                ) &&
                (
                    _context.Appointments.AsNoTracking().Any(a =>
                        a.PatientProfileId == p.Id &&
                        a.HospitalProfileId.HasValue &&
                        allowedHospitalProfileIds.Contains(a.HospitalProfileId.Value)) ||
                    _context.PatientVisits.AsNoTracking().Any(v =>
                        v.PatientProfileId == p.Id &&
                        v.HospitalProfileId.HasValue &&
                        allowedHospitalProfileIds.Contains(v.HospitalProfileId.Value))
                ));

        var patients = await patientQuery
            .OrderBy(p => p.FullName)
            .Take(limit)
            .ToListAsync();

        await LogClinicalPhiViewAsync(
            viewerUserId,
            "CLINICAL_PATIENT_SEARCH",
            $"Searched patients queryLength={term.Length} resultCount={patients.Count}");

        return patients.Select(p => new ClinicalPatientSearchResultDto
        {
            PatientProfileId = p.Id,
            PatientUserId = p.UserId,
            VaxoraId = p.User.RegistrationNumber ?? string.Empty,
            Name = p.FullName,
            Nic = p.NicNumber,
            Email = p.User.Email,
            Phone = p.PhoneNumber ?? p.User.PhoneNumber
        }).ToList();
    }

    public async Task<ClinicalPatientDetailDto> GetPatientByVaxoraIdAsync(
        string vaxoraId,
        Guid viewerUserId)
    {
        var reg = (vaxoraId ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(reg))
            throw new InvalidOperationException("Vaxora ID is required.");

        var patient = await _context.PatientProfiles
            .AsNoTracking()
            .Include(p => p.User)
            .FirstOrDefaultAsync(p =>
                p.User.RegistrationNumber != null &&
                p.User.RegistrationNumber.ToUpper() == reg)
            ?? throw new KeyNotFoundException("No patient found with that Vaxora ID.");

        if (patient.User.Role != UserRole.PATIENT)
            throw new InvalidOperationException("The provided Vaxora ID does not belong to a patient.");

        var viewer = await GetActiveClinicalViewerAsync(viewerUserId);
        if (viewer == null || !await _clinicalScope.CanAccessPatientAsync(
                viewerUserId,
                viewer.Role.ToString(),
                patient.Id))
        {
            // Keep inaccessible records indistinguishable from unknown IDs.
            throw new KeyNotFoundException("No patient found with that Vaxora ID.");
        }

        var history = await _context.PatientVaccinationRecords
            .AsNoTracking()
            .Include(r => r.Vaccine)
            .Where(r => r.PatientProfileId == patient.Id)
            .OrderByDescending(r => r.AdministeredAt)
            .ToListAsync();

        var pendingAppointments = await _context.Appointments
            .AsNoTracking()
            .Where(a =>
                a.PatientUserId == patient.UserId &&
                PendingStatuses.Contains(a.Status))
            .OrderBy(a => a.AppointmentDate)
            .ThenBy(a => a.StartTime)
            .ToListAsync();

        // Overdue (missed) visits first so clinicians clear them before today's queue.
        var today = StaffDutyHelper.HospitalToday();
        pendingAppointments = pendingAppointments
            .OrderByDescending(a => a.AppointmentDate < today)
            .ThenBy(a => a.AppointmentDate)
            .ThenBy(a => a.StartTime)
            .ToList();

        await LogClinicalPhiViewAsync(
            viewerUserId,
            "CLINICAL_PATIENT_DETAIL_VIEW",
            $"Viewed patient profile vaxoraId={reg} patientUserId={patient.UserId}");

        return new ClinicalPatientDetailDto
        {
            PatientProfileId = patient.Id,
            PatientUserId = patient.UserId,
            VaxoraId = patient.User.RegistrationNumber ?? string.Empty,
            Nic = patient.NicNumber,
            Name = patient.FullName,
            Email = patient.User.Email,
            Phone = patient.PhoneNumber ?? patient.User.PhoneNumber,
            VaccinationHistory = history.Select(r => new ClinicalVaccinationHistoryItemDto
            {
                Id = r.Id,
                Vaccine = r.Vaccine?.Name ?? "Unknown",
                Date = r.AdministeredAt.ToString("yyyy-MM-dd"),
                Location = r.AdministeredByName ?? "Recorded clinic",
                Status = "Completed",
                DoseNumber = r.DoseNumber
            }).ToList(),
            PendingVaccines = pendingAppointments.Select(MapPending).ToList()
        };
    }

    public async Task<List<ClinicalRecentUpdateDto>> GetRecentDosageUpdatesAsync(Guid viewerUserId, int limit = 10)
    {
        var viewer = await GetActiveClinicalViewerAsync(viewerUserId);
        if (viewer == null)
            return new List<ClinicalRecentUpdateDto>();

        var allowedHospitalProfileIds = await GetHospitalProfileIdsAsync(viewer);
        if (allowedHospitalProfileIds.Length == 0)
            return new List<ClinicalRecentUpdateDto>();

        limit = Math.Clamp(limit, 1, 20);

        var updates = await _context.Appointments
            .AsNoTracking()
            .Include(a => a.PatientUser)
            .Where(a =>
                a.DosageUpdatedAt != null &&
                !string.IsNullOrWhiteSpace(a.PrescribedDosage) &&
                a.HospitalProfileId.HasValue &&
                allowedHospitalProfileIds.Contains(a.HospitalProfileId.Value))
            .OrderByDescending(a => a.DosageUpdatedAt)
            .Take(limit)
            .ToListAsync();

        return updates.Select(a => new ClinicalRecentUpdateDto
        {
            AppointmentId = a.Id,
            VaxoraId = a.PatientUser?.RegistrationNumber ?? string.Empty,
            PatientName = a.PatientName,
            Vaccine = a.VaccineName,
            Dosage = a.PrescribedDosage,
            PrescribedBy = a.PrescribedByDoctorName,
            UpdatedAt = a.DosageUpdatedAt!.Value,
            RelativeTime = ToRelativeTime(a.DosageUpdatedAt.Value)
        }).ToList();
    }

    private async Task<User?> GetActiveClinicalViewerAsync(Guid viewerUserId)
    {
        return await _context.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u =>
                u.Id == viewerUserId &&
                u.Status == UserStatus.Active &&
                (u.Role == UserRole.DOCTOR || u.Role == UserRole.NURSE));
    }

    private async Task<Guid[]> GetHospitalProfileIdsAsync(User viewer)
    {
        var ids = await _clinicalScope.GetHospitalProfileIdsAsync(viewer.Id, viewer.Role.ToString());
        return ids?.ToArray() ?? Array.Empty<Guid>();
    }

    public async Task<ClinicalPendingVaccineDto> UpdatePrescribedDosageAsync(
        Guid doctorUserId,
        Guid appointmentId,
        UpdatePrescribedDosageDto dto)
    {
        var dosage = (dto.Dosage ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(dosage))
            throw new InvalidOperationException("Dosage is required.");

        if (dosage.Length > 100)
            throw new InvalidOperationException("Dosage cannot exceed 100 characters.");

        var doctor = await _context.Users
            .Include(u => u.DoctorProfile)
            .FirstOrDefaultAsync(u => u.Id == doctorUserId);

        if (doctor == null || doctor.Role != UserRole.DOCTOR)
            throw new UnauthorizedAccessException("Only doctors can prescribe dosage.");

        if (doctor.Status != UserStatus.Active)
            throw new InvalidOperationException("Doctor account must be Active.");

        var appointment = await _context.Appointments
            .FirstOrDefaultAsync(a => a.Id == appointmentId)
            ?? throw new KeyNotFoundException("Appointment not found.");

        var isAffiliated = await _context.StaffAffiliations.AsNoTracking().AnyAsync(a =>
            a.StaffUserId == doctorUserId &&
            a.HospitalUserId == appointment.HospitalUserId &&
            a.StaffRole == UserRole.DOCTOR &&
            a.Status == AffiliationStatus.Active);

        if (!isAffiliated)
            throw new UnauthorizedAccessException("You are not affiliated with this hospital.");

        await StaffDutyHelper.EnsureStaffOnDutyAsync(_context, doctorUserId, appointment.HospitalUserId);

        if (string.Equals(appointment.Status, "Completed", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Cannot edit dosage for completed, cancelled, or rejected appointments.");
        }

        // Once the nurse has started, the prescription is locked so the recorded dose
        // always matches what was given. Return the patient to the queue to change it.
        if (string.Equals(appointment.Status, "Administering", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Observation", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Administration has already started, so the dose is locked. Return the patient to the queue to change it.");
        }

        // Past incomplete visits need to be closed or rebooked — not prescribed retrospectively.
        var today = StaffDutyHelper.HospitalToday();
        if (appointment.AppointmentDate < today)
        {
            throw new InvalidOperationException(
                "This visit date has already passed. Mark it missed or ask the patient to rebook before prescribing dosage.");
        }

        var doctorName = doctor.DoctorProfile?.FullName is { Length: > 0 } name
            ? StaffNameFormatter.WithRolePrefix(name, "Dr.")
            : doctor.Email;

        appointment.PrescribedDosage = dosage;
        appointment.PrescribedByDoctorUserId = doctorUserId;
        appointment.PrescribedByDoctorName = doctorName;
        appointment.DosageUpdatedAt = DateTime.UtcNow;
        appointment.UpdatedAt = DateTime.UtcNow;
        appointment.DoctorUserId ??= doctorUserId;
        appointment.DoctorName ??= doctorName;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = doctorUserId,
            UserEmail = doctor.Email,
            Role = "DOCTOR",
            Action = "DOSAGE_PRESCRIBED",
            Details = $"Doctor set dosage '{dosage}' for appointment {appointment.Id} ({appointment.VaccineName}) patient {appointment.PatientName}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        _logger.LogInformation(
            "Doctor {DoctorId} prescribed dosage '{Dosage}' on appointment {AppointmentId}",
            doctorUserId, dosage, appointmentId);

        return MapPending(appointment);
    }

    private async Task LogClinicalPhiViewAsync(Guid viewerUserId, string action, string details)
    {
        var viewer = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == viewerUserId);
        if (viewer == null)
            return;

        var text = details.Length > 1000 ? details[..1000] : details;
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = viewerUserId,
            UserEmail = viewer.Email,
            Role = viewer.Role.ToString(),
            Action = action,
            Details = text,
            Timestamp = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();
    }

    private static ClinicalPendingVaccineDto MapPending(Appointment a)
    {
        var today = StaffDutyHelper.HospitalToday();
        var isOverdue = a.AppointmentDate < today;
        return new ClinicalPendingVaccineDto
        {
            Id = a.Id,
            Vaccine = a.VaccineName,
            Date = a.AppointmentDate.ToString("yyyy-MM-dd"),
            Time = a.TimeSlot,
            Location = a.HospitalName,
            Dosage = a.PrescribedDosage,
            PrescribedBy = a.PrescribedByDoctorName,
            Status = isOverdue ? "Missed" : a.Status,
            IsOverdue = isOverdue
        };
    }

    private static string ToRelativeTime(DateTime utc)
    {
        var span = DateTime.UtcNow - utc;
        if (span.TotalMinutes < 1) return "Just now";
        if (span.TotalMinutes < 60) return $"{(int)span.TotalMinutes} min ago";
        if (span.TotalHours < 24) return $"{(int)span.TotalHours} hour{(span.TotalHours >= 2 ? "s" : "")} ago";
        if (span.TotalDays < 7) return $"{(int)span.TotalDays} day{(span.TotalDays >= 2 ? "s" : "")} ago";
        return utc.ToString("yyyy-MM-dd");
    }
}
