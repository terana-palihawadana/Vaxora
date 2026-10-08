using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IClinicalScopeService
{
    /// <summary>Hospital profile ids the user may act for. Null means unrestricted (ADMIN).</summary>
    Task<IReadOnlyList<Guid>?> GetHospitalProfileIdsAsync(Guid userId, string role);

    /// <summary>True when the user is allowed to view or record clinical data for the patient.</summary>
    Task<bool> CanAccessPatientAsync(Guid userId, string role, Guid patientProfileId);

    /// <summary>True when the user is allowed to act for the given hospital profile.</summary>
    Task<bool> CanActForHospitalAsync(Guid userId, string role, Guid hospitalProfileId);
}

public class ClinicalScopeService : IClinicalScopeService
{
    private readonly ApplicationDbContext _context;

    public ClinicalScopeService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<IReadOnlyList<Guid>?> GetHospitalProfileIdsAsync(Guid userId, string role)
    {
        if (string.Equals(role, "ADMIN", StringComparison.OrdinalIgnoreCase))
            return null;

        if (string.Equals(role, "HOSPITAL", StringComparison.OrdinalIgnoreCase))
        {
            return await _context.HospitalProfiles.AsNoTracking()
                .Where(h => h.UserId == userId)
                .Select(h => h.Id)
                .ToListAsync();
        }

        if (string.Equals(role, "DOCTOR", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(role, "NURSE", StringComparison.OrdinalIgnoreCase))
        {
            var hospitalUserIds = _context.StaffAffiliations.AsNoTracking()
                .Where(a => a.StaffUserId == userId && a.Status == AffiliationStatus.Active)
                .Select(a => a.HospitalUserId);

            return await _context.HospitalProfiles.AsNoTracking()
                .Where(h => hospitalUserIds.Contains(h.UserId))
                .Select(h => h.Id)
                .ToListAsync();
        }

        return Array.Empty<Guid>();
    }

    public async Task<bool> CanActForHospitalAsync(Guid userId, string role, Guid hospitalProfileId)
    {
        var ids = await GetHospitalProfileIdsAsync(userId, role);
        return ids == null || ids.Contains(hospitalProfileId);
    }

    public async Task<bool> CanAccessPatientAsync(Guid userId, string role, Guid patientProfileId)
    {
        var ids = await GetHospitalProfileIdsAsync(userId, role);
        if (ids == null) return true;
        if (ids.Count == 0) return false;

        var hasAppointment = await _context.Appointments.AsNoTracking().AnyAsync(a =>
            a.PatientProfileId == patientProfileId &&
            a.HospitalProfileId != null && ids.Contains(a.HospitalProfileId.Value));
        if (hasAppointment) return true;

        return await _context.PatientVisits.AsNoTracking().AnyAsync(v =>
            v.PatientProfileId == patientProfileId &&
            v.HospitalProfileId != null && ids.Contains(v.HospitalProfileId.Value));
    }
}
