using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IStaffManagementService
{
    Task<StaffAffiliationDto> InviteStaffAsync(Guid hospitalUserId, InviteStaffDto dto);
    Task<List<StaffCandidateDto>> SearchInviteCandidatesAsync(Guid hospitalUserId, string query, int limit = 10);
    Task<StaffAffiliationDto> RespondToInvitationAsync(Guid staffUserId, Guid affiliationId, AffiliationDecisionDto dto);
    Task<List<StaffAffiliationDto>> GetHospitalStaffAsync(Guid hospitalUserId, string? role = null, string? dutyStatus = null, string? search = null, string? status = null);
    Task<List<StaffAffiliationDto>> GetMyInvitationsAsync(Guid staffUserId);
    Task<List<StaffAffiliationDto>> GetMyAffiliationsAsync(Guid staffUserId);
    /// <summary>Removes staff from the roster and returns how many upcoming shifts were freed.</summary>
    Task<int> RemoveAffiliationAsync(Guid hospitalUserId, Guid affiliationId);
    Task<StaffAffiliationDto> UpdateDutyStatusAsync(Guid actorUserId, Guid affiliationId, UpdateDutyStatusDto dto);
    /// <summary>A doctor sets which hospital is primary and the hours offered to this one.</summary>
    Task<StaffAffiliationDto> UpdateMyAvailabilityAsync(Guid staffUserId, Guid affiliationId, UpdateStaffAvailabilityDto dto);
    Task<List<HospitalBoothDto>> GetHospitalBoothsAsync(Guid hospitalUserId, bool activeOnly = false);
    Task<HospitalBoothDto> CreateHospitalBoothAsync(Guid hospitalUserId, CreateHospitalBoothDto dto);
    Task<HospitalBoothDto> UpdateHospitalBoothAsync(Guid hospitalUserId, Guid boothId, UpdateHospitalBoothDto dto);
    Task DeactivateHospitalBoothAsync(Guid hospitalUserId, Guid boothId);
    Task<StaffShiftDto> CreateShiftAsync(Guid hospitalUserId, CreateStaffShiftDto dto);
    Task<List<StaffShiftDto>> GetHospitalShiftsAsync(Guid hospitalUserId, DateOnly? from = null, DateOnly? to = null);
    /// <summary>
    /// Busy blocks for this hospital's active staff across every affiliation (any hospital).
    /// Used so agents/UI do not propose shifts that CreateShift would reject for overlap.
    /// </summary>
    Task<List<StaffBusyBlockDto>> GetAffiliatedStaffBusyBlocksAsync(Guid hospitalUserId, DateOnly? from = null, DateOnly? to = null);
    Task<StaffCoverageReportDto> GetCoverageReportAsync(Guid hospitalUserId, DateOnly from, DateOnly to);
    /// <summary>Posted vaccine sessions in the range with who is rostered onto each.</summary>
    Task<List<RosterSessionDto>> GetRosterSessionsAsync(Guid hospitalUserId, DateOnly from, DateOnly to);
    /// <summary>Every active doctor and nurse, with whether they can staff this session.</summary>
    Task<List<SessionCandidateDto>> GetSessionCandidatesAsync(Guid hospitalUserId, Guid scheduleId, DateOnly date);
    /// <summary>Rosters staff onto a session; the shift takes the session's date, hours and booth.</summary>
    Task<RosterSessionDto> AssignSessionStaffAsync(Guid hospitalUserId, AssignSessionStaffDto dto);
    Task<SuggestWeekCoverageResultDto> SuggestWeekCoverageAsync(Guid hospitalUserId, SuggestWeekCoverageDto dto);
    Task<List<StaffShiftDto>> GetMyShiftsAsync(Guid staffUserId, DateOnly? from = null, DateOnly? to = null);
    Task<StaffShiftDto> UpdateShiftAsync(Guid hospitalUserId, Guid shiftId, UpdateStaffShiftDto dto);
    Task DeleteShiftAsync(Guid hospitalUserId, Guid shiftId);
}

public class StaffManagementService : IStaffManagementService
{
    /// <summary>
    /// Shift dates and times are hospital wall-clock values, so they must be compared
    /// against hospital local time rather than UTC. Audit timestamps stay UTC.
    /// </summary>
    private static readonly TimeSpan HospitalUtcOffset = TimeSpan.FromHours(5.5);

    private static DateTime HospitalNow() => DateTime.UtcNow + HospitalUtcOffset;
    private static DateOnly HospitalToday() => DateOnly.FromDateTime(HospitalNow());

    private readonly ApplicationDbContext _context;
    private readonly ILogger<StaffManagementService> _logger;

    public StaffManagementService(ApplicationDbContext context, ILogger<StaffManagementService> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<StaffAffiliationDto> InviteStaffAsync(Guid hospitalUserId, InviteStaffDto dto)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var regNumber = dto.RegistrationNumber.Trim().ToUpperInvariant();
        var staffUser = await _context.Users
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .FirstOrDefaultAsync(u => u.RegistrationNumber != null && u.RegistrationNumber.ToUpper() == regNumber);

        if (staffUser == null)
            throw new KeyNotFoundException("No user found with that Vaxora registration number.");

        if (staffUser.Role is not (UserRole.DOCTOR or UserRole.NURSE))
            throw new InvalidOperationException("Only doctors or nurses can be invited as hospital staff.");

        if (staffUser.Status != UserStatus.Active)
            throw new InvalidOperationException("Staff account must be Active (admin-approved) before invitation.");

        var existing = await _context.StaffAffiliations
            .FirstOrDefaultAsync(a =>
                a.HospitalUserId == hospitalUserId &&
                a.StaffUserId == staffUser.Id &&
                (a.Status == AffiliationStatus.Pending || a.Status == AffiliationStatus.Active));

        if (existing != null)
            throw new InvalidOperationException($"An affiliation already exists with status '{existing.Status}'.");

        // Nurses may only belong to one hospital (pending or active).
        if (staffUser.Role == UserRole.NURSE)
        {
            var nurseAlreadyLinked = await _context.StaffAffiliations.AnyAsync(a =>
                a.StaffUserId == staffUser.Id &&
                (a.Status == AffiliationStatus.Pending || a.Status == AffiliationStatus.Active));

            if (nurseAlreadyLinked)
                throw new InvalidOperationException(
                    "This nurse already has a pending or active hospital affiliation. Nurses can only work at one hospital.");
        }

        var hospital = await _context.Users
            .Include(u => u.HospitalProfile)
            .FirstAsync(u => u.Id == hospitalUserId);

        var affiliation = new StaffAffiliation
        {
            HospitalUserId = hospitalUserId,
            StaffUserId = staffUser.Id,
            StaffRole = staffUser.Role,
            Status = AffiliationStatus.Pending,
            DutyStatus = DutyStatus.Off,
            InvitedByUserId = hospitalUserId,
            InvitedAt = DateTime.UtcNow
        };

        _context.StaffAffiliations.Add(affiliation);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = "HOSPITAL",
            Action = "STAFF_INVITED",
            Details = $"Hospital invited {staffUser.Role} {staffUser.RegistrationNumber} ({staffUser.Email})"
        });

        await _context.SaveChangesAsync();
        _logger.LogInformation("Hospital {HospitalId} invited staff {StaffId}", hospitalUserId, staffUser.Id);

        return MapAffiliation(affiliation, hospital, staffUser);
    }

    public async Task<List<StaffCandidateDto>> SearchInviteCandidatesAsync(Guid hospitalUserId, string query, int limit = 10)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var term = query?.Trim() ?? string.Empty;
        if (term.Length < 2)
            return new List<StaffCandidateDto>();

        limit = Math.Clamp(limit, 1, 20);
        var like = $"%{term}%";

        var candidates = await _context.Users
            .AsNoTracking()
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Where(u =>
                u.Status == UserStatus.Active &&
                (u.Role == UserRole.DOCTOR || u.Role == UserRole.NURSE) &&
                (
                    (u.RegistrationNumber != null && EF.Functions.ILike(u.RegistrationNumber, like)) ||
                    EF.Functions.ILike(u.Email, like) ||
                    (u.DoctorProfile != null && EF.Functions.ILike(u.DoctorProfile.FullName, like)) ||
                    (u.NurseProfile != null && EF.Functions.ILike(u.NurseProfile.FullName, like))
                ))
            .OrderBy(u => u.Email)
            .Take(limit)
            .ToListAsync();

        var candidateIds = candidates.Select(c => c.Id).ToList();
        var singleHospitalNurseIds = candidates
            .Where(c => c.Role == UserRole.NURSE)
            .Select(c => c.Id)
            .ToList();
        var blockedIds = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a =>
                ((a.HospitalUserId == hospitalUserId && candidateIds.Contains(a.StaffUserId)) ||
                 singleHospitalNurseIds.Contains(a.StaffUserId)) &&
                (a.Status == AffiliationStatus.Pending || a.Status == AffiliationStatus.Active))
            .Select(a => a.StaffUserId)
            .ToListAsync();

        var blockedSet = blockedIds.ToHashSet();

        return candidates.Select(u => new StaffCandidateDto
        {
            UserId = u.Id,
            RegistrationNumber = u.RegistrationNumber ?? string.Empty,
            FullName = GetStaffName(u),
            Email = u.Email,
            Role = u.Role.ToString(),
            Specialization = u.DoctorProfile?.Specialization,
            AlreadyAffiliated = blockedSet.Contains(u.Id)
        }).ToList();
    }

    public async Task<StaffAffiliationDto> RespondToInvitationAsync(Guid staffUserId, Guid affiliationId, AffiliationDecisionDto dto)
    {
        await EnsureActiveStaffAsync(staffUserId);

        var affiliation = await _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            .FirstOrDefaultAsync(a => a.Id == affiliationId);

        if (affiliation == null)
            throw new KeyNotFoundException("Invitation not found.");

        if (affiliation.StaffUserId != staffUserId)
            throw new UnauthorizedAccessException("You can only respond to your own invitations.");

        if (affiliation.Status != AffiliationStatus.Pending)
            throw new InvalidOperationException("This invitation has already been processed.");

        var decision = dto.Decision.Trim();
        if (decision.Equals("Accept", StringComparison.OrdinalIgnoreCase))
        {
            // Nurses may only be active at one hospital.
            if (affiliation.StaffRole == UserRole.NURSE)
            {
                var alreadyActiveElsewhere = await _context.StaffAffiliations.AnyAsync(a =>
                    a.StaffUserId == staffUserId &&
                    a.Id != affiliationId &&
                    a.Status == AffiliationStatus.Active);

                if (alreadyActiveElsewhere)
                    throw new InvalidOperationException(
                        "Nurses can only be affiliated with one hospital. Leave the current hospital before accepting another invitation.");
            }

            affiliation.Status = AffiliationStatus.Active;
        }
        else if (decision.Equals("Reject", StringComparison.OrdinalIgnoreCase))
        {
            affiliation.Status = AffiliationStatus.Rejected;
        }
        else
        {
            throw new InvalidOperationException("Decision must be 'Accept' or 'Reject'.");
        }

        affiliation.RespondedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = staffUserId,
            UserEmail = affiliation.StaffUser.Email,
            Role = affiliation.StaffRole.ToString(),
            Action = affiliation.Status == AffiliationStatus.Active ? "STAFF_INVITE_ACCEPTED" : "STAFF_INVITE_REJECTED",
            Details = $"Staff {affiliation.StaffUser.RegistrationNumber} {affiliation.Status.ToString().ToLower()} invitation from hospital user {affiliation.HospitalUserId}"
        });

        await _context.SaveChangesAsync();
        return MapAffiliation(affiliation, affiliation.HospitalUser, affiliation.StaffUser);
    }

    public async Task<List<StaffAffiliationDto>> GetHospitalStaffAsync(
        Guid hospitalUserId,
        string? role = null,
        string? dutyStatus = null,
        string? search = null,
        string? status = null)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var query = _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            // Front-desk accounts are managed separately and never join the clinical roster.
            .Where(a => a.HospitalUserId == hospitalUserId && a.StaffRole != UserRole.FRONT_DESK)
            .AsQueryable();

        var statusFilter = string.IsNullOrWhiteSpace(status) ? AffiliationStatus.Active.ToString() : status.Trim();
        if (!statusFilter.Equals("All", StringComparison.OrdinalIgnoreCase))
        {
            if (!Enum.TryParse<AffiliationStatus>(statusFilter, true, out var parsedStatus))
                throw new InvalidOperationException("Invalid affiliation status filter.");
            query = query.Where(a => a.Status == parsedStatus);
        }

        if (!string.IsNullOrWhiteSpace(role))
        {
            if (!Enum.TryParse<UserRole>(role.Trim(), true, out var parsedRole) ||
                parsedRole is not (UserRole.DOCTOR or UserRole.NURSE))
                throw new InvalidOperationException("Role filter must be DOCTOR or NURSE.");
            query = query.Where(a => a.StaffRole == parsedRole);
        }

        if (!string.IsNullOrWhiteSpace(dutyStatus))
        {
            if (!Enum.TryParse<DutyStatus>(dutyStatus.Trim(), true, out var parsedDuty))
                throw new InvalidOperationException("Invalid duty status filter.");
            // Live presence is attached after load. Sticky OnBreak is the only DB filter left.
            if (parsedDuty == DutyStatus.OnBreak)
                query = query.Where(a => a.DutyStatus == DutyStatus.OnBreak);
        }

        var list = await query.OrderByDescending(a => a.InvitedAt).ToListAsync();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            list = list.Where(a =>
            {
                var name = GetStaffName(a.StaffUser).ToLowerInvariant();
                var reg = (a.StaffUser.RegistrationNumber ?? string.Empty).ToLowerInvariant();
                var email = a.StaffUser.Email.ToLowerInvariant();
                return name.Contains(term) || reg.Contains(term) || email.Contains(term);
            }).ToList();
        }

        var dtos = list.Select(a => MapAffiliation(a, a.HospitalUser, a.StaffUser)).ToList();
        await AttachLiveDutyAsync(dtos);
        await AttachAvailabilityAsync(dtos);

        if (!string.IsNullOrWhiteSpace(dutyStatus) &&
            Enum.TryParse<DutyStatus>(dutyStatus.Trim(), true, out var liveDutyFilter))
        {
            dtos = liveDutyFilter switch
            {
                DutyStatus.OnDuty => dtos.Where(d => d.IsOnDutyNow).ToList(),
                DutyStatus.Off => dtos.Where(d => !d.IsOnDutyNow).ToList(),
                _ => dtos
            };
        }

        return dtos;
    }

    public async Task<List<StaffAffiliationDto>> GetMyInvitationsAsync(Guid staffUserId)
    {
        await EnsureActiveStaffAsync(staffUserId);

        var list = await _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            .Where(a => a.StaffUserId == staffUserId && a.Status == AffiliationStatus.Pending)
            .OrderByDescending(a => a.InvitedAt)
            .ToListAsync();

        return list.Select(a => MapAffiliation(a, a.HospitalUser, a.StaffUser)).ToList();
    }

    public async Task<List<StaffAffiliationDto>> GetMyAffiliationsAsync(Guid staffUserId)
    {
        await EnsureActiveStaffAsync(staffUserId);

        var list = await _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            .Where(a => a.StaffUserId == staffUserId && a.Status == AffiliationStatus.Active)
            .OrderByDescending(a => a.RespondedAt)
            .ToListAsync();

        var dtos = list.Select(a => MapAffiliation(a, a.HospitalUser, a.StaffUser)).ToList();
        await AttachLiveDutyAsync(dtos);
        await AttachAvailabilityAsync(dtos);
        return dtos;
    }

    public async Task<int> RemoveAffiliationAsync(Guid hospitalUserId, Guid affiliationId)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var affiliation = await _context.StaffAffiliations
            .Include(a => a.StaffUser)
            .FirstOrDefaultAsync(a => a.Id == affiliationId && a.HospitalUserId == hospitalUserId);

        if (affiliation == null)
            throw new KeyNotFoundException("Affiliation not found for this hospital.");

        if (affiliation.Status == AffiliationStatus.Removed)
            throw new InvalidOperationException("Affiliation is already removed.");

        affiliation.Status = AffiliationStatus.Removed;
        affiliation.DutyStatus = DutyStatus.Off;
        affiliation.DutyUpdatedAt = DateTime.UtcNow;
        affiliation.DutyUpdatedByUserId = hospitalUserId;

        // Roster views only show Active staff, so upcoming shifts would silently
        // vanish. Free them here and report the count so the hospital can re-cover.
        // Past and in-progress shifts stay for history.
        var today = HospitalToday();
        var nowTime = TimeOnly.FromDateTime(HospitalNow());
        var upcomingShifts = await _context.StaffShifts
            .Where(s =>
                s.AffiliationId == affiliation.Id &&
                (s.ShiftDate > today || (s.ShiftDate == today && s.StartTime > nowTime)))
            .ToListAsync();
        _context.StaffShifts.RemoveRange(upcomingShifts);

        var pendingSwaps = await _context.ShiftSwapRequests
            .Where(r =>
                r.HospitalUserId == hospitalUserId &&
                r.RequesterUserId == affiliation.StaffUserId &&
                r.Status == ShiftSwapStatus.Pending)
            .ToListAsync();
        foreach (var swap in pendingSwaps)
        {
            swap.Status = ShiftSwapStatus.Cancelled;
            swap.DecidedByUserId = hospitalUserId;
            swap.DecidedAt = DateTime.UtcNow;
            swap.DecisionNote = "Staff removed from roster";
            swap.UpdatedAt = DateTime.UtcNow;
        }

        // If staff no longer belongs to any hospital, revoke refresh session so
        // a phone/browser cannot keep renewing access after roster removal.
        var stillAffiliated = await _context.StaffAffiliations.AnyAsync(a =>
            a.StaffUserId == affiliation.StaffUserId &&
            a.Id != affiliation.Id &&
            a.Status == AffiliationStatus.Active);

        if (!stillAffiliated && affiliation.StaffUser != null)
        {
            affiliation.StaffUser.RefreshToken = null;
            affiliation.StaffUser.RefreshTokenExpiryTime = null;
        }

        var hospital = await _context.Users.FirstAsync(u => u.Id == hospitalUserId);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = "HOSPITAL",
            Action = "STAFF_REMOVED",
            Details = stillAffiliated
                ? $"Hospital removed staff {affiliation.StaffUser.RegistrationNumber} from roster"
                : $"Hospital removed staff {affiliation.StaffUser.RegistrationNumber} from roster; refresh session revoked (no remaining affiliations)"
        });

        if (upcomingShifts.Count > 0)
        {
            await AddShiftAuditAsync(
                hospitalUserId,
                "STAFF_SHIFTS_FREED",
                $"{upcomingShifts.Count} upcoming shift(s) for {affiliation.StaffUser.RegistrationNumber} removed with roster removal");
        }

        await _context.SaveChangesAsync();
        return upcomingShifts.Count;
    }

    public async Task<StaffAffiliationDto> UpdateDutyStatusAsync(Guid actorUserId, Guid affiliationId, UpdateDutyStatusDto dto)
    {
        var affiliation = await _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            .FirstOrDefaultAsync(a => a.Id == affiliationId);

        if (affiliation == null)
            throw new KeyNotFoundException("Affiliation not found.");

        if (affiliation.Status != AffiliationStatus.Active)
            throw new InvalidOperationException("Duty status can only be updated for active affiliations.");

        var isHospital = affiliation.HospitalUserId == actorUserId;
        var isStaff = affiliation.StaffUserId == actorUserId;
        if (!isHospital && !isStaff)
            throw new UnauthorizedAccessException("Only the hospital or the affiliated staff member can update duty status.");

        if (!Enum.TryParse<DutyStatus>(dto.DutyStatus.Trim(), true, out var newDuty))
            throw new InvalidOperationException("DutyStatus must be Off, OnDuty, or OnBreak.");

        if (newDuty == DutyStatus.OnDuty)
            await EnsureCanClockInAsync(affiliation, checkOfferedHours: isStaff);

        affiliation.DutyStatus = newDuty;
        affiliation.DutyUpdatedAt = DateTime.UtcNow;
        affiliation.DutyUpdatedByUserId = actorUserId;

        var actor = isHospital ? affiliation.HospitalUser : affiliation.StaffUser;
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actor.Email,
            Role = actor.Role.ToString(),
            Action = newDuty switch
            {
                DutyStatus.OnDuty => "STAFF_CLOCK_IN",
                DutyStatus.OnBreak => "STAFF_BREAK_START",
                _ => "STAFF_CLOCK_OUT"
            },
            Details = $"{GetStaffName(affiliation.StaffUser)} set to {newDuty} at hospital user {affiliation.HospitalUserId}"
        });

        await _context.SaveChangesAsync();
        var result = MapAffiliation(affiliation, affiliation.HospitalUser, affiliation.StaffUser);
        await AttachLiveDutyAsync(new List<StaffAffiliationDto> { result });
        await AttachAvailabilityAsync(new List<StaffAffiliationDto> { result });
        return result;
    }

    /// <summary>
    /// A doctor cannot be present at two hospitals at once, and outside the primary
    /// hospital may only clock in around the hours they offered. The hospital desk can
    /// still clock someone in for a one-off (checkOfferedHours = false).
    /// </summary>
    private async Task EnsureCanClockInAsync(StaffAffiliation affiliation, bool checkOfferedHours)
    {
        var otherAffiliationIds = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a =>
                a.StaffUserId == affiliation.StaffUserId &&
                a.Id != affiliation.Id &&
                a.Status == AffiliationStatus.Active)
            .Select(a => a.Id)
            .ToListAsync();

        var onDutyElsewhere = await StaffDutyHelper.GetOnDutyAffiliationIdsAsync(_context, otherAffiliationIds);
        if (onDutyElsewhere.Count > 0)
            throw new InvalidOperationException(
                "Already on duty at another hospital. Clock out there before clocking in here.");

        if (!checkOfferedHours) return;

        var rules = (await StaffAvailabilityHelper.LoadAsync(_context, new[] { affiliation.Id }))
            .GetValueOrDefault(affiliation.Id);
        if (rules == null) return;

        var today = HospitalToday();
        if (rules.UnavailableDates.Contains(today))
            throw new InvalidOperationException(
                "You marked today as unavailable at this hospital. Update your availability to clock in.");

        if (!rules.HasWeeklyLimit) return;

        var now = HospitalNow().TimeOfDay;
        var grace = StaffAvailabilityHelper.ClockInGrace;
        var insideOfferedHours = rules.Windows.Any(w =>
            w.Day == today.DayOfWeek &&
            now >= w.Start.ToTimeSpan() - grace &&
            now <= w.End.ToTimeSpan() + grace);

        // A rostered shift (for example a hospital-approved one-off) also allows clock-in.
        var hasShiftToday = await _context.StaffShifts
            .AsNoTracking()
            .AnyAsync(s => s.AffiliationId == affiliation.Id && s.ShiftDate == today);

        if (!insideOfferedHours && !hasShiftToday)
            throw new InvalidOperationException(
                "This is outside the hours you offer this hospital. Update your availability to clock in.");
    }

    public async Task<StaffAffiliationDto> UpdateMyAvailabilityAsync(
        Guid staffUserId,
        Guid affiliationId,
        UpdateStaffAvailabilityDto dto)
    {
        await EnsureActiveStaffAsync(staffUserId);

        var affiliation = await _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            .FirstOrDefaultAsync(a => a.Id == affiliationId);

        if (affiliation == null)
            throw new KeyNotFoundException("Affiliation not found.");

        if (affiliation.StaffUserId != staffUserId)
            throw new UnauthorizedAccessException("You can only set your own availability.");

        if (affiliation.Status != AffiliationStatus.Active)
            throw new InvalidOperationException("Availability can only be set for hospitals you have joined.");

        // Nurses belong to a single hospital, so there is nothing to split.
        if (affiliation.StaffRole != UserRole.DOCTOR)
            throw new InvalidOperationException("Availability applies to doctors only.");

        var requested = dto.Windows ?? new List<AvailabilityWindowDto>();
        if (requested.Any(w => w.DayOfWeek < 0 || w.DayOfWeek > 6))
            throw new InvalidOperationException("Day of week must be between Sunday and Saturday.");

        var windows = requested
            .Select(w => new StaffAvailabilityHelper.Window((DayOfWeek)w.DayOfWeek, w.StartTime, w.EndTime))
            .OrderBy(w => w.Day)
            .ThenBy(w => w.Start)
            .ToList();

        foreach (var window in windows)
        {
            if (window.End <= window.Start)
                throw new InvalidOperationException($"{window.Day}: end time must be after start time.");
        }

        for (var i = 1; i < windows.Count; i++)
        {
            if (windows[i].Day == windows[i - 1].Day && windows[i].Start < windows[i - 1].End)
                throw new InvalidOperationException($"{windows[i].Day}: the time blocks overlap.");
        }

        var otherAffiliations = await _context.StaffAffiliations
            .Include(a => a.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Where(a =>
                a.StaffUserId == staffUserId &&
                a.Id != affiliation.Id &&
                a.Status == AffiliationStatus.Active)
            .ToListAsync();

        // Hours offered to two hospitals must not clash or leave no time to travel.
        if (!dto.IsPrimary && windows.Count > 0)
        {
            var otherRules = await StaffAvailabilityHelper.LoadAsync(
                _context,
                otherAffiliations.Select(a => a.Id).ToList());

            foreach (var other in otherAffiliations)
            {
                var rules = otherRules.GetValueOrDefault(other.Id);
                if (rules == null || !rules.HasWeeklyLimit) continue;

                var clash = windows.FirstOrDefault(w => rules.Windows.Any(o =>
                    o.Day == w.Day &&
                    StaffAvailabilityHelper.WithinTravelGap(w.Start, w.End, o.Start, o.End)));
                if (clash != null)
                {
                    var otherName = other.HospitalUser.HospitalProfile?.HospitalName ?? "another hospital";
                    throw new InvalidOperationException(
                        $"{clash.Day} {clash.Start:HH\\:mm}-{clash.End:HH\\:mm} clashes with the hours you offer {otherName}. " +
                        $"Leave at least {StaffAvailabilityHelper.TravelGap.TotalMinutes:0} minutes between hospitals.");
                }
            }
        }

        var today = HospitalToday();
        var unavailableDates = (dto.UnavailableDates ?? new List<DateOnly>())
            .Where(d => d >= today)
            .Distinct()
            .OrderBy(d => d)
            .ToList();
        if (unavailableDates.Count > 366)
            throw new InvalidOperationException("You can list at most 366 days off.");

        // Only one hospital can be the main employer.
        if (dto.IsPrimary)
        {
            foreach (var other in otherAffiliations.Where(a => a.IsPrimary))
                other.IsPrimary = false;
        }
        affiliation.IsPrimary = dto.IsPrimary;

        _context.StaffAvailabilityWindows.RemoveRange(
            await _context.StaffAvailabilityWindows.Where(w => w.AffiliationId == affiliation.Id).ToListAsync());
        _context.StaffUnavailableDates.RemoveRange(
            await _context.StaffUnavailableDates.Where(d => d.AffiliationId == affiliation.Id).ToListAsync());

        _context.StaffAvailabilityWindows.AddRange(windows.Select(w => new StaffAvailabilityWindow
        {
            AffiliationId = affiliation.Id,
            DayOfWeek = w.Day,
            StartTime = w.Start,
            EndTime = w.End
        }));
        _context.StaffUnavailableDates.AddRange(unavailableDates.Select(d => new StaffUnavailableDate
        {
            AffiliationId = affiliation.Id,
            Date = d
        }));

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = staffUserId,
            UserEmail = affiliation.StaffUser.Email,
            Role = affiliation.StaffRole.ToString(),
            Action = "STAFF_AVAILABILITY_UPDATED",
            Details =
                $"{GetStaffName(affiliation.StaffUser)} set availability at hospital user {affiliation.HospitalUserId}: " +
                $"primary={dto.IsPrimary}, {windows.Count} weekly block(s), {unavailableDates.Count} unavailable date(s)"
        });

        await _context.SaveChangesAsync();

        var result = MapAffiliation(affiliation, affiliation.HospitalUser, affiliation.StaffUser);
        var results = new List<StaffAffiliationDto> { result };
        await AttachLiveDutyAsync(results);
        await AttachAvailabilityAsync(results);
        return result;
    }

    private async Task AttachAvailabilityAsync(List<StaffAffiliationDto> dtos)
    {
        if (dtos.Count == 0) return;

        var rules = await StaffAvailabilityHelper.LoadAsync(_context, dtos.Select(d => d.AffiliationId).ToList());
        foreach (var dto in dtos)
        {
            if (!rules.TryGetValue(dto.AffiliationId, out var rule)) continue;
            dto.AvailabilityWindows = rule.Windows
                .Select(w => new AvailabilityWindowDto
                {
                    DayOfWeek = (int)w.Day,
                    StartTime = w.Start,
                    EndTime = w.End
                })
                .ToList();
            dto.UnavailableDates = rule.UnavailableDates.OrderBy(d => d).ToList();
        }
    }

    /// <summary>
    /// Rejects a shift outside what the doctor offers this hospital unless the hospital
    /// confirmed the one-off. The "Outside availability:" prefix lets clients offer that choice.
    /// </summary>
    private async Task EnsureWithinAvailabilityAsync(
        StaffAffiliation affiliation,
        DateOnly shiftDate,
        TimeOnly start,
        TimeOnly end,
        bool overrideAvailability)
    {
        if (overrideAvailability) return;

        var rules = (await StaffAvailabilityHelper.LoadAsync(_context, new[] { affiliation.Id }))
            .GetValueOrDefault(affiliation.Id);
        var reason = StaffAvailabilityHelper.Explain(rules, shiftDate, start, end);
        if (reason != null)
            throw new InvalidOperationException(
                $"Outside availability: {GetStaffName(affiliation.StaffUser)} is {reason} at this hospital.");
    }

    public async Task<List<HospitalBoothDto>> GetHospitalBoothsAsync(Guid hospitalUserId, bool activeOnly = false)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var query = _context.HospitalBooths
            .AsNoTracking()
            .Where(b => b.HospitalUserId == hospitalUserId);

        if (activeOnly)
            query = query.Where(b => b.IsActive);

        var list = await query
            .Include(b => b.Vaccines)
            .ThenInclude(v => v.Vaccine)
            .OrderBy(b => b.SortOrder)
            .ThenBy(b => b.Code)
            .ToListAsync();

        return list.Select(MapBooth).ToList();
    }

    public async Task<HospitalBoothDto> CreateHospitalBoothAsync(Guid hospitalUserId, CreateHospitalBoothDto dto)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var code = NormalizeBoothCode(dto.Code);
        var name = NormalizeBoothName(dto.Name);

        var duplicate = await _context.HospitalBooths.AnyAsync(b =>
            b.HospitalUserId == hospitalUserId &&
            b.Code.ToLower() == code.ToLower());
        if (duplicate)
            throw new InvalidOperationException($"A booth with code '{code}' already exists.");

        var maxSort = await _context.HospitalBooths
            .Where(b => b.HospitalUserId == hospitalUserId)
            .Select(b => (int?)b.SortOrder)
            .MaxAsync() ?? 0;

        var vaccineIds = await NormalizeBoothVaccineIdsAsync(dto.VaccineIds);
        var booth = new HospitalBooth
        {
            HospitalUserId = hospitalUserId,
            Code = code,
            Name = name,
            IsActive = true,
            SortOrder = dto.SortOrder ?? (maxSort + 1),
            CreatedAt = DateTime.UtcNow
        };
        foreach (var vaccineId in vaccineIds)
        {
            booth.Vaccines.Add(new HospitalBoothVaccine
            {
                BoothId = booth.Id,
                VaccineId = vaccineId
            });
        }

        _context.HospitalBooths.Add(booth);
        await AddShiftAuditAsync(
            hospitalUserId,
            "HOSPITAL_BOOTH_CREATED",
            $"Booth {booth.DisplayLabel} created");
        await _context.SaveChangesAsync();
        return await LoadBoothDtoAsync(booth.Id);
    }

    public async Task<HospitalBoothDto> UpdateHospitalBoothAsync(
        Guid hospitalUserId,
        Guid boothId,
        UpdateHospitalBoothDto dto)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var booth = await _context.HospitalBooths
            .Include(b => b.Vaccines)
            .FirstOrDefaultAsync(b => b.Id == boothId && b.HospitalUserId == hospitalUserId);
        if (booth == null)
            throw new KeyNotFoundException("Booth not found for this hospital.");

        var code = NormalizeBoothCode(dto.Code);
        var name = NormalizeBoothName(dto.Name);

        var duplicate = await _context.HospitalBooths.AnyAsync(b =>
            b.HospitalUserId == hospitalUserId &&
            b.Id != boothId &&
            b.Code.ToLower() == code.ToLower());
        if (duplicate)
            throw new InvalidOperationException($"A booth with code '{code}' already exists.");

        // Booking sessions depend on this booth and its vaccines: don't pull them out
        // from under patients who can still book.
        var upcomingSessions = await GetUpcomingBoothSessionsAsync(booth.Id);
        if (booth.IsActive && !dto.IsActive && upcomingSessions.Count > 0)
            throw new InvalidOperationException(BoothInUseMessage(booth, upcomingSessions));

        var keptVaccineIds = (dto.VaccineIds ?? Enumerable.Empty<Guid>()).ToHashSet();
        var removedVaccineIds = booth.Vaccines
            .Select(v => v.VaccineId)
            .Where(id => !keptVaccineIds.Contains(id))
            .ToHashSet();
        var affected = upcomingSessions
            .Where(s => s.VaccineId.HasValue && removedVaccineIds.Contains(s.VaccineId.Value))
            .ToList();
        if (affected.Count > 0)
            throw new InvalidOperationException(BoothInUseMessage(booth, affected));

        booth.Code = code;
        booth.Name = name;
        booth.IsActive = dto.IsActive;
        if (dto.SortOrder.HasValue)
            booth.SortOrder = dto.SortOrder.Value;
        booth.UpdatedAt = DateTime.UtcNow;

        // Keep shift display labels in sync for linked rows.
        var linkedShifts = await _context.StaffShifts
            .Where(s => s.BoothId == booth.Id)
            .ToListAsync();
        foreach (var shift in linkedShifts)
            shift.BoothOrStation = booth.DisplayLabel;

        await ReplaceBoothVaccinesAsync(booth, dto.VaccineIds);

        await AddShiftAuditAsync(
            hospitalUserId,
            "HOSPITAL_BOOTH_UPDATED",
            $"Booth {booth.DisplayLabel} updated (active={booth.IsActive})");
        await _context.SaveChangesAsync();
        return await LoadBoothDtoAsync(booth.Id);
    }

    public async Task DeactivateHospitalBoothAsync(Guid hospitalUserId, Guid boothId)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var booth = await _context.HospitalBooths
            .FirstOrDefaultAsync(b => b.Id == boothId && b.HospitalUserId == hospitalUserId);
        if (booth == null)
            throw new KeyNotFoundException("Booth not found for this hospital.");

        var upcomingSessions = await GetUpcomingBoothSessionsAsync(booth.Id);
        if (upcomingSessions.Count > 0)
            throw new InvalidOperationException(BoothInUseMessage(booth, upcomingSessions));

        booth.IsActive = false;
        booth.UpdatedAt = DateTime.UtcNow;
        await AddShiftAuditAsync(
            hospitalUserId,
            "HOSPITAL_BOOTH_DEACTIVATED",
            $"Booth {booth.DisplayLabel} deactivated");
        await _context.SaveChangesAsync();
    }

    public async Task<StaffShiftDto> CreateShiftAsync(Guid hospitalUserId, CreateStaffShiftDto dto)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);
        ValidateShiftSchedule(dto.ShiftDate, dto.StartTime, dto.EndTime);

        var affiliation = await _context.StaffAffiliations
            .Include(a => a.StaffUser).ThenInclude(s => s.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(s => s.NurseProfile)
            .FirstOrDefaultAsync(a => a.Id == dto.AffiliationId && a.HospitalUserId == hospitalUserId);

        if (affiliation == null)
            throw new KeyNotFoundException("Affiliation not found for this hospital.");

        if (affiliation.Status != AffiliationStatus.Active)
            throw new InvalidOperationException("Shifts can only be assigned to active staff.");

        if (affiliation.StaffRole == UserRole.FRONT_DESK)
            throw new InvalidOperationException("Shifts can only be assigned to doctors or nurses.");

        await EnsureNoShiftOverlapAsync(hospitalUserId, affiliation.StaffUserId, dto.ShiftDate, dto.StartTime, dto.EndTime);
        await EnsureWithinAvailabilityAsync(affiliation, dto.ShiftDate, dto.StartTime, dto.EndTime, dto.OverrideAvailability);

        var (boothId, boothLabel) = await ResolveBoothAssignmentAsync(
            hospitalUserId,
            dto.BoothId,
            dto.BoothOrStation);

        var shift = new StaffShift
        {
            AffiliationId = affiliation.Id,
            ShiftDate = dto.ShiftDate,
            StartTime = dto.StartTime,
            EndTime = dto.EndTime,
            BoothId = boothId,
            BoothOrStation = boothLabel,
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
            CreatedByUserId = hospitalUserId,
            CreatedAt = DateTime.UtcNow
        };

        _context.StaffShifts.Add(shift);
        await AddShiftAuditAsync(
            hospitalUserId,
            "STAFF_SHIFT_CREATED",
            $"Shift created for {GetStaffName(affiliation.StaffUser)} on {dto.ShiftDate:yyyy-MM-dd} " +
            $"{dto.StartTime:HH\\:mm}-{dto.EndTime:HH\\:mm}");

        await _context.SaveChangesAsync();

        return MapShift(shift, affiliation);
    }

    public async Task<List<StaffShiftDto>> GetHospitalShiftsAsync(Guid hospitalUserId, DateOnly? from = null, DateOnly? to = null)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var query = _context.StaffShifts
            .Include(s => s.Booth)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(s =>
                s.Affiliation.HospitalUserId == hospitalUserId &&
                s.Affiliation.Status == AffiliationStatus.Active)
            .AsQueryable();

        if (from.HasValue) query = query.Where(s => s.ShiftDate >= from.Value);
        if (to.HasValue) query = query.Where(s => s.ShiftDate <= to.Value);

        var list = await query.OrderBy(s => s.ShiftDate).ThenBy(s => s.StartTime).ToListAsync();
        var mapped = list.Select(s => MapShift(s, s.Affiliation)).ToList();
        await ApplyCoverStatusAsync(mapped, viewerUserId: null);
        return mapped;
    }

    public async Task<List<StaffBusyBlockDto>> GetAffiliatedStaffBusyBlocksAsync(
        Guid hospitalUserId,
        DateOnly? from = null,
        DateOnly? to = null)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var localAffiliations = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.Status == AffiliationStatus.Active &&
                a.StaffRole != UserRole.FRONT_DESK)
            .Select(a => new { a.Id, a.StaffUserId })
            .ToListAsync();

        if (localAffiliations.Count == 0)
            return new List<StaffBusyBlockDto>();

        var staffUserIds = localAffiliations.Select(a => a.StaffUserId).Distinct().ToList();
        var localByStaff = localAffiliations
            .GroupBy(a => a.StaffUserId)
            .ToDictionary(g => g.Key, g => g.First().Id);

        var query = _context.StaffShifts
            .AsNoTracking()
            .Include(s => s.Affiliation)
            .Where(s =>
                staffUserIds.Contains(s.Affiliation.StaffUserId) &&
                s.Affiliation.Status == AffiliationStatus.Active);

        if (from.HasValue) query = query.Where(s => s.ShiftDate >= from.Value);
        if (to.HasValue) query = query.Where(s => s.ShiftDate <= to.Value);

        var shifts = await query
            .OrderBy(s => s.ShiftDate)
            .ThenBy(s => s.StartTime)
            .ToListAsync();

        var blocks = shifts
            .Where(s => localByStaff.ContainsKey(s.Affiliation.StaffUserId))
            .Select(s =>
            {
                // Another hospital's shift also blocks the travel time either side of it.
                var isExternal = s.Affiliation.HospitalUserId != hospitalUserId;
                return new StaffBusyBlockDto
                {
                    StaffUserId = s.Affiliation.StaffUserId,
                    LocalAffiliationId = localByStaff[s.Affiliation.StaffUserId],
                    ShiftDate = s.ShiftDate,
                    StartTime = isExternal ? PadStart(s.StartTime) : s.StartTime,
                    EndTime = isExternal ? PadEnd(s.EndTime) : s.EndTime,
                    IsExternal = isExternal
                };
            })
            .ToList();

        blocks.AddRange(await BuildUnavailableBlocksAsync(
            localAffiliations.Select(a => (a.Id, a.StaffUserId)).ToList(),
            from,
            to));
        return blocks;
    }

    /// <summary>
    /// Days off and hours a doctor does not offer this hospital, expressed as busy
    /// blocks so the scheduling agent never proposes a shift there.
    /// </summary>
    private async Task<List<StaffBusyBlockDto>> BuildUnavailableBlocksAsync(
        List<(Guid AffiliationId, Guid StaffUserId)> affiliations,
        DateOnly? from,
        DateOnly? to)
    {
        var blocks = new List<StaffBusyBlockDto>();
        var rules = await StaffAvailabilityHelper.LoadAsync(_context, affiliations.Select(a => a.AffiliationId).ToList());
        var dayStart = TimeOnly.MinValue;
        var dayEnd = new TimeOnly(23, 59, 59);

        foreach (var (affiliationId, staffUserId) in affiliations)
        {
            if (!rules.TryGetValue(affiliationId, out var rule)) continue;

            void Add(DateOnly date, TimeOnly start, TimeOnly end)
            {
                if (end <= start) return;
                blocks.Add(new StaffBusyBlockDto
                {
                    StaffUserId = staffUserId,
                    LocalAffiliationId = affiliationId,
                    ShiftDate = date,
                    StartTime = start,
                    EndTime = end,
                    IsUnavailable = true
                });
            }

            foreach (var date in rule.UnavailableDates)
            {
                if ((!from.HasValue || date >= from.Value) && (!to.HasValue || date <= to.Value))
                    Add(date, dayStart, dayEnd);
            }

            // Weekly hours need a bounded range to expand into dates.
            if (!rule.HasWeeklyLimit || !from.HasValue || !to.HasValue) continue;
            if (to.Value.DayNumber - from.Value.DayNumber > 62) continue;

            for (var date = from.Value; date <= to.Value; date = date.AddDays(1))
            {
                if (rule.UnavailableDates.Contains(date)) continue;

                var cursor = dayStart;
                foreach (var window in rule.Windows.Where(w => w.Day == date.DayOfWeek).OrderBy(w => w.Start))
                {
                    Add(date, cursor, window.Start);
                    cursor = window.End;
                }
                Add(date, cursor, dayEnd);
            }
        }

        return blocks;
    }

    private sealed record SessionOccurrence(VaccineSchedule Schedule, DateOnly Date, TimeOnly Start, TimeOnly End);

    /// <summary>Dated runs of the hospital's active vaccine sessions in [from, to].</summary>
    private async Task<List<SessionOccurrence>> ExpandSessionsAsync(
        Guid hospitalUserId,
        Guid? hospitalProfileId,
        DateOnly from,
        DateOnly to)
    {
        var schedules = await _context.VaccineSchedules
            .AsNoTracking()
            .Include(s => s.Booth)
            .Where(s =>
                s.Status == "Active" &&
                (s.HospitalUserId == hospitalUserId ||
                 (hospitalProfileId != null && s.HospitalProfileId == hospitalProfileId)))
            .ToListAsync();

        var occurrences = new List<SessionOccurrence>();
        foreach (var schedule in schedules)
        {
            if (!TimeOnly.TryParse(schedule.StartTime, out var start) ||
                !TimeOnly.TryParse(schedule.EndTime, out var end) ||
                end <= start)
            {
                continue;
            }

            if (!string.Equals(schedule.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase))
            {
                if (schedule.SpecificDate is { } specific && specific >= from && specific <= to)
                    occurrences.Add(new SessionOccurrence(schedule, specific, start, end));
                continue;
            }

            var weekdays = (schedule.DaysOfWeek ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            for (var date = from; date <= to; date = date.AddDays(1))
            {
                if (schedule.StartDate.HasValue && date < schedule.StartDate.Value) continue;
                if (schedule.EndDate.HasValue && date > schedule.EndDate.Value) continue;
                var dayName = date.DayOfWeek.ToString();
                if (weekdays.Any(d =>
                        string.Equals(d, dayName, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(d, dayName[..3], StringComparison.OrdinalIgnoreCase)))
                {
                    occurrences.Add(new SessionOccurrence(schedule, date, start, end));
                }
            }
        }

        return occurrences;
    }

    /// <summary>A shift staffs a session when it is in that booth during the session's hours.</summary>
    private static bool ShiftStaffsSession(StaffShift shift, SessionOccurrence session) =>
        shift.ShiftDate == session.Date &&
        shift.StartTime < session.End &&
        shift.EndTime > session.Start &&
        (session.Schedule.BoothId == null || shift.BoothId == session.Schedule.BoothId);

    private static bool SessionIsOver(SessionOccurrence session)
    {
        var today = HospitalToday();
        return session.Date < today ||
               (session.Date == today && session.End <= TimeOnly.FromDateTime(HospitalNow()));
    }

    private static RosterSessionDto MapRosterSession(SessionOccurrence session, IEnumerable<StaffShift> hospitalShifts)
    {
        var staffing = hospitalShifts
            .Where(s => ShiftStaffsSession(s, session))
            .OrderBy(s => s.StartTime)
            .ToList();

        List<RosterSessionStaffDto> ForRole(UserRole role) => staffing
            .Where(s => s.Affiliation.StaffRole == role)
            .Select(s => new RosterSessionStaffDto
            {
                ShiftId = s.Id,
                AffiliationId = s.AffiliationId,
                StaffName = GetStaffName(s.Affiliation.StaffUser),
                StartTime = s.StartTime,
                EndTime = s.EndTime
            })
            .ToList();

        return new RosterSessionDto
        {
            ScheduleId = session.Schedule.Id,
            Date = session.Date,
            StartTime = session.Start,
            EndTime = session.End,
            BoothId = session.Schedule.BoothId,
            BoothLabel = session.Schedule.Booth?.DisplayLabel ?? session.Schedule.BoothLabel,
            VaccineName = session.Schedule.VaccineName,
            Doctors = ForRole(UserRole.DOCTOR),
            Nurses = ForRole(UserRole.NURSE),
            CanAssign = !SessionIsOver(session)
        };
    }

    private Task<List<StaffShift>> LoadHospitalShiftsAsync(Guid hospitalUserId, DateOnly from, DateOnly to) =>
        _context.StaffShifts
            .AsNoTracking()
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(s =>
                s.Affiliation.HospitalUserId == hospitalUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate >= from &&
                s.ShiftDate <= to)
            .ToListAsync();

    public async Task<List<RosterSessionDto>> GetRosterSessionsAsync(Guid hospitalUserId, DateOnly from, DateOnly to)
    {
        var hospitalProfileId = await EnsureActiveHospitalWithProfileAsync(hospitalUserId);

        if (to < from)
            throw new InvalidOperationException("End date must be on or after the start date.");
        if (to.DayNumber - from.DayNumber > 31)
            throw new InvalidOperationException("Session range cannot exceed 31 days.");

        var sessions = await ExpandSessionsAsync(hospitalUserId, hospitalProfileId, from, to);
        var shifts = await LoadHospitalShiftsAsync(hospitalUserId, from, to);

        return sessions
            .Select(session => MapRosterSession(session, shifts))
            .OrderBy(s => s.Date)
            .ThenBy(s => s.StartTime)
            .ThenBy(s => s.BoothLabel, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async Task<SessionOccurrence> FindSessionAsync(Guid hospitalUserId, Guid scheduleId, DateOnly date)
    {
        var hospitalProfileId = await EnsureActiveHospitalWithProfileAsync(hospitalUserId);
        var session = (await ExpandSessionsAsync(hospitalUserId, hospitalProfileId, date, date))
            .FirstOrDefault(s => s.Schedule.Id == scheduleId);
        return session ?? throw new KeyNotFoundException("That session does not run on this date.");
    }

    public async Task<List<SessionCandidateDto>> GetSessionCandidatesAsync(Guid hospitalUserId, Guid scheduleId, DateOnly date)
    {
        var session = await FindSessionAsync(hospitalUserId, scheduleId, date);
        return await BuildSessionCandidatesAsync(hospitalUserId, session);
    }

    private async Task<List<SessionCandidateDto>> BuildSessionCandidatesAsync(Guid hospitalUserId, SessionOccurrence session)
    {
        var staff = await _context.StaffAffiliations
            .AsNoTracking()
            .Include(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.Status == AffiliationStatus.Active &&
                (a.StaffRole == UserRole.DOCTOR || a.StaffRole == UserRole.NURSE))
            .ToListAsync();

        // Shifts at any hospital that day, since a doctor elsewhere cannot staff this session.
        var staffUserIds = staff.Select(a => a.StaffUserId).Distinct().ToList();
        var dayShifts = await _context.StaffShifts
            .AsNoTracking()
            .Include(s => s.Affiliation)
            .Where(s =>
                staffUserIds.Contains(s.Affiliation.StaffUserId) &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate == session.Date)
            .ToListAsync();

        var rules = await StaffAvailabilityHelper.LoadAsync(_context, staff.Select(a => a.Id).ToList());
        var (start, end) = (session.Start, session.End);

        var candidates = new List<SessionCandidateDto>();
        foreach (var affiliation in staff)
        {
            var theirs = dayShifts.Where(s => s.Affiliation.StaffUserId == affiliation.StaffUserId).ToList();
            var local = theirs.Where(s => s.Affiliation.HospitalUserId == hospitalUserId).ToList();
            var elsewhere = theirs.Where(s => s.Affiliation.HospitalUserId != hospitalUserId).ToList();

            string? reason = null;
            var canOverride = false;

            var clash = local.FirstOrDefault(s => s.StartTime < end && s.EndTime > start);
            if (local.Any(s => ShiftStaffsSession(s, session)))
                reason = "Already on this session";
            else if (clash != null)
                reason = $"On another shift {clash.StartTime:HH\\:mm}-{clash.EndTime:HH\\:mm}";
            else if (elsewhere.Any(s => s.StartTime < end && s.EndTime > start))
                reason = "Working at another hospital";
            else if (elsewhere.Any(s => StaffAvailabilityHelper.WithinTravelGap(start, end, s.StartTime, s.EndTime)))
                reason = "At another hospital too close to this session";
            else
            {
                var unavailable = StaffAvailabilityHelper.Explain(
                    rules.GetValueOrDefault(affiliation.Id), session.Date, start, end);
                if (unavailable != null)
                {
                    reason = char.ToUpperInvariant(unavailable[0]) + unavailable[1..];
                    canOverride = true;
                }
            }

            candidates.Add(new SessionCandidateDto
            {
                AffiliationId = affiliation.Id,
                StaffName = GetStaffName(affiliation.StaffUser),
                StaffRole = affiliation.StaffRole.ToString(),
                Specialization = affiliation.StaffUser.DoctorProfile?.Specialization,
                StaffPhotoUrl = affiliation.StaffUser.DoctorProfile?.ProfilePhotoUrl
                    ?? affiliation.StaffUser.NurseProfile?.ProfilePhotoUrl,
                Available = reason == null,
                Reason = reason,
                CanOverride = canOverride,
                ShiftsThatDay = local.Count
            });
        }

        // Free people first, lightest day first, so the obvious pick is on top.
        return candidates
            .OrderByDescending(c => c.Available)
            .ThenBy(c => c.ShiftsThatDay)
            .ThenBy(c => c.StaffName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<RosterSessionDto> AssignSessionStaffAsync(Guid hospitalUserId, AssignSessionStaffDto dto)
    {
        var session = await FindSessionAsync(hospitalUserId, dto.ScheduleId, dto.Date);
        if (SessionIsOver(session))
            throw new InvalidOperationException("This session has already ended.");

        var requested = (dto.AffiliationIds ?? new List<Guid>()).Distinct().ToList();
        if (requested.Count == 0)
            throw new InvalidOperationException("Pick at least one staff member.");

        // Check everyone before creating anything, so a session is not left half staffed.
        var candidates = (await BuildSessionCandidatesAsync(hospitalUserId, session))
            .ToDictionary(c => c.AffiliationId);
        foreach (var affiliationId in requested)
        {
            if (!candidates.TryGetValue(affiliationId, out var candidate))
                throw new KeyNotFoundException("Affiliation not found for this hospital.");
            if (candidate.Available) continue;
            if (candidate.CanOverride && dto.OverrideAvailability) continue;

            var prefix = candidate.CanOverride ? "Outside availability: " : string.Empty;
            throw new InvalidOperationException($"{prefix}{candidate.StaffName}: {candidate.Reason}.");
        }

        // A session already under way is staffed from now, since shifts cannot start in the past.
        var start = session.Start;
        if (session.Date == HospitalToday())
        {
            var now = HospitalNow();
            var nextMinute = new TimeOnly(now.Hour, now.Minute).AddMinutes(1);
            if (start < nextMinute && nextMinute < session.End)
                start = nextMinute;
        }

        var booth = session.Schedule.Booth;
        foreach (var affiliationId in requested)
        {
            await CreateShiftAsync(hospitalUserId, new CreateStaffShiftDto
            {
                AffiliationId = affiliationId,
                ShiftDate = session.Date,
                StartTime = start,
                EndTime = session.End,
                BoothId = booth is { IsActive: true } ? booth.Id : null,
                BoothOrStation = booth is { IsActive: true } ? null : session.Schedule.BoothLabel,
                Notes = $"{session.Schedule.VaccineName} session",
                OverrideAvailability = dto.OverrideAvailability
            });
        }

        var shifts = await LoadHospitalShiftsAsync(hospitalUserId, session.Date, session.Date);
        return MapRosterSession(session, shifts);
    }

    public async Task<StaffCoverageReportDto> GetCoverageReportAsync(Guid hospitalUserId, DateOnly from, DateOnly to)
    {
        var hospitalProfileId = await EnsureActiveHospitalWithProfileAsync(hospitalUserId);

        if (to < from)
            throw new InvalidOperationException("Coverage end date must be on or after the start date.");

        if (to.DayNumber - from.DayNumber > 31)
            throw new InvalidOperationException("Coverage range cannot exceed 31 days.");

        var activeAffiliations = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.Status == AffiliationStatus.Active &&
                a.StaffRole != UserRole.FRONT_DESK)
            .ToListAsync();

        var activeDoctors = activeAffiliations.Count(a => a.StaffRole == UserRole.DOCTOR);
        var activeNurses = activeAffiliations.Count(a => a.StaffRole == UserRole.NURSE);

        var shifts = await _context.StaffShifts
            .AsNoTracking()
            .Include(s => s.Affiliation)
            .Where(s =>
                s.Affiliation.HospitalUserId == hospitalUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate >= from &&
                s.ShiftDate <= to)
            .ToListAsync();

        // When today is in range, the affiliations and shifts above already hold everything the
        // on-duty count needs, so skip the helper's two extra round trips.
        var onDutyStaff = await CountOnDutyAsync(activeAffiliations, shifts, from, to);

        // Coverage only matters on days the hospital actually runs vaccine sessions;
        // closed days and past days must not show as "Low".
        var clinicDays = await GetClinicDaysAsync(hospitalUserId, from, to, hospitalProfileId);
        var today = HospitalToday();

        var days = new List<StaffDayCoverageDto>();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            var dayShifts = shifts.Where(s => s.ShiftDate == date).ToList();
            var scheduledDoctors = dayShifts
                .Where(s => s.Affiliation.StaffRole == UserRole.DOCTOR)
                .Select(s => s.Affiliation.StaffUserId)
                .Distinct()
                .Count();
            var scheduledNurses = dayShifts
                .Where(s => s.Affiliation.StaffRole == UserRole.NURSE)
                .Select(s => s.Affiliation.StaffUserId)
                .Distinct()
                .Count();

            // Real-world depth: Good needs morning+afternoon style staffing when the
            // hospital has enough people (target up to 2 unique doctors and 2 nurses).
            var targetDoctors = TargetDailyRoleCount(activeDoctors);
            var targetNurses = TargetDailyRoleCount(activeNurses);

            string coverageLevel;
            if (date < today)
            {
                coverageLevel = "Past";
            }
            else if (!clinicDays.Contains(date))
            {
                coverageLevel = "NoClinic";
            }
            else if (activeDoctors + activeNurses == 0)
            {
                coverageLevel = "Low";
            }
            else if (scheduledDoctors == 0 || scheduledNurses == 0)
            {
                coverageLevel = "Low";
            }
            else if (scheduledDoctors >= targetDoctors && scheduledNurses >= targetNurses)
            {
                coverageLevel = "Good";
            }
            else
            {
                coverageLevel = "Partial";
            }

            var summary = coverageLevel switch
            {
                "Past" => "Day has passed.",
                "NoClinic" => "No vaccine sessions scheduled — clinic closed.",
                _ when activeDoctors + activeNurses == 0 => "No active affiliated staff yet.",
                _ => coverageLevel switch
                {
                    "Good" => $"Solid depth: {scheduledDoctors}/{targetDoctors} doctors and {scheduledNurses}/{targetNurses} nurses.",
                    "Partial" => $"Thin roster — aim for {targetDoctors} doctors and {targetNurses} nurses (AM + PM).",
                    _ => "Missing doctor and/or nurse shift coverage."
                }
            };

            days.Add(new StaffDayCoverageDto
            {
                Date = date,
                ActiveDoctors = activeDoctors,
                ActiveNurses = activeNurses,
                ScheduledDoctors = scheduledDoctors,
                ScheduledNurses = scheduledNurses,
                TotalShifts = dayShifts.Count,
                CoverageLevel = coverageLevel,
                Summary = summary
            });
        }

        return new StaffCoverageReportDto
        {
            From = from,
            To = to,
            ActiveDoctors = activeDoctors,
            ActiveNurses = activeNurses,
            CurrentlyOnDutyStaff = onDutyStaff,
            DaysWithLowCoverage = days.Count(d => d.CoverageLevel == "Low"),
            Days = days
        };
    }

    /// <summary>
    /// Dates in [from, to] with at least one active vaccine session (one-time or weekly).
    /// </summary>
    private async Task<int> CountOnDutyAsync(
        List<StaffAffiliation> activeAffiliations,
        List<StaffShift> shiftsInRange,
        DateOnly from,
        DateOnly to)
    {
        var today = StaffDutyHelper.HospitalToday();
        if (today < from || today > to)
        {
            return (await StaffDutyHelper.GetOnDutyAffiliationIdsAsync(
                _context,
                activeAffiliations.Select(a => a.Id).ToList())).Count;
        }

        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());
        var utcNow = DateTime.UtcNow;
        var liveShiftIds = shiftsInRange
            .Where(s => s.ShiftDate == today && s.StartTime <= now && s.EndTime > now)
            .Select(s => s.AffiliationId)
            .ToHashSet();

        return activeAffiliations.Count(a =>
            a.DutyStatus != DutyStatus.OnBreak &&
            (liveShiftIds.Contains(a.Id) || StaffDutyHelper.IsClockedIn(a.DutyStatus, a.DutyUpdatedAt, utcNow)));
    }

    private async Task<HashSet<DateOnly>> GetClinicDaysAsync(Guid hospitalUserId, DateOnly from, DateOnly to, Guid? hospitalProfileId)
    {
        var schedules = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s =>
                s.Status == "Active" &&
                (s.HospitalUserId == hospitalUserId ||
                 (hospitalProfileId != null && s.HospitalProfileId == hospitalProfileId)))
            .ToListAsync();

        var days = new HashSet<DateOnly>();
        foreach (var schedule in schedules)
        {
            if (!string.Equals(schedule.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase))
            {
                if (schedule.SpecificDate is { } specific && specific >= from && specific <= to)
                    days.Add(specific);
                continue;
            }

            var weekdays = (schedule.DaysOfWeek ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            for (var date = from; date <= to; date = date.AddDays(1))
            {
                if (schedule.StartDate.HasValue && date < schedule.StartDate.Value) continue;
                if (schedule.EndDate.HasValue && date > schedule.EndDate.Value) continue;
                var dayName = date.DayOfWeek.ToString();
                if (weekdays.Any(d =>
                        string.Equals(d, dayName, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(d, dayName[..3], StringComparison.OrdinalIgnoreCase)))
                {
                    days.Add(date);
                }
            }
        }

        return days;
    }

    /// <summary>
    /// Rules-based roster suggestions, used when the scheduling agent is unreachable.
    /// Proposes a doctor and a nurse for every posted vaccine session that still lacks
    /// one, with the session's own date, hours and booth. Nothing is saved: the
    /// hospital approves each proposal.
    /// </summary>
    public async Task<SuggestWeekCoverageResultDto> SuggestWeekCoverageAsync(
        Guid hospitalUserId,
        SuggestWeekCoverageDto dto)
    {
        var hospitalProfileId = await EnsureActiveHospitalWithProfileAsync(hospitalUserId);

        if (dto.To < dto.From)
            throw new InvalidOperationException("End date must be on or after start date.");

        if ((dto.To.DayNumber - dto.From.DayNumber) > 31)
            throw new InvalidOperationException("Suggest range cannot exceed 31 days.");

        // Kept for API compatibility; shift hours now come from each session.
        _ = ParseSuggestTime(dto.DefaultStart, new TimeOnly(8, 0));
        _ = ParseSuggestTime(dto.DefaultEnd, new TimeOnly(16, 0));

        var activeStaff = await _context.StaffAffiliations
            .AsNoTracking()
            .Include(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.Status == AffiliationStatus.Active &&
                a.StaffRole != UserRole.FRONT_DESK)
            .OrderBy(a => a.InvitedAt)
            .ToListAsync();

        var doctors = activeStaff.Where(a => a.StaffRole == UserRole.DOCTOR).ToList();
        var nurses = activeStaff.Where(a => a.StaffRole == UserRole.NURSE).ToList();

        var sessions = (await ExpandSessionsAsync(hospitalUserId, hospitalProfileId, dto.From, dto.To))
            .OrderBy(s => s.Date)
            .ThenBy(s => s.Start)
            .ToList();
        var hospitalShifts = await LoadHospitalShiftsAsync(hospitalUserId, dto.From, dto.To);

        var planned = hospitalShifts
            .Select(s => (s.AffiliationId, s.ShiftDate, s.StartTime, s.EndTime, s.Affiliation.StaffRole))
            .ToList();

        // Doctors can work at several hospitals. Their shifts elsewhere block a slot
        // (CreateShift would reject the overlap) but must not count as local coverage.
        var localAffiliationByStaff = activeStaff
            .GroupBy(a => a.StaffUserId)
            .ToDictionary(g => g.Key, g => g.First().Id);
        var staffUserIds = localAffiliationByStaff.Keys.ToList();
        var externalShifts = await _context.StaffShifts
            .AsNoTracking()
            .Where(s =>
                staffUserIds.Contains(s.Affiliation.StaffUserId) &&
                s.Affiliation.HospitalUserId != hospitalUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate >= dto.From &&
                s.ShiftDate <= dto.To)
            .Select(s => new { s.Affiliation.StaffUserId, s.ShiftDate, s.StartTime, s.EndTime })
            .ToListAsync();
        // Padded by the travel gap so a proposal is never back-to-back with another hospital.
        var externalBusy = externalShifts
            .Select(s => (
                localAffiliationByStaff[s.StaffUserId],
                s.ShiftDate,
                PadStart(s.StartTime),
                PadEnd(s.EndTime),
                UserRole.DOCTOR))
            .ToList();

        var availability = await StaffAvailabilityHelper.LoadAsync(
            _context,
            activeStaff.Select(a => a.Id).ToList());

        var today = HospitalToday();
        var nowTime = TimeOnly.FromDateTime(HospitalNow());
        var proposals = new List<ShiftProposalDto>();
        var skippedPastDays = new HashSet<DateOnly>();
        var unstaffedSessions = 0;
        var doctorCursor = 0;
        var nurseCursor = 0;

        foreach (var session in sessions)
        {
            if (session.Date < today)
            {
                skippedPastDays.Add(session.Date);
                continue;
            }

            // Shifts cannot start in the past, so a session already under way is left alone.
            if (session.Date == today && session.Start < nowTime)
                continue;

            var booth = session.Schedule.Booth;
            var boothLabel = booth?.DisplayLabel ?? session.Schedule.BoothLabel;
            var window = $"{session.Start:HH\\:mm}-{session.End:HH\\:mm}";
            var needed = false;

            foreach (var role in new[] { UserRole.DOCTOR, UserRole.NURSE })
            {
                var staffed =
                    hospitalShifts.Any(s => s.Affiliation.StaffRole == role && ShiftStaffsSession(s, session));
                if (staffed) continue;
                needed = true;

                var chosen = role == UserRole.DOCTOR
                    ? PickNextFreeStaff(doctors, ref doctorCursor, session.Date, session.Start, session.End, planned, externalBusy, availability)
                    : PickNextFreeStaff(nurses, ref nurseCursor, session.Date, session.Start, session.End, planned, externalBusy, availability);
                if (chosen == null) continue;

                var roleLabel = role == UserRole.DOCTOR ? "doctor" : "nurse";
                proposals.Add(new ShiftProposalDto
                {
                    AffiliationId = chosen.Id,
                    StaffName = GetStaffName(chosen.StaffUser),
                    StaffRole = chosen.StaffRole.ToString(),
                    ShiftDate = session.Date,
                    StartTime = session.Start,
                    EndTime = session.End,
                    BoothId = booth is { IsActive: true } ? booth.Id : null,
                    BoothOrStation = boothLabel,
                    Notes = $"{session.Schedule.VaccineName} session",
                    Reason = $"{session.Schedule.VaccineName} {window} needs a {roleLabel}"
                });
                planned.Add((chosen.Id, session.Date, session.Start, session.End, role));
            }

            if (needed) unstaffedSessions++;
        }

        var skippedNote = skippedPastDays.Count > 0
            ? $" Skipped {skippedPastDays.Count} past day(s) that can no longer be scheduled."
            : string.Empty;

        return new SuggestWeekCoverageResultDto
        {
            From = dto.From,
            To = dto.To,
            ActiveDoctors = doctors.Count,
            ActiveNurses = nurses.Count,
            ProposalCount = proposals.Count,
            SkippedPastDays = skippedPastDays.Count,
            Proposals = proposals,
            Message = proposals.Count > 0
                ? $"Suggested {proposals.Count} shift(s) for {unstaffedSessions} session(s) that still need staff.{skippedNote}"
                : unstaffedSessions > 0
                    ? $"No free staff for the {unstaffedSessions} session(s) that still need staff.{skippedNote}"
                    : $"Every upcoming session in this range is already staffed.{skippedNote}"
        };
    }

    /// <summary>Target unique doctors/nurses per day for a healthy clinic roster.</summary>
    private static int TargetDailyRoleCount(int activeCount)
    {
        if (activeCount <= 0) return 0;
        if (activeCount == 1) return 1;
        // Prefer morning + afternoon coverage when 2+ people are available.
        return Math.Min(2, activeCount);
    }

    private static StaffAffiliation? PickNextFreeStaff(
        List<StaffAffiliation> pool,
        ref int cursor,
        DateOnly date,
        TimeOnly start,
        TimeOnly end,
        List<(Guid AffiliationId, DateOnly ShiftDate, TimeOnly StartTime, TimeOnly EndTime, UserRole StaffRole)> planned,
        List<(Guid AffiliationId, DateOnly ShiftDate, TimeOnly StartTime, TimeOnly EndTime, UserRole StaffRole)> externalBusy,
        Dictionary<Guid, StaffAvailabilityHelper.Rules> availability)
    {
        if (pool.Count == 0) return null;

        bool IsFree(StaffAffiliation candidate) =>
            !planned.Concat(externalBusy).Any(p =>
                p.AffiliationId == candidate.Id &&
                p.ShiftDate == date &&
                p.StartTime < end &&
                start < p.EndTime) &&
            StaffAvailabilityHelper.IsAvailable(availability.GetValueOrDefault(candidate.Id), date, start, end);

        int ShiftCount(StaffAffiliation candidate) => planned.Count(p => p.AffiliationId == candidate.Id);

        // A doctor who offers only part of the week can only be used inside those hours,
        // so they go first there, but only while they have fewer shifts in the range than
        // their colleagues' average. Once level, the normal rotation applies.
        bool IsBehindFairShare(StaffAffiliation candidate)
        {
            var others = pool.Where(other => other.Id != candidate.Id).ToList();
            return others.Count > 0 && ShiftCount(candidate) < others.Average(ShiftCount);
        }

        var limited = pool.FirstOrDefault(candidate =>
            availability.GetValueOrDefault(candidate.Id)?.HasWeeklyLimit == true &&
            !planned.Any(p => p.AffiliationId == candidate.Id && p.ShiftDate == date) &&
            IsBehindFairShare(candidate) &&
            IsFree(candidate));
        if (limited != null) return limited;

        for (var attempt = 0; attempt < pool.Count; attempt++)
        {
            var candidate = pool[cursor % pool.Count];
            cursor++;

            if (IsFree(candidate))
                return candidate;
        }

        return null;
    }

    private static TimeOnly PadStart(TimeOnly start)
    {
        var padded = start.ToTimeSpan() - StaffAvailabilityHelper.TravelGap;
        return padded < TimeSpan.Zero ? TimeOnly.MinValue : TimeOnly.FromTimeSpan(padded);
    }

    private static TimeOnly PadEnd(TimeOnly end)
    {
        var padded = end.ToTimeSpan() + StaffAvailabilityHelper.TravelGap;
        return padded >= TimeSpan.FromDays(1) ? TimeOnly.MaxValue : TimeOnly.FromTimeSpan(padded);
    }

    private static TimeOnly ParseSuggestTime(string? value, TimeOnly fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
            return fallback;

        var trimmed = value.Trim();
        if (TimeOnly.TryParse(trimmed, out var parsed))
            return parsed;

        throw new InvalidOperationException($"Invalid time value: {value}");
    }

    public async Task<List<StaffShiftDto>> GetMyShiftsAsync(Guid staffUserId, DateOnly? from = null, DateOnly? to = null)
    {
        await EnsureActiveStaffAsync(staffUserId);

        var query = _context.StaffShifts
            .Include(s => s.Booth)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(s => s.Affiliation.StaffUserId == staffUserId && s.Affiliation.Status == AffiliationStatus.Active)
            .AsQueryable();

        if (from.HasValue) query = query.Where(s => s.ShiftDate >= from.Value);
        if (to.HasValue) query = query.Where(s => s.ShiftDate <= to.Value);

        var list = await query.OrderBy(s => s.ShiftDate).ThenBy(s => s.StartTime).ToListAsync();
        var mapped = list.Select(s => MapShift(s, s.Affiliation)).ToList();
        await ApplyCoverStatusAsync(mapped, viewerUserId: staffUserId);
        return mapped;
    }

    public async Task<StaffShiftDto> UpdateShiftAsync(Guid hospitalUserId, Guid shiftId, UpdateStaffShiftDto dto)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var shift = await _context.StaffShifts
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.Affiliation.HospitalUserId == hospitalUserId);

        if (shift == null)
            throw new KeyNotFoundException("Shift not found for this hospital.");

        if (shift.Affiliation.Status != AffiliationStatus.Active)
            throw new InvalidOperationException("Cannot update shifts for inactive staff affiliations.");

        if (shift.ShiftDate < HospitalToday())
            throw new InvalidOperationException("Cannot modify shifts that have already occurred.");

        // Updates may keep an already-started today's slot (booth/notes/end changes).
        // Only reject a past start when the hospital is actually moving the start time.
        ValidateShiftSchedule(dto.ShiftDate, dto.StartTime, dto.EndTime, existingStart: shift.StartTime, existingDate: shift.ShiftDate);

        await EnsureNoShiftOverlapAsync(
            hospitalUserId,
            shift.Affiliation.StaffUserId,
            dto.ShiftDate,
            dto.StartTime,
            dto.EndTime,
            excludeShiftId: shift.Id);

        // Booth or notes edits keep the slot, so only a moved slot is checked again.
        var slotMoved =
            shift.ShiftDate != dto.ShiftDate ||
            shift.StartTime.Hour != dto.StartTime.Hour ||
            shift.StartTime.Minute != dto.StartTime.Minute ||
            shift.EndTime.Hour != dto.EndTime.Hour ||
            shift.EndTime.Minute != dto.EndTime.Minute;
        if (slotMoved)
            await EnsureWithinAvailabilityAsync(shift.Affiliation, dto.ShiftDate, dto.StartTime, dto.EndTime, dto.OverrideAvailability);

        shift.ShiftDate = dto.ShiftDate;
        shift.StartTime = dto.StartTime;
        shift.EndTime = dto.EndTime;
        var (boothId, boothLabel) = await ResolveBoothAssignmentAsync(
            hospitalUserId,
            dto.BoothId,
            dto.BoothOrStation);
        shift.BoothId = boothId;
        shift.BoothOrStation = boothLabel;
        shift.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
        shift.UpdatedAt = DateTime.UtcNow;

        // Pending cover requests keep a snapshot of the shift for the inbox card;
        // refresh it so the hospital does not review an outdated date or window.
        var pendingSwaps = await _context.ShiftSwapRequests
            .Where(r => r.ShiftId == shift.Id && r.Status == ShiftSwapStatus.Pending)
            .ToListAsync();
        foreach (var swap in pendingSwaps)
        {
            swap.ShiftDate = shift.ShiftDate;
            swap.ShiftWindow = $"{shift.StartTime:HH\\:mm}–{shift.EndTime:HH\\:mm}";
            swap.BoothOrStation = shift.BoothOrStation;
            swap.UpdatedAt = DateTime.UtcNow;
        }

        await AddShiftAuditAsync(
            hospitalUserId,
            "STAFF_SHIFT_UPDATED",
            $"Shift {shift.Id} rescheduled to {dto.ShiftDate:yyyy-MM-dd} " +
            $"{dto.StartTime:HH\\:mm}-{dto.EndTime:HH\\:mm}");

        await _context.SaveChangesAsync();
        return MapShift(shift, shift.Affiliation);
    }

    public async Task DeleteShiftAsync(Guid hospitalUserId, Guid shiftId)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var shift = await _context.StaffShifts
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.Affiliation.HospitalUserId == hospitalUserId);

        if (shift == null)
            throw new KeyNotFoundException("Shift not found for this hospital.");

        if (shift.ShiftDate < HospitalToday())
            throw new InvalidOperationException("Cannot delete shifts that have already occurred.");

        // Close pending cover requests so they stop counting against the
        // requester's monthly quota and do not sit in the hospital inbox forever.
        var pendingSwaps = await _context.ShiftSwapRequests
            .Where(r => r.ShiftId == shift.Id && r.Status == ShiftSwapStatus.Pending)
            .ToListAsync();
        foreach (var swap in pendingSwaps)
        {
            swap.Status = ShiftSwapStatus.Cancelled;
            swap.DecidedByUserId = hospitalUserId;
            swap.DecidedAt = DateTime.UtcNow;
            swap.DecisionNote = "Shift removed by hospital";
            swap.UpdatedAt = DateTime.UtcNow;
        }

        _context.StaffShifts.Remove(shift);
        await AddShiftAuditAsync(
            hospitalUserId,
            "STAFF_SHIFT_DELETED",
            $"Shift for {GetStaffName(shift.Affiliation.StaffUser)} on {shift.ShiftDate:yyyy-MM-dd} " +
            $"{shift.StartTime:HH\\:mm}-{shift.EndTime:HH\\:mm} deleted");

        await _context.SaveChangesAsync();
    }

    /// <summary>
    /// Records who changed the roster. Agent-suggested shifts are only ever written
    /// through a hospital-approved request, so this is the human-approval trail.
    /// </summary>
    private async Task AddShiftAuditAsync(Guid hospitalUserId, string action, string details)
    {
        var hospital = await _context.Users.FirstAsync(u => u.Id == hospitalUserId);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = "HOSPITAL",
            Action = action,
            Details = details
        });
    }

    private async Task EnsureActiveHospitalAsync(Guid hospitalUserId)
    {
        var hospital = await _context.Users.FirstOrDefaultAsync(u => u.Id == hospitalUserId);
        if (hospital == null || hospital.Role != UserRole.HOSPITAL)
            throw new UnauthorizedAccessException("Only hospital accounts can perform this action.");
        if (hospital.Status != UserStatus.Active)
            throw new InvalidOperationException("Hospital account must be Active.");
    }

    /// <summary>Same checks as EnsureActiveHospitalAsync, plus the hospital profile id, in one query.</summary>
    private async Task<Guid?> EnsureActiveHospitalWithProfileAsync(Guid hospitalUserId)
    {
        var hospital = await _context.Users
            .AsNoTracking()
            .Where(u => u.Id == hospitalUserId)
            .Select(u => new { u.Role, u.Status, ProfileId = u.HospitalProfile != null ? (Guid?)u.HospitalProfile.Id : null })
            .FirstOrDefaultAsync();
        if (hospital == null || hospital.Role != UserRole.HOSPITAL)
            throw new UnauthorizedAccessException("Only hospital accounts can perform this action.");
        if (hospital.Status != UserStatus.Active)
            throw new InvalidOperationException("Hospital account must be Active.");
        return hospital.ProfileId;
    }

    private async Task EnsureActiveStaffAsync(Guid staffUserId)
    {
        var staff = await _context.Users.FirstOrDefaultAsync(u => u.Id == staffUserId);
        if (staff == null || staff.Role is not (UserRole.DOCTOR or UserRole.NURSE))
            throw new UnauthorizedAccessException("Only doctor or nurse accounts can perform this action.");
        if (staff.Status != UserStatus.Active)
            throw new InvalidOperationException("Staff account must be Active.");
    }

    private static void ValidateShiftSchedule(
        DateOnly shiftDate,
        TimeOnly start,
        TimeOnly end,
        TimeOnly? existingStart = null,
        DateOnly? existingDate = null)
    {
        var today = HospitalToday();
        if (shiftDate < today)
            throw new InvalidOperationException("Shifts cannot be scheduled on past dates.");

        if (end <= start)
            throw new InvalidOperationException("Shift end time must be after start time.");

        var durationHours = (end.ToTimeSpan() - start.ToTimeSpan()).TotalHours;
        if (durationHours > 12)
            throw new InvalidOperationException("A single shift cannot exceed 12 hours.");

        if (shiftDate == today)
        {
            // Compare HH:mm only — DB/JSON seconds can differ without a real schedule change.
            var startUnchanged =
                existingDate.HasValue &&
                existingStart.HasValue &&
                existingDate.Value == shiftDate &&
                existingStart.Value.Hour == start.Hour &&
                existingStart.Value.Minute == start.Minute;

            if (!startUnchanged)
            {
                var now = TimeOnly.FromDateTime(HospitalNow());
                if (start < now)
                    throw new InvalidOperationException("Shift start time cannot be in the past.");
            }
        }
    }

    /// <summary>
    /// Blocks overlapping shifts for the same staff member on the same date (any hospital),
    /// and shifts at another hospital that leave no time to travel.
    /// </summary>
    private async Task EnsureNoShiftOverlapAsync(
        Guid hospitalUserId,
        Guid staffUserId,
        DateOnly shiftDate,
        TimeOnly startTime,
        TimeOnly endTime,
        Guid? excludeShiftId = null)
    {
        var existing = await _context.StaffShifts
            .Include(s => s.Affiliation)
            .Where(s =>
                s.Affiliation.StaffUserId == staffUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate == shiftDate &&
                (!excludeShiftId.HasValue || s.Id != excludeShiftId.Value))
            .ToListAsync();

        var hasOverlap = existing.Any(s => startTime < s.EndTime && endTime > s.StartTime);
        if (hasOverlap)
        {
            throw new InvalidOperationException(
                "This staff member is already unavailable during that time slot.");
        }

        var tooCloseElsewhere = existing.Any(s =>
            s.Affiliation.HospitalUserId != hospitalUserId &&
            StaffAvailabilityHelper.WithinTravelGap(startTime, endTime, s.StartTime, s.EndTime));
        if (tooCloseElsewhere)
        {
            throw new InvalidOperationException(
                $"This staff member has a shift at another hospital within {StaffAvailabilityHelper.TravelGap.TotalMinutes:0} minutes of this slot. Leave travel time between hospitals.");
        }
    }

    /// <summary>
    /// Marks affiliations that have a shift covering hospital-local now.
    /// </summary>
    private async Task AttachLiveDutyAsync(List<StaffAffiliationDto> dtos)
    {
        if (dtos.Count == 0) return;

        var affiliationIds = dtos.Select(d => d.AffiliationId).ToList();
        var onDuty = await StaffDutyHelper.GetOnDutyAffiliationIdsAsync(_context, affiliationIds);
        var utcNow = DateTime.UtcNow;

        foreach (var dto in dtos)
        {
            dto.IsOnDutyNow = onDuty.Contains(dto.AffiliationId);
            dto.IsClockedIn =
                Enum.TryParse<DutyStatus>(dto.DutyStatus, out var status) &&
                StaffDutyHelper.IsClockedIn(status, dto.DutyUpdatedAt, utcNow);
        }
    }

    private async Task<(Guid? BoothId, string? Label)> ResolveBoothAssignmentAsync(
        Guid hospitalUserId,
        Guid? boothId,
        string? boothOrStation)
    {
        if (boothId.HasValue)
        {
            var booth = await _context.HospitalBooths.FirstOrDefaultAsync(b =>
                b.Id == boothId.Value &&
                b.HospitalUserId == hospitalUserId);
            if (booth == null)
                throw new KeyNotFoundException("Booth not found for this hospital.");
            if (!booth.IsActive)
                throw new InvalidOperationException("Cannot assign an inactive booth.");
            return (booth.Id, booth.DisplayLabel);
        }

        if (!string.IsNullOrWhiteSpace(boothOrStation))
            return (null, boothOrStation.Trim());

        return (null, null);
    }

    /// <summary>Active vaccine sessions at this booth that patients can still book.</summary>
    private async Task<List<VaccineSchedule>> GetUpcomingBoothSessionsAsync(Guid boothId)
    {
        var today = HospitalToday();
        return await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s =>
                s.BoothId == boothId &&
                s.Status == "Active" &&
                (s.ScheduleType == "Weekly"
                    ? s.EndDate == null || s.EndDate >= today
                    : s.SpecificDate >= today))
            .OrderBy(s => s.SpecificDate)
            .ToListAsync();
    }

    private static string BoothInUseMessage(HospitalBooth booth, List<VaccineSchedule> sessions)
    {
        var shown = sessions.Take(3).Select(s => s.ScheduleType == "Weekly"
            ? $"{s.VaccineName} ({s.DaysOfWeek})"
            : $"{s.VaccineName} {s.SpecificDate:yyyy-MM-dd}");
        var more = sessions.Count > 3 ? $" and {sessions.Count - 3} more" : string.Empty;
        return $"{booth.DisplayLabel} still has {sessions.Count} active session" +
               $"{(sessions.Count == 1 ? "" : "s")}: {string.Join(", ", shown)}{more}. " +
               "Cancel them under Sessions first.";
    }

    private static string NormalizeBoothCode(string? code)
    {
        var value = (code ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException("Booth code is required.");
        return value;
    }

    private static string NormalizeBoothName(string? name)
    {
        var value = (name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException("Booth name is required.");
        return value;
    }

    private async Task<List<Guid>> NormalizeBoothVaccineIdsAsync(IEnumerable<Guid>? vaccineIds)
    {
        var ids = (vaccineIds ?? Enumerable.Empty<Guid>())
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();
        if (ids.Count == 0)
            return ids;

        var known = await _context.Vaccines
            .Where(v => ids.Contains(v.Id))
            .Select(v => v.Id)
            .ToListAsync();
        if (known.Count != ids.Count)
            throw new InvalidOperationException("One or more vaccines were not found.");
        return ids;
    }

    private async Task ReplaceBoothVaccinesAsync(HospitalBooth booth, IEnumerable<Guid>? vaccineIds)
    {
        var ids = await NormalizeBoothVaccineIdsAsync(vaccineIds);
        var wanted = ids.ToHashSet();
        var existing = booth.Vaccines?.ToList() ?? new List<HospitalBoothVaccine>();
        var remove = existing.Where(link => !wanted.Contains(link.VaccineId)).ToList();
        if (remove.Count > 0)
            _context.HospitalBoothVaccines.RemoveRange(remove);

        var already = existing.Select(link => link.VaccineId).ToHashSet();
        booth.Vaccines ??= new List<HospitalBoothVaccine>();
        foreach (var vaccineId in ids)
        {
            if (already.Contains(vaccineId))
                continue;
            booth.Vaccines.Add(new HospitalBoothVaccine { BoothId = booth.Id, VaccineId = vaccineId });
        }
    }

    private async Task<HospitalBoothDto> LoadBoothDtoAsync(Guid boothId)
    {
        var booth = await _context.HospitalBooths
            .AsNoTracking()
            .Include(b => b.Vaccines)
            .ThenInclude(v => v.Vaccine)
            .FirstAsync(b => b.Id == boothId);
        return MapBooth(booth);
    }

    private static HospitalBoothDto MapBooth(HospitalBooth booth)
    {
        var links = booth.Vaccines?.ToList() ?? new List<HospitalBoothVaccine>();
        return new HospitalBoothDto
        {
            BoothId = booth.Id,
            Code = booth.Code,
            Name = booth.Name,
            DisplayLabel = booth.DisplayLabel,
            IsActive = booth.IsActive,
            SortOrder = booth.SortOrder,
            CreatedAt = booth.CreatedAt,
            UpdatedAt = booth.UpdatedAt,
            VaccineIds = links.Select(v => v.VaccineId).ToList(),
            VaccineNames = links
                .Select(v => v.Vaccine?.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name!)
                .ToList()
        };
    }

    private static string GetStaffName(User staffUser) => StaffNameFormatter.Format(staffUser);

    private static StaffAffiliationDto MapAffiliation(StaffAffiliation affiliation, User hospitalUser, User staffUser)
    {
        return new StaffAffiliationDto
        {
            AffiliationId = affiliation.Id,
            HospitalUserId = affiliation.HospitalUserId,
            HospitalName = hospitalUser.HospitalProfile?.HospitalName,
            HospitalLogoUrl = hospitalUser.HospitalProfile?.LogoUrl,
            StaffUserId = affiliation.StaffUserId,
            StaffRegistrationNumber = staffUser.RegistrationNumber ?? string.Empty,
            StaffName = GetStaffName(staffUser),
            StaffProfilePhotoUrl = staffUser.DoctorProfile?.ProfilePhotoUrl
                ?? staffUser.NurseProfile?.ProfilePhotoUrl,
            StaffRole = affiliation.StaffRole.ToString(),
            Specialization = staffUser.DoctorProfile?.Specialization,
            PhoneNumber = staffUser.DoctorProfile?.PhoneNumber ?? staffUser.NurseProfile?.PhoneNumber ?? staffUser.PhoneNumber,
            Email = staffUser.Email,
            Status = affiliation.Status.ToString(),
            DutyStatus = affiliation.DutyStatus.ToString(),
            DutyUpdatedAt = affiliation.DutyUpdatedAt,
            InvitedAt = affiliation.InvitedAt,
            RespondedAt = affiliation.RespondedAt,
            IsPrimary = affiliation.IsPrimary
        };
    }

    private static StaffShiftDto MapShift(StaffShift shift, StaffAffiliation affiliation)
    {
        return new StaffShiftDto
        {
            ShiftId = shift.Id,
            AffiliationId = shift.AffiliationId,
            StaffUserId = affiliation.StaffUserId,
            StaffName = GetStaffName(affiliation.StaffUser),
            StaffRole = affiliation.StaffRole.ToString(),
            StaffPhotoUrl = affiliation.StaffUser?.DoctorProfile?.ProfilePhotoUrl
                ?? affiliation.StaffUser?.NurseProfile?.ProfilePhotoUrl,
            ShiftDate = shift.ShiftDate,
            StartTime = shift.StartTime,
            EndTime = shift.EndTime,
            BoothId = shift.BoothId,
            BoothOrStation = shift.Booth?.DisplayLabel ?? shift.BoothOrStation,
            Notes = shift.Notes,
            CreatedAt = shift.CreatedAt,
            UpdatedAt = shift.UpdatedAt
        };
    }

    private async Task ApplyCoverStatusAsync(List<StaffShiftDto> shifts, Guid? viewerUserId)
    {
        if (shifts.Count == 0) return;

        var ids = shifts.Select(s => s.ShiftId).Distinct().ToList();
        var swaps = await _context.ShiftSwapRequests
            .AsNoTracking()
            .Include(r => r.RequesterUser).ThenInclude(u => u.DoctorProfile)
            .Include(r => r.RequesterUser).ThenInclude(u => u.NurseProfile)
            .Where(r => ids.Contains(r.ShiftId))
            .ToListAsync();

        if (swaps.Count == 0) return;

        var byShift = swaps
            .GroupBy(r => r.ShiftId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderBy(r => r.Status == ShiftSwapStatus.Pending
                        ? 0
                        : r.Status == ShiftSwapStatus.Approved ? 1 : 2)
                    .ThenByDescending(r => r.UpdatedAt)
                    .First());

        foreach (var dto in shifts)
        {
            if (!byShift.TryGetValue(dto.ShiftId, out var swap)) continue;

            var requesterName = GetStaffName(swap.RequesterUser);

            if (swap.Status == ShiftSwapStatus.Pending)
            {
                if (viewerUserId.HasValue && swap.RequesterUserId != viewerUserId.Value)
                    continue;
                dto.CoverStatus = "Requested";
                dto.CoverLabel = "Cover requested";
                dto.CoverForName = requesterName;
                continue;
            }

            if (swap.Status == ShiftSwapStatus.Approved)
            {
                if (viewerUserId.HasValue && swap.ReplacementUserId != viewerUserId.Value)
                    continue;
                dto.CoverStatus = "Covering";
                dto.CoverLabel = string.IsNullOrWhiteSpace(requesterName)
                    ? "Covering"
                    : $"Covering for {requesterName}";
                dto.CoverForName = requesterName;
                continue;
            }

            if (swap.Status == ShiftSwapStatus.Declined &&
                viewerUserId.HasValue &&
                swap.RequesterUserId == viewerUserId.Value)
            {
                dto.CoverStatus = "Declined";
                dto.CoverLabel = "Cover declined";
            }
        }
    }
}
