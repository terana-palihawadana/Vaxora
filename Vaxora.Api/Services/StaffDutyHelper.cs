using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

/// <summary>
/// Shared hospital-local wall-clock and duty checks for clinical staff actions.
/// Shift dates/times are hospital wall-clock (+05:30), matching StaffManagementService.
///
/// Duty model (mirrors real clinics): the roster plans who should work, clock-in
/// proves who is actually present. Staff are on duty when they have a live rostered
/// shift OR have clocked in (DutyStatus = OnDuty) within the last
/// <see cref="ClockInValidity"/>. OnBreak always means not on duty. Clock-in covers
/// walk-ins outside rostered hours.
/// </summary>
public static class StaffDutyHelper
{
    private static readonly TimeSpan HospitalUtcOffset = TimeSpan.FromHours(5.5);

    /// <summary>A forgotten clock-out expires after one long shift.</summary>
    public static readonly TimeSpan ClockInValidity = TimeSpan.FromHours(12);

    public static DateTime HospitalNow() => DateTime.UtcNow + HospitalUtcOffset;

    public static DateOnly HospitalToday() => DateOnly.FromDateTime(HospitalNow());

    /// <summary>True when a manual clock-in is still valid at <paramref name="utcNow"/>.</summary>
    public static bool IsClockedIn(DutyStatus status, DateTime? dutyUpdatedAtUtc, DateTime utcNow) =>
        status == DutyStatus.OnDuty &&
        dutyUpdatedAtUtc.HasValue &&
        utcNow - dutyUpdatedAtUtc.Value < ClockInValidity;

    /// <summary>
    /// Affiliation ids (from <paramref name="affiliationIds"/>) that are on duty right now.
    /// </summary>
    public static async Task<HashSet<Guid>> GetOnDutyAffiliationIdsAsync(
        ApplicationDbContext context,
        IReadOnlyCollection<Guid> affiliationIds,
        CancellationToken cancellationToken = default)
    {
        if (affiliationIds.Count == 0) return new HashSet<Guid>();

        var today = HospitalToday();
        var now = TimeOnly.FromDateTime(HospitalNow());
        var utcNow = DateTime.UtcNow;

        var affiliations = await context.StaffAffiliations
            .AsNoTracking()
            .Where(a => affiliationIds.Contains(a.Id) && a.Status == AffiliationStatus.Active)
            .Select(a => new { a.Id, a.DutyStatus, a.DutyUpdatedAt })
            .ToListAsync(cancellationToken);

        var liveShiftIds = (await context.StaffShifts
                .AsNoTracking()
                .Where(s =>
                    affiliationIds.Contains(s.AffiliationId) &&
                    s.ShiftDate == today &&
                    s.StartTime <= now &&
                    s.EndTime > now)
                .Select(s => s.AffiliationId)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        return affiliations
            .Where(a =>
                a.DutyStatus != DutyStatus.OnBreak &&
                (liveShiftIds.Contains(a.Id) || IsClockedIn(a.DutyStatus, a.DutyUpdatedAt, utcNow)))
            .Select(a => a.Id)
            .ToHashSet();
    }

    /// <summary>
    /// True when the staff member has an Active affiliation at the hospital and is on
    /// duty there now (live shift or valid clock-in, and not on break).
    /// </summary>
    public static async Task<bool> IsStaffOnDutyAsync(
        ApplicationDbContext context,
        Guid staffUserId,
        Guid hospitalUserId,
        CancellationToken cancellationToken = default)
    {
        var affiliationIds = await context.StaffAffiliations
            .AsNoTracking()
            .Where(a =>
                a.StaffUserId == staffUserId &&
                a.HospitalUserId == hospitalUserId &&
                a.Status == AffiliationStatus.Active)
            .Select(a => a.Id)
            .ToListAsync(cancellationToken);

        var onDuty = await GetOnDutyAffiliationIdsAsync(context, affiliationIds, cancellationToken);
        return onDuty.Count > 0;
    }

    public static async Task EnsureStaffOnDutyAsync(
        ApplicationDbContext context,
        Guid staffUserId,
        Guid hospitalUserId,
        CancellationToken cancellationToken = default)
    {
        var onDuty = await IsStaffOnDutyAsync(context, staffUserId, hospitalUserId, cancellationToken);
        if (!onDuty)
        {
            throw new InvalidOperationException(
                "You are not on duty at this hospital. Clock in (or start your rostered shift) before clinical actions.");
        }
    }

    /// <summary>
    /// True when any Active affiliated doctor/nurse is on duty at the hospital now.
    /// </summary>
    public static async Task<bool> HasAnyStaffOnDutyAsync(
        ApplicationDbContext context,
        Guid hospitalUserId,
        CancellationToken cancellationToken = default)
    {
        var affiliationIds = await context.StaffAffiliations
            .AsNoTracking()
            .Where(a => a.HospitalUserId == hospitalUserId && a.Status == AffiliationStatus.Active)
            .Select(a => a.Id)
            .ToListAsync(cancellationToken);

        var onDuty = await GetOnDutyAffiliationIdsAsync(context, affiliationIds, cancellationToken);
        return onDuty.Count > 0;
    }

    public static async Task EnsureHospitalHasOnDutyStaffAsync(
        ApplicationDbContext context,
        Guid hospitalUserId,
        CancellationToken cancellationToken = default)
    {
        var onDuty = await HasAnyStaffOnDutyAsync(context, hospitalUserId, cancellationToken);
        if (!onDuty)
        {
            throw new InvalidOperationException(
                "At least one affiliated doctor or nurse must be on duty before clinical administration.");
        }
    }
}
