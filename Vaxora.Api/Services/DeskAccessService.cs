using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IDeskAccessService
{
    Task<DeskAccountDto> CreateDeskAccountAsync(Guid hospitalUserId, CreateDeskAccountDto dto);
    Task<List<DeskAccountDto>> GetDeskAccountsAsync(Guid hospitalUserId);
    Task RemoveDeskAccountAsync(Guid hospitalUserId, Guid affiliationId);

    /// <summary>
    /// The hospital a caller acts for: a hospital account acts for itself, a front-desk
    /// account acts for the hospital it is attached to. Anyone else is refused.
    /// </summary>
    Task<Guid> ResolveHospitalUserIdAsync(Guid actorUserId);
    Task<DeskContextDto> GetDeskContextAsync(Guid deskUserId);

    /// <summary>Records which front-desk person performed an action on the hospital's behalf.</summary>
    Task RecordActionAsync(Guid deskUserId, string action, string details);
}

/// <summary>
/// Front-desk accounts are personal logins a hospital creates for its reception staff.
/// They are linked to the hospital through a StaffAffiliation with role FRONT_DESK and
/// can only reach the endpoints that explicitly allow that role.
/// </summary>
public class DeskAccessService : IDeskAccessService
{
    private readonly ApplicationDbContext _context;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ILogger<DeskAccessService> _logger;

    public DeskAccessService(
        ApplicationDbContext context,
        IPasswordHasher passwordHasher,
        ILogger<DeskAccessService> logger)
    {
        _context = context;
        _passwordHasher = passwordHasher;
        _logger = logger;
    }

    public async Task<DeskAccountDto> CreateDeskAccountAsync(Guid hospitalUserId, CreateDeskAccountDto dto)
    {
        var hospital = await GetActiveHospitalAsync(hospitalUserId);

        var email = (dto.Email ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email))
            throw new InvalidOperationException("Email is required.");
        if (string.IsNullOrWhiteSpace(dto.Password) || dto.Password.Length < 6)
            throw new InvalidOperationException("Password must be at least 6 characters.");

        var fullName = (dto.FullName ?? string.Empty).Trim();
        if (fullName.Length == 0)
            throw new InvalidOperationException("Full name is required.");
        var phoneNumber = string.IsNullOrWhiteSpace(dto.PhoneNumber) ? null : dto.PhoneNumber.Trim();

        var deskUser = await _context.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (deskUser != null)
        {
            // A removed front-desk account can be brought back by the hospital it belonged to;
            // any other account keeps its email.
            var deskLinks = deskUser.Role == UserRole.FRONT_DESK
                ? await _context.StaffAffiliations
                    .Where(a => a.StaffUserId == deskUser.Id)
                    .Select(a => new { a.HospitalUserId, a.Status })
                    .ToListAsync()
                : null;
            var canRestore = deskLinks != null &&
                deskLinks.All(a => a.Status != AffiliationStatus.Active) &&
                deskLinks.Any(a => a.HospitalUserId == hospitalUserId);
            if (!canRestore)
                throw new InvalidOperationException("An account with this email already exists.");

            deskUser.PasswordHash = _passwordHasher.HashPassword(dto.Password);
            deskUser.FullName = fullName;
            deskUser.PhoneNumber = phoneNumber;
            deskUser.Status = UserStatus.Active;
            deskUser.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            deskUser = new User
            {
                Email = email,
                FullName = fullName,
                PhoneNumber = phoneNumber,
                PasswordHash = _passwordHasher.HashPassword(dto.Password),
                Role = UserRole.FRONT_DESK,
                Status = UserStatus.Active,
                RegistrationNumber = await GenerateDeskRegistrationNumberAsync()
            };
            _context.Users.Add(deskUser);
        }

        var affiliation = new StaffAffiliation
        {
            HospitalUserId = hospitalUserId,
            StaffUserId = deskUser.Id,
            StaffRole = UserRole.FRONT_DESK,
            Status = AffiliationStatus.Active,
            DutyStatus = DutyStatus.Off,
            InvitedByUserId = hospitalUserId,
            InvitedAt = DateTime.UtcNow,
            RespondedAt = DateTime.UtcNow
        };
        _context.StaffAffiliations.Add(affiliation);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = "HOSPITAL",
            Action = "DESK_ACCOUNT_CREATED",
            Details = $"Hospital created front-desk account {deskUser.RegistrationNumber} ({deskUser.Email})"
        });

        await _context.SaveChangesAsync();
        _logger.LogInformation("Hospital {HospitalId} created front-desk account {DeskUserId}", hospitalUserId, deskUser.Id);

        return MapAccount(affiliation, deskUser);
    }

    public async Task<List<DeskAccountDto>> GetDeskAccountsAsync(Guid hospitalUserId)
    {
        await GetActiveHospitalAsync(hospitalUserId);

        var list = await _context.StaffAffiliations
            .AsNoTracking()
            .Include(a => a.StaffUser)
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.StaffRole == UserRole.FRONT_DESK &&
                a.Status == AffiliationStatus.Active)
            .OrderBy(a => a.InvitedAt)
            .ToListAsync();

        return list.Select(a => MapAccount(a, a.StaffUser)).ToList();
    }

    public async Task RemoveDeskAccountAsync(Guid hospitalUserId, Guid affiliationId)
    {
        var hospital = await GetActiveHospitalAsync(hospitalUserId);

        var affiliation = await _context.StaffAffiliations
            .Include(a => a.StaffUser)
            .FirstOrDefaultAsync(a =>
                a.Id == affiliationId &&
                a.HospitalUserId == hospitalUserId &&
                a.StaffRole == UserRole.FRONT_DESK);

        if (affiliation == null)
            throw new KeyNotFoundException("Front-desk account not found for this hospital.");

        if (affiliation.Status == AffiliationStatus.Removed)
            throw new InvalidOperationException("Front-desk account is already removed.");

        affiliation.Status = AffiliationStatus.Removed;
        affiliation.DutyStatus = DutyStatus.Off;
        affiliation.DutyUpdatedAt = DateTime.UtcNow;
        affiliation.DutyUpdatedByUserId = hospitalUserId;

        // A front-desk login has no purpose without its hospital, so close it completely.
        affiliation.StaffUser.Status = UserStatus.Suspended;
        affiliation.StaffUser.RefreshToken = null;
        affiliation.StaffUser.RefreshTokenExpiryTime = null;
        affiliation.StaffUser.UpdatedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = "HOSPITAL",
            Action = "DESK_ACCOUNT_REMOVED",
            Details = $"Hospital removed front-desk account {affiliation.StaffUser.RegistrationNumber} ({affiliation.StaffUser.Email})"
        });

        await _context.SaveChangesAsync();
    }

    public async Task<Guid> ResolveHospitalUserIdAsync(Guid actorUserId)
    {
        var actor = await _context.Users
            .AsNoTracking()
            .Where(u => u.Id == actorUserId)
            .Select(u => new { u.Role, u.Status })
            .FirstOrDefaultAsync();

        if (actor == null)
            throw new UnauthorizedAccessException("Invalid user.");

        if (actor.Role == UserRole.HOSPITAL)
            return actorUserId;

        if (actor.Role != UserRole.FRONT_DESK || actor.Status != UserStatus.Active)
            throw new UnauthorizedAccessException("Only the hospital or its front desk can perform this action.");

        var hospitalUserId = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a =>
                a.StaffUserId == actorUserId &&
                a.StaffRole == UserRole.FRONT_DESK &&
                a.Status == AffiliationStatus.Active &&
                a.HospitalUser.Status == UserStatus.Active)
            .Select(a => (Guid?)a.HospitalUserId)
            .FirstOrDefaultAsync();

        return hospitalUserId
            ?? throw new UnauthorizedAccessException("This front-desk account is not attached to an active hospital.");
    }

    public async Task<DeskContextDto> GetDeskContextAsync(Guid deskUserId)
    {
        var hospitalUserId = await ResolveHospitalUserIdAsync(deskUserId);

        var hospital = await _context.Users
            .AsNoTracking()
            .Include(u => u.HospitalProfile)
            .FirstAsync(u => u.Id == hospitalUserId);

        return new DeskContextDto
        {
            HospitalUserId = hospitalUserId,
            HospitalName = hospital.HospitalProfile?.HospitalName ?? "Hospital",
            HospitalLogoUrl = hospital.HospitalProfile?.LogoUrl,
            HospitalRegistrationNumber = hospital.RegistrationNumber,
            HospitalType = hospital.HospitalProfile?.HospitalType,
            OperatingHours = hospital.HospitalProfile?.OperatingHours
        };
    }

    public async Task RecordActionAsync(Guid deskUserId, string action, string details)
    {
        var email = await _context.Users
            .AsNoTracking()
            .Where(u => u.Id == deskUserId)
            .Select(u => u.Email)
            .FirstOrDefaultAsync();

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = deskUserId,
            UserEmail = email,
            Role = UserRole.FRONT_DESK.ToString(),
            Action = action,
            Details = details
        });
        await _context.SaveChangesAsync();
    }

    private async Task<User> GetActiveHospitalAsync(Guid hospitalUserId)
    {
        var hospital = await _context.Users.FirstOrDefaultAsync(u => u.Id == hospitalUserId);
        if (hospital == null || hospital.Role != UserRole.HOSPITAL)
            throw new UnauthorizedAccessException("Only hospital accounts can perform this action.");
        if (hospital.Status != UserStatus.Active)
            throw new InvalidOperationException("Hospital account must be Active.");
        return hospital;
    }

    /// <summary>
    /// Front-desk numbers are random rather than sequential so this role needs no new database sequence.
    /// </summary>
    private async Task<string> GenerateDeskRegistrationNumberAsync()
    {
        while (true)
        {
            var candidate = $"VAX-F-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";
            if (!await _context.Users.AnyAsync(u => u.RegistrationNumber == candidate))
                return candidate;
        }
    }

    private static DeskAccountDto MapAccount(StaffAffiliation affiliation, User deskUser)
    {
        return new DeskAccountDto
        {
            AffiliationId = affiliation.Id,
            UserId = deskUser.Id,
            FullName = deskUser.FullName ?? string.Empty,
            PhoneNumber = deskUser.PhoneNumber,
            Email = deskUser.Email,
            RegistrationNumber = deskUser.RegistrationNumber ?? string.Empty,
            Status = affiliation.Status.ToString(),
            CreatedAt = affiliation.InvitedAt,
            LastLoginAt = deskUser.LastLoginAt
        };
    }
}
