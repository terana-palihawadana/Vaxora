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
            .Where(a => a.HospitalUserId == hospitalUserId)
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
        return result;
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

        await EnsureNoShiftOverlapAsync(affiliation.StaffUserId, dto.ShiftDate, dto.StartTime, dto.EndTime);

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
            .Where(a => a.HospitalUserId == hospitalUserId && a.Status == AffiliationStatus.Active)
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

        return shifts
            .Where(s => localByStaff.ContainsKey(s.Affiliation.StaffUserId))
            .Select(s => new StaffBusyBlockDto
            {
                StaffUserId = s.Affiliation.StaffUserId,
                LocalAffiliationId = localByStaff[s.Affiliation.StaffUserId],
                ShiftDate = s.ShiftDate,
                StartTime = s.StartTime,
                EndTime = s.EndTime,
                IsExternal = s.Affiliation.HospitalUserId != hospitalUserId
            })
            .ToList();
    }

    public async Task<StaffCoverageReportDto> GetCoverageReportAsync(Guid hospitalUserId, DateOnly from, DateOnly to)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        if (to < from)
            throw new InvalidOperationException("Coverage end date must be on or after the start date.");

        if (to.DayNumber - from.DayNumber > 31)
            throw new InvalidOperationException("Coverage range cannot exceed 31 days.");

        var activeAffiliations = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a => a.HospitalUserId == hospitalUserId && a.Status == AffiliationStatus.Active)
            .ToListAsync();

        var activeDoctors = activeAffiliations.Count(a => a.StaffRole == UserRole.DOCTOR);
        var activeNurses = activeAffiliations.Count(a => a.StaffRole == UserRole.NURSE);

        var onDutyStaff = (await StaffDutyHelper.GetOnDutyAffiliationIdsAsync(
            _context,
            activeAffiliations.Select(a => a.Id).ToList())).Count;

        var shifts = await _context.StaffShifts
            .AsNoTracking()
            .Include(s => s.Affiliation)
            .Where(s =>
                s.Affiliation.HospitalUserId == hospitalUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate >= from &&
                s.ShiftDate <= to)
            .ToListAsync();

        // Coverage only matters on days the hospital actually runs vaccine sessions;
        // closed days and past days must not show as "Low".
        var clinicDays = await GetClinicDaysAsync(hospitalUserId, from, to);
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
    private async Task<HashSet<DateOnly>> GetClinicDaysAsync(Guid hospitalUserId, DateOnly from, DateOnly to)
    {
        var hospitalProfileId = await _context.HospitalProfiles
            .AsNoTracking()
            .Where(h => h.UserId == hospitalUserId)
            .Select(h => (Guid?)h.Id)
            .FirstOrDefaultAsync();

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
    /// Suggest a realistic clinic roster for Low/Partial days: AM + PM slots,
    /// rotating doctors and nurses, targeting ~2 of each role when available.
    /// Does not persist — hospital must approve proposals in the UI.
    /// </summary>
    public async Task<SuggestWeekCoverageResultDto> SuggestWeekCoverageAsync(
        Guid hospitalUserId,
        SuggestWeekCoverageDto dto)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        if (dto.To < dto.From)
            throw new InvalidOperationException("End date must be on or after start date.");

        if ((dto.To.DayNumber - dto.From.DayNumber) > 31)
            throw new InvalidOperationException("Suggest range cannot exceed 31 days.");

        // Defaults kept for API compatibility; real suggestions use AM/PM clinic slots.
        _ = ParseSuggestTime(dto.DefaultStart, new TimeOnly(8, 0));
        _ = ParseSuggestTime(dto.DefaultEnd, new TimeOnly(16, 0));

        var coverage = await GetCoverageReportAsync(hospitalUserId, dto.From, dto.To);

        var activeStaff = await _context.StaffAffiliations
            .AsNoTracking()
            .Include(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(a => a.HospitalUserId == hospitalUserId && a.Status == AffiliationStatus.Active)
            .OrderBy(a => a.InvitedAt)
            .ToListAsync();

        var existingShifts = await _context.StaffShifts
            .AsNoTracking()
            .Include(s => s.Affiliation)
            .Where(s =>
                s.Affiliation.HospitalUserId == hospitalUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate >= dto.From &&
                s.ShiftDate <= dto.To)
            .ToListAsync();

        var doctors = activeStaff.Where(a => a.StaffRole == UserRole.DOCTOR).ToList();
        var nurses = activeStaff.Where(a => a.StaffRole == UserRole.NURSE).ToList();
        var targetDoctors = TargetDailyRoleCount(doctors.Count);
        var targetNurses = TargetDailyRoleCount(nurses.Count);

        var activeBooths = await _context.HospitalBooths
            .AsNoTracking()
            .Where(b => b.HospitalUserId == hospitalUserId && b.IsActive)
            .OrderBy(b => b.SortOrder)
            .ThenBy(b => b.Code)
            .ToListAsync();

        var clinicSlots = new (TimeOnly Start, TimeOnly End, string SlotLabel)[]
        {
            (new TimeOnly(8, 0), new TimeOnly(12, 0), "Morning"),
            (new TimeOnly(13, 0), new TimeOnly(17, 0), "Afternoon")
        };

        var proposals = new List<ShiftProposalDto>();
        var planned = existingShifts
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
        var externalBusy = externalShifts
            .Select(s => (localAffiliationByStaff[s.StaffUserId], s.ShiftDate, s.StartTime, s.EndTime, UserRole.DOCTOR))
            .ToList();

        var today = HospitalToday();
        var nowTime = TimeOnly.FromDateTime(HospitalNow());
        var skippedPastDays = 0;
        var doctorCursor = 0;
        var nurseCursor = 0;
        var boothCursor = 0;

        foreach (var day in coverage.Days.Where(d => d.CoverageLevel is "Low" or "Partial"))
        {
            if (day.Date < today)
            {
                skippedPastDays++;
                continue;
            }

            foreach (var (slotStart, slotEnd, slotLabel) in clinicSlots)
            {
                if (day.Date == today && slotStart < nowTime)
                    continue;

                Guid? boothId = null;
                string station;
                if (activeBooths.Count > 0)
                {
                    var booth = activeBooths[boothCursor % activeBooths.Count];
                    boothCursor++;
                    boothId = booth.Id;
                    station = $"{booth.DisplayLabel} — {slotLabel}";
                }
                else
                {
                    station = slotLabel;
                }

                var dayDocs = planned
                    .Where(p => p.ShiftDate == day.Date && p.StaffRole == UserRole.DOCTOR)
                    .Select(p => p.AffiliationId)
                    .Distinct()
                    .Count();

                if (dayDocs < targetDoctors)
                {
                    var doctor = PickNextFreeStaff(
                        doctors,
                        ref doctorCursor,
                        day.Date,
                        slotStart,
                        slotEnd,
                        planned,
                        externalBusy);
                    if (doctor != null)
                    {
                        proposals.Add(new ShiftProposalDto
                        {
                            AffiliationId = doctor.Id,
                            StaffName = GetStaffName(doctor.StaffUser),
                            StaffRole = doctor.StaffRole.ToString(),
                            ShiftDate = day.Date,
                            StartTime = slotStart,
                            EndTime = slotEnd,
                            BoothId = boothId,
                            BoothOrStation = station,
                            Notes = "Suggested clinic coverage (AM/PM rotation)",
                            Reason = $"{day.Summary} — doctor for {station}"
                        });
                        planned.Add((doctor.Id, day.Date, slotStart, slotEnd, UserRole.DOCTOR));
                    }
                }

                var dayNurses = planned
                    .Where(p => p.ShiftDate == day.Date && p.StaffRole == UserRole.NURSE)
                    .Select(p => p.AffiliationId)
                    .Distinct()
                    .Count();

                if (dayNurses < targetNurses)
                {
                    var nurse = PickNextFreeStaff(
                        nurses,
                        ref nurseCursor,
                        day.Date,
                        slotStart,
                        slotEnd,
                        planned,
                        externalBusy);
                    if (nurse != null)
                    {
                        proposals.Add(new ShiftProposalDto
                        {
                            AffiliationId = nurse.Id,
                            StaffName = GetStaffName(nurse.StaffUser),
                            StaffRole = nurse.StaffRole.ToString(),
                            ShiftDate = day.Date,
                            StartTime = slotStart,
                            EndTime = slotEnd,
                            BoothId = boothId,
                            BoothOrStation = station,
                            Notes = "Suggested clinic coverage (AM/PM rotation)",
                            Reason = $"{day.Summary} — nurse for {station}"
                        });
                        planned.Add((nurse.Id, day.Date, slotStart, slotEnd, UserRole.NURSE));
                    }
                }
            }
        }

        var skippedNote = skippedPastDays > 0
            ? $" Skipped {skippedPastDays} past day(s) that can no longer be scheduled."
            : string.Empty;

        return new SuggestWeekCoverageResultDto
        {
            From = dto.From,
            To = dto.To,
            ActiveDoctors = doctors.Count,
            ActiveNurses = nurses.Count,
            ProposalCount = proposals.Count,
            SkippedPastDays = skippedPastDays,
            Proposals = proposals,
            Message = proposals.Count > 0
                ? $"Suggested {proposals.Count} AM/PM shift(s) with staff rotation (target {targetDoctors}D + {targetNurses}N per day).{skippedNote}"
                : $"No upcoming Low/Partial days needing new shifts, or no free staff available.{skippedNote}"
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
        List<(Guid AffiliationId, DateOnly ShiftDate, TimeOnly StartTime, TimeOnly EndTime, UserRole StaffRole)> externalBusy)
    {
        if (pool.Count == 0) return null;

        for (var attempt = 0; attempt < pool.Count; attempt++)
        {
            var candidate = pool[cursor % pool.Count];
            cursor++;

            var conflict = planned.Concat(externalBusy).Any(p =>
                p.AffiliationId == candidate.Id &&
                p.ShiftDate == date &&
                p.StartTime < end &&
                start < p.EndTime);

            if (!conflict)
                return candidate;
        }

        return null;
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
            shift.Affiliation.StaffUserId,
            dto.ShiftDate,
            dto.StartTime,
            dto.EndTime,
            excludeShiftId: shift.Id);

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
    /// Blocks overlapping shifts for the same staff member on the same date (any hospital).
    /// </summary>
    private async Task EnsureNoShiftOverlapAsync(
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
               "Cancel them in Schedules first.";
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
            RespondedAt = affiliation.RespondedAt
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
