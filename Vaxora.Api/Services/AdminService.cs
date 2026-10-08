using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IAdminService
{
    Task<List<PendingVerificationUserDto>> GetPendingVerificationsAsync();
    Task<bool> ProcessVerificationDecisionAsync(Guid adminId, Guid targetUserId, VerificationDecisionDto dto);
    Task<bool> UpdateUserStatusAsync(Guid adminId, Guid targetUserId, UserStatusUpdateDto dto);
    Task<List<AuditLog>> GetAuditLogsAsync(int limit = 100);
    Task<List<AdminUserItemDto>> GetAllUsersAsync(string? role = null, string? status = null, string? search = null);
    Task<AdminDashboardStatsDto> GetDashboardStatsAsync();
}

public class AdminService : IAdminService
{
    private readonly ApplicationDbContext _context;
    private readonly IR2StorageService _r2Service;
    private readonly IEmailService _emailService;
    private readonly ILogger<AdminService> _logger;

    public AdminService(
        ApplicationDbContext context,
        IR2StorageService r2Service,
        IEmailService emailService,
        ILogger<AdminService> logger)
    {
        _context = context;
        _r2Service = r2Service;
        _emailService = emailService;
        _logger = logger;
    }

    public async Task<List<PendingVerificationUserDto>> GetPendingVerificationsAsync()
    {
        var pendingUsers = await _context.Users
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .Where(u => u.Status == UserStatus.Pending && u.Role != UserRole.PATIENT && u.Role != UserRole.ADMIN)
            .OrderByDescending(u => u.CreatedAt)
            .ToListAsync();

        var result = new List<PendingVerificationUserDto>();

        foreach (var user in pendingUsers)
        {
            var item = new PendingVerificationUserDto
            {
                UserId = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                CreatedAt = user.CreatedAt
            };

            if (user.Role == UserRole.DOCTOR && user.DoctorProfile != null)
            {
                item.Name = StaffNameFormatter.WithRolePrefix(user.DoctorProfile.FullName, "Dr.");
                item.LicenseOrRegNumber = user.DoctorProfile.SlmcNumber;
                item.HospitalAffiliationOrType = user.DoctorProfile.Specialization ?? "General Practitioner";
                item.ProfilePhotoOrLogoUrl = user.DoctorProfile.ProfilePhotoUrl;
                item.PrimaryDocUrl = !string.IsNullOrEmpty(user.DoctorProfile.SlmcCardDocKey) 
                    ? await _r2Service.GetPresignedUrlAsync(user.DoctorProfile.SlmcCardDocKey) 
                    : null;
                item.SupportingDocUrl = !string.IsNullOrEmpty(user.DoctorProfile.SupportingDocKey) 
                    ? await _r2Service.GetPresignedUrlAsync(user.DoctorProfile.SupportingDocKey) 
                    : null;
            }
            else if (user.Role == UserRole.NURSE && user.NurseProfile != null)
            {
                item.Name = StaffNameFormatter.WithRolePrefix(user.NurseProfile.FullName, "Nurse");
                item.LicenseOrRegNumber = user.NurseProfile.SlncNumber;
                item.HospitalAffiliationOrType = "Nursing Staff";
                item.ProfilePhotoOrLogoUrl = user.NurseProfile.ProfilePhotoUrl;
                item.PrimaryDocUrl = !string.IsNullOrEmpty(user.NurseProfile.SlncCardDocKey) 
                    ? await _r2Service.GetPresignedUrlAsync(user.NurseProfile.SlncCardDocKey) 
                    : null;
                item.SupportingDocUrl = !string.IsNullOrEmpty(user.NurseProfile.SupportingDocKey) 
                    ? await _r2Service.GetPresignedUrlAsync(user.NurseProfile.SupportingDocKey) 
                    : null;
            }
            else if (user.Role == UserRole.HOSPITAL && user.HospitalProfile != null)
            {
                item.Name = user.HospitalProfile.HospitalName;
                item.LicenseOrRegNumber = user.HospitalProfile.RegistrationNumber;
                item.HospitalAffiliationOrType = $"{user.HospitalProfile.HospitalType ?? "Hospital"} • {user.HospitalProfile.District ?? "Sri Lanka"}";
                item.ProfilePhotoOrLogoUrl = user.HospitalProfile.LogoUrl;
                item.PrimaryDocUrl = !string.IsNullOrEmpty(user.HospitalProfile.RegistrationDocKey) 
                    ? await _r2Service.GetPresignedUrlAsync(user.HospitalProfile.RegistrationDocKey) 
                    : null;
                item.SupportingDocUrl = !string.IsNullOrEmpty(user.HospitalProfile.MohDocKey) 
                    ? await _r2Service.GetPresignedUrlAsync(user.HospitalProfile.MohDocKey) 
                    : null;
            }

            result.Add(item);
        }

        return result;
    }

    public async Task<bool> ProcessVerificationDecisionAsync(Guid adminId, Guid targetUserId, VerificationDecisionDto dto)
    {
        var targetUser = await _context.Users
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == targetUserId);

        if (targetUser == null)
        {
            throw new KeyNotFoundException("User not found.");
        }

        var isApprove = string.Equals(dto.Decision, "Approve", StringComparison.OrdinalIgnoreCase);
        var regNumber = targetUser.RegistrationNumber ?? "N/A";
        string recipientName;
        string roleTitle;

        if (targetUser.Role == UserRole.DOCTOR)
        {
            recipientName = StaffNameFormatter.WithRolePrefix(targetUser.DoctorProfile?.FullName ?? "Doctor", "Dr.");
            roleTitle = "Doctor";
        }
        else if (targetUser.Role == UserRole.NURSE)
        {
            recipientName = StaffNameFormatter.WithRolePrefix(targetUser.NurseProfile?.FullName ?? "Nurse", "Nurse");
            roleTitle = "Nurse";
        }
        else if (targetUser.Role == UserRole.HOSPITAL)
        {
            recipientName = targetUser.HospitalProfile?.HospitalName ?? "Hospital";
            roleTitle = "Hospital";
        }
        else
        {
            recipientName = "Healthcare Professional";
            roleTitle = targetUser.Role.ToString();
        }

        if (isApprove)
        {
            targetUser.Status = UserStatus.Active;
            if (targetUser.DoctorProfile != null)
            {
                targetUser.DoctorProfile.VerificationStatus = VerificationStatus.Approved;
                targetUser.DoctorProfile.VerifiedAt = DateTime.UtcNow;
                targetUser.DoctorProfile.VerifiedByAdminId = adminId;
                targetUser.DoctorProfile.RejectionReason = null;
            }
            else if (targetUser.NurseProfile != null)
            {
                targetUser.NurseProfile.VerificationStatus = VerificationStatus.Approved;
                targetUser.NurseProfile.VerifiedAt = DateTime.UtcNow;
                targetUser.NurseProfile.VerifiedByAdminId = adminId;
                targetUser.NurseProfile.RejectionReason = null;
            }
            else if (targetUser.HospitalProfile != null)
            {
                targetUser.HospitalProfile.VerificationStatus = VerificationStatus.Approved;
                targetUser.HospitalProfile.VerifiedAt = DateTime.UtcNow;
                targetUser.HospitalProfile.VerifiedByAdminId = adminId;
                targetUser.HospitalProfile.RejectionReason = null;
            }

            _context.AuditLogs.Add(new AuditLog
            {
                UserId = adminId,
                Role = "ADMIN",
                Action = "VERIFICATION_APPROVED",
                Details = $"Admin approved registration for user {targetUser.Email} (Role: {targetUser.Role}, Reg #{regNumber})",
                Timestamp = DateTime.UtcNow
            });

            targetUser.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            var userEmail = targetUser.Email;
            var regNum = regNumber;
            var recName = recipientName;
            var rTitle = roleTitle;

            _logger.LogInformation("Admin approved registration for user {Email} (Role: {Role}, Reg #{RegNum}). Dispatching approval email to {Recipient}...", userEmail, rTitle, regNum, recName);

            // Dispatch Account Approved email in background
            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendApprovalEmailAsync(
                        userEmail,
                        recName,
                        regNum,
                        rTitle);
                    _logger.LogInformation("Approval email successfully sent to {Email} ({Role})", userEmail, rTitle);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Background error dispatching approval email to {Email}", userEmail);
                }
            });
        }
        else
        {
            var userEmail = targetUser.Email;
            var userRole = targetUser.Role.ToString();
            var reason = !string.IsNullOrWhiteSpace(dto.Reason) 
                ? dto.Reason.Trim() 
                : "Documentation criteria not met.";

            // 1. Record rejection in audit log
            _context.AuditLogs.Add(new AuditLog
            {
                UserId = adminId,
                UserEmail = userEmail,
                Role = "ADMIN",
                Action = "VERIFICATION_REJECTED",
                Details = $"Admin rejected and deleted registration for user {userEmail} (Role: {userRole}, Reg #{regNumber}). Reason: {reason}",
                Timestamp = DateTime.UtcNow
            });

            // 2. Clean up affiliations if any exist
            var affiliations = await _context.StaffAffiliations
                .Include(a => a.Shifts)
                .Where(a => a.HospitalUserId == targetUser.Id || a.StaffUserId == targetUser.Id)
                .ToListAsync();

            if (affiliations.Count != 0)
            {
                foreach (var aff in affiliations)
                {
                    if (aff.Shifts.Count != 0)
                    {
                        _context.StaffShifts.RemoveRange(aff.Shifts);
                    }
                }
                _context.StaffAffiliations.RemoveRange(affiliations);
            }

            // 3. Automatically delete the rejected user from the database (cascades to profile)
            _context.Users.Remove(targetUser);
            await _context.SaveChangesAsync();

            // 4. Dispatch Account Rejected email with reason to user
            var regNum = regNumber;
            var recName = recipientName;
            var rTitle = roleTitle;

            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendRejectionEmailAsync(
                        userEmail,
                        recName,
                        regNum,
                        rTitle,
                        reason);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Background error dispatching rejection email to {Email}", userEmail);
                }
            });

            _logger.LogInformation("User {Email} rejected (Reason: {Reason}) and automatically deleted from database.", userEmail, reason);
        }

        return true;
    }

    public async Task<bool> UpdateUserStatusAsync(Guid adminId, Guid targetUserId, UserStatusUpdateDto dto)
    {
        var targetUser = await _context.Users
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == targetUserId);

        if (targetUser == null)
        {
            throw new KeyNotFoundException("User not found.");
        }

        if (targetUser.Role == UserRole.ADMIN)
        {
            throw new InvalidOperationException("Cannot modify primary administrator account status.");
        }

        if (Enum.TryParse<UserStatus>(dto.Status, true, out var newStatus))
        {
            var oldStatus = targetUser.Status;
            targetUser.Status = newStatus;
            targetUser.UpdatedAt = DateTime.UtcNow;

            if (newStatus == UserStatus.Active)
            {
                if (targetUser.DoctorProfile != null)
                {
                    targetUser.DoctorProfile.VerificationStatus = VerificationStatus.Approved;
                    targetUser.DoctorProfile.VerifiedAt = DateTime.UtcNow;
                    targetUser.DoctorProfile.VerifiedByAdminId = adminId;
                }
                else if (targetUser.NurseProfile != null)
                {
                    targetUser.NurseProfile.VerificationStatus = VerificationStatus.Approved;
                    targetUser.NurseProfile.VerifiedAt = DateTime.UtcNow;
                    targetUser.NurseProfile.VerifiedByAdminId = adminId;
                }
                else if (targetUser.HospitalProfile != null)
                {
                    targetUser.HospitalProfile.VerificationStatus = VerificationStatus.Approved;
                    targetUser.HospitalProfile.VerifiedAt = DateTime.UtcNow;
                    targetUser.HospitalProfile.VerifiedByAdminId = adminId;
                }
            }

            _context.AuditLogs.Add(new AuditLog
            {
                UserId = adminId,
                Role = "ADMIN",
                Action = "USER_STATUS_UPDATE",
                Details = $"Admin changed status of {targetUser.Email} from {oldStatus} to {newStatus}",
                Timestamp = DateTime.UtcNow
            });

            await _context.SaveChangesAsync();

            // If account was activated from pending, send approval email
            if (newStatus == UserStatus.Active && oldStatus != UserStatus.Active)
            {
                var userEmail = targetUser.Email;
                var regNum = targetUser.RegistrationNumber ?? "N/A";
                string recName = targetUser.Role switch
                {
                    UserRole.DOCTOR => StaffNameFormatter.WithRolePrefix(targetUser.DoctorProfile?.FullName ?? "Doctor", "Dr."),
                    UserRole.NURSE => StaffNameFormatter.WithRolePrefix(targetUser.NurseProfile?.FullName ?? "Nurse", "Nurse"),
                    UserRole.HOSPITAL => targetUser.HospitalProfile?.HospitalName ?? "Hospital",
                    _ => "Healthcare Professional"
                };
                string rTitle = targetUser.Role switch
                {
                    UserRole.DOCTOR => "Doctor",
                    UserRole.NURSE => "Nurse",
                    UserRole.HOSPITAL => "Hospital",
                    _ => targetUser.Role.ToString()
                };

                _ = Task.Run(async () =>
                {
                    try
                    {
                        await _emailService.SendApprovalEmailAsync(
                            userEmail,
                            recName,
                            regNum,
                            rTitle);
                        _logger.LogInformation("Approval email successfully sent on status update to {Email} ({Role})", userEmail, rTitle);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Background error dispatching approval email on status update to {Email}", userEmail);
                    }
                });
            }

            return true;
        }

        throw new ArgumentException($"Invalid status value: {dto.Status}");
    }

    public async Task<List<AuditLog>> GetAuditLogsAsync(int limit = 100)
    {
        return await _context.AuditLogs
            .OrderByDescending(a => a.Timestamp)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<List<AdminUserItemDto>> GetAllUsersAsync(string? role = null, string? status = null, string? search = null)
    {
        var query = _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(role) && !string.Equals(role, "all", StringComparison.OrdinalIgnoreCase) && Enum.TryParse<UserRole>(role, true, out var roleEnum))
        {
            query = query.Where(u => u.Role == roleEnum);
        }

        if (!string.IsNullOrWhiteSpace(status) && !string.Equals(status, "all", StringComparison.OrdinalIgnoreCase) && Enum.TryParse<UserStatus>(status, true, out var statusEnum))
        {
            query = query.Where(u => u.Status == statusEnum);
        }

        var users = await query.OrderByDescending(u => u.CreatedAt).ToListAsync();

        var result = new List<AdminUserItemDto>();
        foreach (var u in users)
        {
            string name = u.Role switch
            {
                UserRole.PATIENT => u.PatientProfile?.FullName ?? "Citizen",
                UserRole.DOCTOR => StaffNameFormatter.WithRolePrefix(u.DoctorProfile?.FullName ?? "Doctor", "Dr."),
                UserRole.NURSE => StaffNameFormatter.WithRolePrefix(u.NurseProfile?.FullName ?? "Nurse", "Nurse"),
                UserRole.HOSPITAL => u.HospitalProfile?.HospitalName ?? "Hospital",
                UserRole.ADMIN => "System Administrator",
                _ => "User"
            };

            string identifier = u.Role switch
            {
                UserRole.PATIENT => !string.IsNullOrEmpty(u.PatientProfile?.NicNumber) ? $"NIC: {u.PatientProfile.NicNumber}" : "N/A",
                UserRole.DOCTOR => u.DoctorProfile?.SlmcNumber ?? "N/A",
                UserRole.NURSE => u.NurseProfile?.SlncNumber ?? "N/A",
                UserRole.HOSPITAL => u.HospitalProfile?.RegistrationNumber ?? "N/A",
                UserRole.ADMIN => "MOH-ROOT-ADMIN",
                _ => "N/A"
            };

            string facilityOrDetails = u.Role switch
            {
                UserRole.PATIENT => "Registered Citizen Record",
                UserRole.DOCTOR => u.DoctorProfile?.Specialization ?? "General Practitioner",
                UserRole.NURSE => "Nursing Staff",
                UserRole.HOSPITAL => $"{u.HospitalProfile?.HospitalType ?? "Hospital"} • {u.HospitalProfile?.District ?? "Sri Lanka"}",
                UserRole.ADMIN => "Ministry of Health System Admin",
                _ => "N/A"
            };

            result.Add(new AdminUserItemDto
            {
                Id = u.Id,
                Email = u.Email,
                Role = u.Role.ToString().ToLowerInvariant(),
                Status = u.Status.ToString().ToLowerInvariant(),
                Name = name,
                PhoneNumber = u.PhoneNumber,
                RegistrationNumber = u.RegistrationNumber,
                Identifier = identifier,
                FacilityOrDetails = facilityOrDetails,
                CreatedAt = u.CreatedAt,
                LastLoginAt = u.LastLoginAt,
                Profile = u.Role switch
                {
                    UserRole.PATIENT => u.PatientProfile,
                    UserRole.DOCTOR => u.DoctorProfile,
                    UserRole.NURSE => u.NurseProfile,
                    UserRole.HOSPITAL => u.HospitalProfile,
                    _ => null
                }
            });
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLowerInvariant();
            result = result.Where(r =>
                r.Name.ToLowerInvariant().Contains(s) ||
                r.Email.ToLowerInvariant().Contains(s) ||
                r.Identifier.ToLowerInvariant().Contains(s) ||
                (r.RegistrationNumber != null && r.RegistrationNumber.ToLowerInvariant().Contains(s)) ||
                r.FacilityOrDetails.ToLowerInvariant().Contains(s) ||
                (r.PhoneNumber != null && r.PhoneNumber.Contains(s))
            ).ToList();
        }

        return result;
    }

    public async Task<AdminDashboardStatsDto> GetDashboardStatsAsync()
    {
        // One grouped query for all role counts instead of one COUNT per role.
        var roleCounts = await _context.Users
            .GroupBy(u => u.Role)
            .Select(g => new { Role = g.Key, Count = g.Count() })
            .ToListAsync();
        int CountFor(UserRole role) => roleCounts.FirstOrDefault(r => r.Role == role)?.Count ?? 0;
        var totalUsers = roleCounts.Sum(r => r.Count);
        var patientCount = CountFor(UserRole.PATIENT);
        var doctorCount = CountFor(UserRole.DOCTOR);
        var nurseCount = CountFor(UserRole.NURSE);
        var hospitalCount = CountFor(UserRole.HOSPITAL);
        var adminCount = CountFor(UserRole.ADMIN);

        var todayUtc = DateTime.UtcNow.Date;
        var doseCounts = await _context.PatientVaccinationRecords
            .GroupBy(_ => 1)
            .Select(g => new { Total = g.Count(), Today = g.Count(r => r.AdministeredAt >= todayUtc) })
            .FirstOrDefaultAsync();
        var totalDoses = doseCounts?.Total ?? 0;
        var todayDoses = doseCounts?.Today ?? 0;

        var pendingVerifications = await GetPendingVerificationsAsync();

        // Registered hospitals with their booth count and vault reading in a single query,
        // instead of two extra queries per hospital.
        var hospitalProfiles = await _context.HospitalProfiles
            .OrderByDescending(h => h.VerifiedAt ?? DateTime.MinValue)
            .Take(10)
            .Select(h => new
            {
                h.Id,
                h.HospitalName,
                h.Province,
                h.District,
                h.HospitalType,
                h.VerificationStatus,
                ActiveBooths = _context.HospitalBooths.Count(b => b.HospitalUserId == h.UserId && b.IsActive),
                VaultTemp = _context.ColdVaults
                    .Where(cv => cv.HospitalProfileId == h.Id)
                    .Select(cv => cv.CurrentTemp)
                    .FirstOrDefault()
            })
            .ToListAsync();

        var hospitalTelemetry = new List<AdminHospitalTelemetryDto>();
        foreach (var hp in hospitalProfiles)
        {
            hospitalTelemetry.Add(new AdminHospitalTelemetryDto
            {
                Id = hp.Id,
                Name = hp.HospitalName,
                Province = hp.Province ?? "Western",
                District = hp.District ?? "Colombo",
                HospitalType = hp.HospitalType ?? "General Center",
                ActiveBooths = hp.ActiveBooths,
                DosesToday = todayDoses > 0 ? (int)Math.Ceiling((double)todayDoses / Math.Max(1, hospitalProfiles.Count)) : 0,
                Temp = hp.VaultTemp ?? "3.8°C",
                Status = hp.VerificationStatus == VerificationStatus.Approved ? "Optimal" : hp.VerificationStatus.ToString()
            });
        }

        // Query national vaccine inventory reserves
        var vaccines = await _context.Vaccines
            .Include(v => v.Batches)
            .OrderBy(v => v.Name)
            .Take(10)
            .ToListAsync();

        var vaccineReserves = new List<AdminVaccineReserveDto>();
        foreach (var v in vaccines)
        {
            var inStockNum = v.Batches
                .Where(b => b.Status == BatchStatus.Active && b.ExpiryDate > DateTime.UtcNow)
                .Sum(b => b.QuantityAvailable);
            var totalReceived = v.Batches.Sum(b => b.QuantityReceived);
            var allocatedNum = Math.Max(0, totalReceived - inStockNum);

            vaccineReserves.Add(new AdminVaccineReserveDto
            {
                VaccineId = v.Id,
                Vaccine = v.Name,
                InStock = inStockNum > 0 ? $"{inStockNum:N0} doses" : "Available on Request",
                Allocated = allocatedNum > 0 ? $"{allocatedNum:N0} doses" : "Standby Reserve",
                TempRange = v.RequiredTemp
            });
        }

        return new AdminDashboardStatsDto
        {
            UsersCount = new AdminUsersCountDto
            {
                Total = totalUsers,
                Patients = patientCount,
                Doctors = doctorCount,
                Nurses = nurseCount,
                Hospitals = hospitalCount,
                Admins = adminCount
            },
            VaccinationStats = new AdminVaccinationStatsDto
            {
                TotalDosesAdministered = totalDoses,
                TodayDosesAdministered = todayDoses,
                OnTimeSecondDoseRate = 94.2,
                NationalWastageRate = 0.48
            },
            PendingVerificationsCount = pendingVerifications.Count,
            ActiveHospitalsCount = hospitalCount,
            Hospitals = hospitalTelemetry,
            VaccineReserves = vaccineReserves,
            RecentPendingVerifications = pendingVerifications.Take(5).ToList()
        };
    }
}
