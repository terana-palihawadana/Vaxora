using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IAuthService
{
    Task<AuthResponseDto> RegisterPatientAsync(PatientSignupDto dto);
    Task<AuthResponseDto> RegisterDoctorAsync(DoctorSignupDto dto);
    Task<AuthResponseDto> RegisterNurseAsync(NurseSignupDto dto);
    Task<AuthResponseDto> RegisterHospitalAsync(HospitalSignupDto dto);
    Task<AuthResponseDto> LoginAsync(LoginDto dto);
    Task<AuthResponseDto> RefreshTokenAsync(RefreshTokenRequestDto dto);
    Task<bool> LogoutAsync(Guid userId);
    Task<bool> LogoutByRefreshTokenAsync(string? refreshToken);
    Task<UserDto> GetCurrentUserAsync(Guid userId);
    Task<bool> ForgotPasswordAsync(ForgotPasswordDto dto);
    Task<bool> ResetPasswordAsync(ResetPasswordDto dto);
    Task<bool> ChangePasswordAsync(Guid userId, ChangePasswordDto dto);
    Task<UserDto> UpdateProfileAsync(Guid userId, UpdateProfileDto dto);
    Task<UserDto> UpdateProfilePhotoAsync(Guid userId, IFormFile photo);
    Task<bool> DeleteAccountAsync(Guid userId);
}

public class AuthService : IAuthService
{
    private readonly ApplicationDbContext _context;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenService _tokenService;
    private readonly IR2StorageService _r2Service;
    private readonly IRegistrationNumberService _registrationNumberService;
    private readonly IVaccinationCardService _vaccinationCardService;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AuthService> _logger;

    public AuthService(
        ApplicationDbContext context,
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        IR2StorageService r2Service,
        IRegistrationNumberService registrationNumberService,
        IVaccinationCardService vaccinationCardService,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<AuthService> logger)
    {
        _context = context;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _r2Service = r2Service;
        _registrationNumberService = registrationNumberService;
        _vaccinationCardService = vaccinationCardService;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<AuthResponseDto> RegisterPatientAsync(PatientSignupDto dto)
    {
        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        if (await _context.Users.AnyAsync(u => u.Email == normalizedEmail))
        {
            throw new InvalidOperationException("An account with this email address already exists.");
        }

        if (await _context.PatientProfiles.AnyAsync(p => p.NicNumber == dto.NicNumber.Trim()))
        {
            throw new InvalidOperationException("An account with this National Identity Card (NIC) number already exists.");
        }

        string? photoUrl = null;
        if (dto.ProfilePhoto != null)
        {
            photoUrl = await _r2Service.UploadFileAsync(dto.ProfilePhoto, "patients/photos");
        }

        var regNumber = await _registrationNumberService.GenerateRegistrationNumberAsync(UserRole.PATIENT);

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            PasswordHash = _passwordHasher.HashPassword(dto.Password),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active, // Patients are automatically active
            PhoneNumber = dto.PhoneNumber,
            RegistrationNumber = regNumber,
            CreatedAt = DateTime.UtcNow
        };

        var profile = new PatientProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FullName = dto.FullName.Trim(),
            NicNumber = dto.NicNumber.Trim(),
            DateOfBirth = dto.DateOfBirth.ToUniversalTime(),
            PhoneNumber = dto.PhoneNumber,
            ProfilePhotoUrl = photoUrl,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        _context.PatientProfiles.Add(profile);

        // Audit Log
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = "PATIENT",
            Action = "PATIENT_SIGNUP",
            Details = $"Patient registered with NIC {profile.NicNumber} (Reg #{regNumber})",
            Timestamp = DateTime.UtcNow
        });

        var refreshToken = _tokenService.GenerateRefreshToken();
        user.RefreshToken = refreshToken;
        user.RefreshTokenExpiryTime = _tokenService.GetRefreshTokenExpiration();

        await _context.SaveChangesAsync();

        // Generate Digital Vaccination Card & Send Welcome Email in background
        try
        {
            var cardPdf = _vaccinationCardService.GenerateVaccinationCardPdf(
                profile.FullName,
                regNumber,
                profile.NicNumber,
                profile.DateOfBirth,
                profile.PhoneNumber,
                DateTime.UtcNow);

            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendPatientWelcomeEmailAsync(
                        user.Email,
                        profile.FullName,
                        regNumber,
                        profile.DateOfBirth,
                        cardPdf);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Background error dispatching patient welcome email to {Email}", user.Email);
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate digital vaccination card for patient {Email}", user.Email);
        }

        var token = _tokenService.GenerateAccessToken(user, profile.FullName);

        return new AuthResponseDto
        {
            Token = token,
            RefreshToken = refreshToken,
            ExpiresAt = _tokenService.GetTokenExpiration(),
            User = new UserDto
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                Name = profile.FullName,
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                ProfilePhotoUrl = photoUrl,
                ProfileDetails = profile
            },
            Message = "Patient registration successful."
        };
    }

    public async Task<AuthResponseDto> RegisterDoctorAsync(DoctorSignupDto dto)
    {
        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        if (await _context.Users.AnyAsync(u => u.Email == normalizedEmail))
        {
            throw new InvalidOperationException("An account with this email address already exists.");
        }

        if (await _context.DoctorProfiles.AnyAsync(d => d.SlmcNumber == dto.SlmcNumber.Trim()))
        {
            throw new InvalidOperationException("An account with this SLMC Registration Number already exists.");
        }

        // Upload documents to Cloudflare R2
        string? photoUrl = null;
        string? slmcDocKey = null;
        string? supportingDocKey = null;

        if (dto.ProfilePhoto != null)
        {
            photoUrl = await _r2Service.UploadFileAsync(dto.ProfilePhoto, "doctors/photos");
        }

        if (dto.SlmcCertificate != null)
        {
            slmcDocKey = await _r2Service.UploadFileAsync(dto.SlmcCertificate, "doctors/certificates");
        }

        if (dto.SupportingDocument != null)
        {
            supportingDocKey = await _r2Service.UploadFileAsync(dto.SupportingDocument, "doctors/supporting");
        }

        var regNumber = await _registrationNumberService.GenerateRegistrationNumberAsync(UserRole.DOCTOR);

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            PasswordHash = _passwordHasher.HashPassword(dto.Password),
            Role = UserRole.DOCTOR,
            Status = UserStatus.Pending, // Doctor starts as Pending verification
            PhoneNumber = dto.PhoneNumber,
            RegistrationNumber = regNumber,
            CreatedAt = DateTime.UtcNow
        };

        var profile = new DoctorProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FullName = dto.FullName.Trim(),
            SlmcNumber = dto.SlmcNumber.Trim(),
            Specialization = dto.Specialization,
            PhoneNumber = dto.PhoneNumber,
            ProfilePhotoUrl = photoUrl,
            SlmcCardDocKey = slmcDocKey,
            SupportingDocKey = supportingDocKey,
            VerificationStatus = VerificationStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        _context.DoctorProfiles.Add(profile);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = "DOCTOR",
            Action = "DOCTOR_SIGNUP",
            Details = $"Doctor applied for registration with SLMC {profile.SlmcNumber} (Reg #{regNumber}, Status: Pending)",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // Dispatch "Waiting for Approval" email in background
        _ = Task.Run(async () =>
        {
            try
            {
                await _emailService.SendPendingApprovalEmailAsync(
                    user.Email,
                    $"Dr. {profile.FullName}",
                    regNumber,
                    "Doctor");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background error dispatching pending approval email to doctor {Email}", user.Email);
            }
        });

        return new AuthResponseDto
        {
            Token = null,
            RefreshToken = null,
            ExpiresAt = null,
            User = new UserDto
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                Name = profile.FullName,
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                ProfilePhotoUrl = photoUrl,
                ProfileDetails = profile
            },
            Message = "Doctor registration submitted successfully. Your account is pending administrative verification."
        };
    }

    public async Task<AuthResponseDto> RegisterNurseAsync(NurseSignupDto dto)
    {
        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        if (await _context.Users.AnyAsync(u => u.Email == normalizedEmail))
        {
            throw new InvalidOperationException("An account with this email address already exists.");
        }

        if (await _context.NurseProfiles.AnyAsync(n => n.SlncNumber == dto.SlncNumber.Trim()))
        {
            throw new InvalidOperationException("An account with this SLNC Registration Number already exists.");
        }

        string? photoUrl = null;
        string? slncDocKey = null;
        string? supportingDocKey = null;

        if (dto.ProfilePhoto != null)
        {
            photoUrl = await _r2Service.UploadFileAsync(dto.ProfilePhoto, "nurses/photos");
        }

        if (dto.SlncCertificate != null)
        {
            slncDocKey = await _r2Service.UploadFileAsync(dto.SlncCertificate, "nurses/certificates");
        }

        if (dto.SupportingDocument != null)
        {
            supportingDocKey = await _r2Service.UploadFileAsync(dto.SupportingDocument, "nurses/supporting");
        }

        var regNumber = await _registrationNumberService.GenerateRegistrationNumberAsync(UserRole.NURSE);

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            PasswordHash = _passwordHasher.HashPassword(dto.Password),
            Role = UserRole.NURSE,
            Status = UserStatus.Pending, // Nurse starts as Pending verification
            PhoneNumber = dto.PhoneNumber,
            RegistrationNumber = regNumber,
            CreatedAt = DateTime.UtcNow
        };

        var profile = new NurseProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FullName = dto.FullName.Trim(),
            SlncNumber = dto.SlncNumber.Trim(),
            PhoneNumber = dto.PhoneNumber,
            ProfilePhotoUrl = photoUrl,
            SlncCardDocKey = slncDocKey,
            SupportingDocKey = supportingDocKey,
            VerificationStatus = VerificationStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        _context.NurseProfiles.Add(profile);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = "NURSE",
            Action = "NURSE_SIGNUP",
            Details = $"Nurse applied for registration with SLNC {profile.SlncNumber} (Reg #{regNumber}, Status: Pending)",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // Dispatch "Waiting for Approval" email in background
        _ = Task.Run(async () =>
        {
            try
            {
                await _emailService.SendPendingApprovalEmailAsync(
                    user.Email,
                    $"Nurse {profile.FullName}",
                    regNumber,
                    "Nurse");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background error dispatching pending approval email to nurse {Email}", user.Email);
            }
        });

        return new AuthResponseDto
        {
            Token = null,
            RefreshToken = null,
            ExpiresAt = null,
            User = new UserDto
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                Name = profile.FullName,
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                ProfilePhotoUrl = photoUrl,
                ProfileDetails = profile
            },
            Message = "Nurse registration submitted successfully. Your account is pending administrative verification."
        };
    }

    public async Task<AuthResponseDto> RegisterHospitalAsync(HospitalSignupDto dto)
    {
        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        if (await _context.Users.AnyAsync(u => u.Email == normalizedEmail))
        {
            throw new InvalidOperationException("An account with this email address already exists.");
        }

        if (await _context.HospitalProfiles.AnyAsync(h => h.RegistrationNumber == dto.RegistrationNumber.Trim()))
        {
            throw new InvalidOperationException("An account with this Hospital Registration Number already exists.");
        }

        string? logoUrl = null;
        string? regDocKey = null;
        string? mohDocKey = null;

        if (dto.Logo != null)
        {
            logoUrl = await _r2Service.UploadFileAsync(dto.Logo, "hospitals/logos");
        }

        if (dto.RegistrationCertificate != null)
        {
            regDocKey = await _r2Service.UploadFileAsync(dto.RegistrationCertificate, "hospitals/registrations");
        }

        if (dto.MohDocument != null)
        {
            mohDocKey = await _r2Service.UploadFileAsync(dto.MohDocument, "hospitals/moh_documents");
        }

        var regNumber = await _registrationNumberService.GenerateRegistrationNumberAsync(UserRole.HOSPITAL);

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            PasswordHash = _passwordHasher.HashPassword(dto.Password),
            Role = UserRole.HOSPITAL,
            Status = UserStatus.Pending, // Hospital starts as Pending verification
            PhoneNumber = dto.ContactNumber,
            RegistrationNumber = regNumber,
            CreatedAt = DateTime.UtcNow
        };

        var profile = new HospitalProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            HospitalName = dto.HospitalName.Trim(),
            RegistrationNumber = dto.RegistrationNumber.Trim(),
            HospitalType = dto.HospitalType,
            Address = dto.Address ?? string.Empty,
            District = dto.District,
            Province = dto.Province,
            ContactNumber = dto.ContactNumber,
            LogoUrl = logoUrl,
            RegistrationDocKey = regDocKey,
            MohDocKey = mohDocKey,
            VerificationStatus = VerificationStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        _context.HospitalProfiles.Add(profile);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = "HOSPITAL",
            Action = "HOSPITAL_SIGNUP",
            Details = $"Hospital applied for registration: {profile.HospitalName} (Reg #{regNumber}, Lic #{profile.RegistrationNumber})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // Dispatch "Waiting for Approval" email in background
        _ = Task.Run(async () =>
        {
            try
            {
                await _emailService.SendPendingApprovalEmailAsync(
                    user.Email,
                    profile.HospitalName,
                    regNumber,
                    "Hospital Facility");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background error dispatching pending approval email to hospital {Email}", user.Email);
            }
        });

        return new AuthResponseDto
        {
            Token = null,
            RefreshToken = null,
            ExpiresAt = null,
            User = new UserDto
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                Name = profile.HospitalName,
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                ProfilePhotoUrl = logoUrl,
                ProfileDetails = profile
            },
            Message = "Hospital registration submitted successfully. Your account is pending administrative verification."
        };
    }

    public async Task<AuthResponseDto> LoginAsync(LoginDto dto)
    {
        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Email == normalizedEmail);

        if (user == null || !_passwordHasher.VerifyPassword(dto.Password, user.PasswordHash))
        {
            if (user != null &&
                user.Role == UserRole.PATIENT &&
                await _context.AuditLogs.AnyAsync(a =>
                    a.UserId == user.Id && a.Action == "PATIENT_WALKIN_PROVISION"))
            {
                throw new UnauthorizedAccessException(
                    "Invalid email or password. Guest walk-in accounts use your NIC / National ID number as the password.");
            }

            throw new UnauthorizedAccessException("Invalid email address or password.");
        }

        if (user.Status == UserStatus.Pending)
        {
            throw new InvalidOperationException("Your account is currently under administrative verification by the Ministry of Health. Access will be granted once approved by the administrator.");
        }

        if (user.Status == UserStatus.Suspended)
        {
            throw new InvalidOperationException("Your account has been suspended by the platform administrator. Please contact support.");
        }

        if (user.Status == UserStatus.Rejected)
        {
            var reason = user.DoctorProfile?.RejectionReason 
                ?? user.NurseProfile?.RejectionReason 
                ?? user.HospitalProfile?.RejectionReason 
                ?? "Application rejected.";
            throw new InvalidOperationException($"Your registration was not approved: {reason}");
        }

        var displayName = GetUserDisplayName(user);
        var photoUrl = GetUserPhotoUrl(user);

        var token = _tokenService.GenerateAccessToken(user, displayName);
        var refreshToken = _tokenService.GenerateRefreshToken();

        user.RefreshToken = refreshToken;
        user.RefreshTokenExpiryTime = _tokenService.GetRefreshTokenExpiration();
        user.LastLoginAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "LOGIN_SUCCESS",
            Details = $"User logged in successfully with role {user.Role}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        return new AuthResponseDto
        {
            Token = token,
            RefreshToken = refreshToken,
            ExpiresAt = _tokenService.GetTokenExpiration(),
            User = new UserDto
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                Name = displayName,
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                ProfilePhotoUrl = photoUrl,
                ProfileDetails = GetUserProfileObject(user)
            },
            Message = "Login successful."
        };
    }

    public async Task<AuthResponseDto> RefreshTokenAsync(RefreshTokenRequestDto dto)
    {
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.RefreshToken == dto.RefreshToken);

        if (user == null || user.RefreshTokenExpiryTime <= DateTime.UtcNow)
        {
            throw new SecurityException("Invalid or expired refresh token.");
        }

        if (user.Status != UserStatus.Active)
        {
            user.RefreshToken = null;
            user.RefreshTokenExpiryTime = null;
            await _context.SaveChangesAsync();
            throw new InvalidOperationException(
                user.Status == UserStatus.Pending
                    ? "Account is pending verification."
                    : user.Status == UserStatus.Suspended
                        ? "Account is suspended."
                        : "Account is not allowed to refresh sessions.");
        }

        var displayName = GetUserDisplayName(user);
        var newAccessToken = _tokenService.GenerateAccessToken(user, displayName);
        // Rotate refresh token so a stolen token cannot be reused after a successful refresh.
        var newRefreshToken = _tokenService.GenerateRefreshToken();

        user.RefreshToken = newRefreshToken;
        user.RefreshTokenExpiryTime = _tokenService.GetRefreshTokenExpiration();
        await _context.SaveChangesAsync();

        return new AuthResponseDto
        {
            Token = newAccessToken,
            RefreshToken = newRefreshToken,
            ExpiresAt = _tokenService.GetTokenExpiration(),
            User = new UserDto
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                Status = user.Status.ToString(),
                Name = displayName,
                PhoneNumber = user.PhoneNumber,
                RegistrationNumber = user.RegistrationNumber,
                ProfilePhotoUrl = GetUserPhotoUrl(user),
                ProfileDetails = GetUserProfileObject(user)
            }
        };
    }

    public async Task<bool> LogoutAsync(Guid userId)
    {
        var user = await _context.Users.FindAsync(userId);
        if (user != null)
        {
            user.RefreshToken = null;
            user.RefreshTokenExpiryTime = null;
            await _context.SaveChangesAsync();
            return true;
        }
        return false;
    }

    /// <summary>
    /// Revoke session by refresh token when the access token has already expired.
    /// </summary>
    public async Task<bool> LogoutByRefreshTokenAsync(string? refreshToken)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
            return false;

        var user = await _context.Users.FirstOrDefaultAsync(u => u.RefreshToken == refreshToken);
        if (user == null)
            return false;

        user.RefreshToken = null;
        user.RefreshTokenExpiryTime = null;
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<UserDto> GetCurrentUserAsync(Guid userId)
    {
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            throw new KeyNotFoundException("User not found.");
        }

        return new UserDto
        {
            Id = user.Id,
            Email = user.Email,
            Role = user.Role.ToString(),
            Status = user.Status.ToString(),
            Name = GetUserDisplayName(user),
            PhoneNumber = user.PhoneNumber,
            RegistrationNumber = user.RegistrationNumber,
            ProfilePhotoUrl = GetUserPhotoUrl(user),
            ProfileDetails = GetUserProfileObject(user)
        };
    }

    private static string HashResetToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim()));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public async Task<bool> ForgotPasswordAsync(ForgotPasswordDto dto)
    {
        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Email == normalizedEmail);

        if (user == null)
        {
            // Return generic true for security to prevent email enumeration attacks
            return true;
        }

        // 1. Generate a cryptographically secure 6-digit numeric reset token
        var rawToken = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();

        // 2. Store ONLY the SHA-256 hash of the reset token in the database
        user.ResetPasswordToken = HashResetToken(rawToken);
        user.ResetPasswordExpiryTime = DateTime.UtcNow.AddMinutes(15);
        user.UpdatedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "PASSWORD_RESET_REQUESTED",
            Details = $"Secure password reset link and token generated for {user.Email}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // 3. Build frontend password reset link
        var frontendBaseUrl = _configuration["Frontend:BaseUrl"] 
            ?? Environment.GetEnvironmentVariable("FRONTEND_BASE_URL") 
            ?? "http://localhost:5173";

        var resetLink = $"{frontendBaseUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(rawToken)}&email={Uri.EscapeDataString(user.Email)}";
        var displayName = GetUserDisplayName(user);

        // 4. Dispatch password reset email via SMTP
        try
        {
            await _emailService.SendPasswordResetEmailAsync(user.Email, displayName, resetLink, rawToken, 15);
            _logger.LogInformation("Password reset email successfully sent to {Email}", user.Email);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to dispatch password reset email to {Email}", user.Email);
        }

        _logger.LogInformation("Password reset token generated and processed for user {Email}", user.Email);
        return true;
    }

    public async Task<bool> ResetPasswordAsync(ResetPasswordDto dto)
    {
        // 1. Validate password constraints
        if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 6)
        {
            throw new InvalidOperationException("Password must be at least 6 characters.");
        }

        if (!string.IsNullOrWhiteSpace(dto.ConfirmPassword) && dto.NewPassword != dto.ConfirmPassword)
        {
            throw new InvalidOperationException("New password and confirm password do not match.");
        }

        var normalizedEmail = dto.Email.Trim().ToLowerInvariant();
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Email == normalizedEmail);

        if (user == null || string.IsNullOrWhiteSpace(user.ResetPasswordToken) || user.ResetPasswordExpiryTime == null || user.ResetPasswordExpiryTime < DateTime.UtcNow)
        {
            throw new InvalidOperationException("Invalid or expired password reset token.");
        }

        // 2. Validate token against stored SHA-256 hash
        var incomingHash = HashResetToken(dto.ResetToken);
        bool isValidToken = string.Equals(user.ResetPasswordToken, incomingHash, StringComparison.OrdinalIgnoreCase)
                         || string.Equals(user.ResetPasswordToken, dto.ResetToken.Trim(), StringComparison.OrdinalIgnoreCase);

        if (!isValidToken)
        {
            throw new InvalidOperationException("Invalid or expired password reset token.");
        }

        // 3. Update password using BCrypt password hasher
        user.PasswordHash = _passwordHasher.HashPassword(dto.NewPassword);

        // 4. Invalidate / clear reset token and expiry
        user.ResetPasswordToken = null;
        user.ResetPasswordExpiryTime = null;

        // 5. Invalidate existing sessions and refresh tokens for security
        user.RefreshToken = null;
        user.RefreshTokenExpiryTime = null;
        user.UpdatedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "PASSWORD_RESET_SUCCESS",
            Details = $"Password was successfully reset for {user.Email}. Active sessions revoked.",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // 6. Dispatch password-changed security confirmation email
        var displayName = GetUserDisplayName(user);
        try
        {
            await _emailService.SendPasswordChangedConfirmationEmailAsync(user.Email, displayName);
            _logger.LogInformation("Password-changed confirmation email sent to {Email}", user.Email);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send password-changed confirmation email to {Email}", user.Email);
        }

        _logger.LogInformation("Password successfully reset and sessions revoked for user {Email}", user.Email);
        return true;
    }

    public async Task<bool> ChangePasswordAsync(Guid userId, ChangePasswordDto dto)
    {
        var user = await _context.Users.FindAsync(userId);
        if (user == null)
        {
            throw new KeyNotFoundException("User not found.");
        }

        if (!_passwordHasher.VerifyPassword(dto.CurrentPassword, user.PasswordHash))
        {
            throw new InvalidOperationException("Current password is incorrect.");
        }

        user.PasswordHash = _passwordHasher.HashPassword(dto.NewPassword);
        user.UpdatedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "PASSWORD_CHANGE",
            Details = "User changed account password",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<UserDto> UpdateProfileAsync(Guid userId, UpdateProfileDto dto)
    {
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            throw new KeyNotFoundException("User not found.");
        }

        if (!string.IsNullOrWhiteSpace(dto.PhoneNumber))
        {
            user.PhoneNumber = dto.PhoneNumber.Trim();
        }

        switch (user.Role)
        {
            case UserRole.PATIENT:
                if (user.PatientProfile != null)
                {
                    if (!string.IsNullOrWhiteSpace(dto.FullName)) user.PatientProfile.FullName = dto.FullName.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.PhoneNumber)) user.PatientProfile.PhoneNumber = dto.PhoneNumber.Trim();
                    if (dto.DateOfBirth.HasValue) user.PatientProfile.DateOfBirth = dto.DateOfBirth.Value;

                    // Keep denormalized appointment rows aligned with the live profile.
                    var syncedName = user.PatientProfile.FullName;
                    var syncedPhone = user.PatientProfile.PhoneNumber ?? user.PhoneNumber;
                    var linkedAppointments = await _context.Appointments
                        .Where(a => a.PatientUserId == user.Id)
                        .ToListAsync();
                    foreach (var appointment in linkedAppointments)
                    {
                        if (!string.IsNullOrWhiteSpace(syncedName))
                            appointment.PatientName = syncedName;
                        if (!string.IsNullOrWhiteSpace(syncedPhone))
                            appointment.PatientPhone = syncedPhone;
                        appointment.PatientEmail = user.Email;
                        if (!string.IsNullOrWhiteSpace(user.PatientProfile.NicNumber))
                            appointment.PatientNic = user.PatientProfile.NicNumber;
                        appointment.UpdatedAt = DateTime.UtcNow;
                    }
                }
                break;

            case UserRole.DOCTOR:
                if (user.DoctorProfile != null)
                {
                    if (!string.IsNullOrWhiteSpace(dto.FullName)) user.DoctorProfile.FullName = dto.FullName.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.PhoneNumber)) user.DoctorProfile.PhoneNumber = dto.PhoneNumber.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.Specialization)) user.DoctorProfile.Specialization = dto.Specialization.Trim();
                }
                break;

            case UserRole.NURSE:
                if (user.NurseProfile != null)
                {
                    if (!string.IsNullOrWhiteSpace(dto.FullName)) user.NurseProfile.FullName = dto.FullName.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.PhoneNumber)) user.NurseProfile.PhoneNumber = dto.PhoneNumber.Trim();
                }
                break;

            case UserRole.HOSPITAL:
                if (user.HospitalProfile != null)
                {
                    if (!string.IsNullOrWhiteSpace(dto.HospitalName)) user.HospitalProfile.HospitalName = dto.HospitalName.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.PhoneNumber)) user.HospitalProfile.ContactNumber = dto.PhoneNumber.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.HospitalType)) user.HospitalProfile.HospitalType = dto.HospitalType.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.OperatingHours)) user.HospitalProfile.OperatingHours = dto.OperatingHours.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.Address)) user.HospitalProfile.Address = dto.Address.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.District)) user.HospitalProfile.District = dto.District.Trim();
                    if (!string.IsNullOrWhiteSpace(dto.Province)) user.HospitalProfile.Province = dto.Province.Trim();
                }
                break;
        }

        user.UpdatedAt = DateTime.UtcNow;

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "PROFILE_UPDATED",
            Details = $"User updated profile details ({user.Role})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        return new UserDto
        {
            Id = user.Id,
            Email = user.Email,
            Role = user.Role.ToString(),
            Status = user.Status.ToString(),
            Name = GetUserDisplayName(user),
            PhoneNumber = user.PhoneNumber,
            RegistrationNumber = user.RegistrationNumber,
            ProfilePhotoUrl = GetUserPhotoUrl(user),
            ProfileDetails = GetUserProfileObject(user)
        };
    }

    public async Task<UserDto> UpdateProfilePhotoAsync(Guid userId, IFormFile photo)
    {
        if (photo == null || photo.Length == 0)
            throw new InvalidOperationException("Please choose an image file to upload.");

        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw new KeyNotFoundException("User not found.");

        var folder = user.Role switch
        {
            UserRole.PATIENT => "patients/photos",
            UserRole.DOCTOR => "doctors/photos",
            UserRole.NURSE => "nurses/photos",
            UserRole.HOSPITAL => "hospitals/logos",
            _ => throw new InvalidOperationException("This account type cannot upload a profile photo.")
        };

        var photoUrl = await _r2Service.UploadFileAsync(photo, folder);

        switch (user.Role)
        {
            case UserRole.PATIENT:
                if (user.PatientProfile == null) throw new InvalidOperationException("Patient profile not found.");
                user.PatientProfile.ProfilePhotoUrl = photoUrl;
                break;
            case UserRole.DOCTOR:
                if (user.DoctorProfile == null) throw new InvalidOperationException("Doctor profile not found.");
                user.DoctorProfile.ProfilePhotoUrl = photoUrl;
                break;
            case UserRole.NURSE:
                if (user.NurseProfile == null) throw new InvalidOperationException("Nurse profile not found.");
                user.NurseProfile.ProfilePhotoUrl = photoUrl;
                break;
            case UserRole.HOSPITAL:
                if (user.HospitalProfile == null) throw new InvalidOperationException("Hospital profile not found.");
                user.HospitalProfile.LogoUrl = photoUrl;
                break;
        }

        user.UpdatedAt = DateTime.UtcNow;
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "PROFILE_PHOTO_UPDATED",
            Details = $"User updated profile photo/logo ({user.Role})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        return new UserDto
        {
            Id = user.Id,
            Email = user.Email,
            Role = user.Role.ToString(),
            Status = user.Status.ToString(),
            Name = GetUserDisplayName(user),
            PhoneNumber = user.PhoneNumber,
            RegistrationNumber = user.RegistrationNumber,
            ProfilePhotoUrl = GetUserPhotoUrl(user),
            ProfileDetails = GetUserProfileObject(user)
        };
    }

    public async Task<bool> DeleteAccountAsync(Guid userId)
    {
        var user = await _context.Users
            .Include(u => u.PatientProfile)
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            throw new KeyNotFoundException("User not found.");
        }

        var userEmail = user.Email;
        var displayName = GetUserDisplayName(user);
        var roleName = user.Role.ToString();
        var regNumber = user.RegistrationNumber ?? user.Id.ToString();

        _logger.LogInformation("Permanently deleting account for user {UserId} with role {Role} and email {Email}", user.Id, user.Role, user.Email);

        // Record Audit Log before removing (set UserId to null so it does not conflict upon user deletion)
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = null,
            UserEmail = user.Email,
            Role = user.Role.ToString(),
            Action = "ACCOUNT_DELETED",
            Details = $"User self-deleted their account ({user.Role}) with registration number {user.RegistrationNumber}",
            Timestamp = DateTime.UtcNow
        });

        // 1. Unlink historical AuditLogs pointing to this user
        var userAuditLogs = await _context.AuditLogs.Where(l => l.UserId == userId).ToListAsync();
        foreach (var log in userAuditLogs)
        {
            log.UserId = null;
        }

        // 2. Clean up AgentWorkflows
        var agentWorkflows = await _context.AgentWorkflows.Where(w => w.UserId == userId).ToListAsync();
        if (agentWorkflows.Count != 0)
        {
            _context.AgentWorkflows.RemoveRange(agentWorkflows);
        }

        // 3. Clean up ShiftSwapRequests
        var shiftSwaps = await _context.ShiftSwapRequests
            .Where(r => r.HospitalUserId == userId || r.RequesterUserId == userId || r.ReplacementUserId == userId)
            .ToListAsync();
        if (shiftSwaps.Count != 0)
        {
            _context.ShiftSwapRequests.RemoveRange(shiftSwaps);
        }

        // 4. Clean up staff affiliations (where user is either the staff member or the hospital)
        var affiliations = await _context.StaffAffiliations
            .Include(a => a.Shifts)
            .Where(a => a.HospitalUserId == userId || a.StaffUserId == userId)
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

        // 5. Unlink InventoryTransactions performed by this user
        var userInvTransactions = await _context.InventoryTransactions.Where(t => t.PerformedByUserId == userId).ToListAsync();
        foreach (var tx in userInvTransactions)
        {
            tx.PerformedByUserId = null;
        }

        // 6. Clean up hospital inventory/formulary/vaults/booths if deleting a hospital
        if (user.HospitalProfile != null)
        {
            var hospitalId = user.HospitalProfile.Id;
            var formularies = await _context.HospitalFormularies.Where(f => f.HospitalProfileId == hospitalId).ToListAsync();
            _context.HospitalFormularies.RemoveRange(formularies);

            var vaults = await _context.ColdVaults.Where(v => v.HospitalProfileId == hospitalId).ToListAsync();
            _context.ColdVaults.RemoveRange(vaults);

            var batches = await _context.Batches.Include(b => b.Transactions).Where(b => b.HospitalProfileId == hospitalId).ToListAsync();
            foreach (var b in batches)
            {
                if (b.Transactions.Count != 0)
                {
                    _context.InventoryTransactions.RemoveRange(b.Transactions);
                }
            }
            _context.Batches.RemoveRange(batches);

            var hospitalBooths = await _context.HospitalBooths.Include(b => b.Vaccines).Where(b => b.HospitalUserId == userId).ToListAsync();
            foreach (var b in hospitalBooths)
            {
                if (b.Vaccines.Count != 0)
                {
                    _context.HospitalBoothVaccines.RemoveRange(b.Vaccines);
                }
            }
            _context.HospitalBooths.RemoveRange(hospitalBooths);

            var hospitalAppointments = await _context.Appointments.Where(a => a.HospitalUserId == userId).ToListAsync();
            _context.Appointments.RemoveRange(hospitalAppointments);

            var hospitalSchedules = await _context.VaccineSchedules.Where(s => s.HospitalUserId == userId).ToListAsync();
            _context.VaccineSchedules.RemoveRange(hospitalSchedules);
        }
        else if (user.Role == UserRole.PATIENT)
        {
            // Clean up appointments booked by this patient
            var patientAppointments = await _context.Appointments.Where(a => a.PatientUserId == userId).ToListAsync();
            _context.Appointments.RemoveRange(patientAppointments);
        }
        else
        {
            // For Doctor or Nurse, unlink from appointments without breaking hospital history.
            var staffAppointments = await _context.Appointments
                .Where(a => a.DoctorUserId == userId || a.NurseUserId == userId || a.PrescribedByDoctorUserId == userId)
                .ToListAsync();
            foreach (var a in staffAppointments)
            {
                if (a.DoctorUserId == userId) a.DoctorUserId = null;
                if (a.NurseUserId == userId) a.NurseUserId = null;
                if (a.PrescribedByDoctorUserId == userId) a.PrescribedByDoctorUserId = null;
            }
        }

        _context.Users.Remove(user);
        await _context.SaveChangesAsync();

        // Send confirmation email asynchronously in background so deletion returns immediately without SMTP latency
        _ = Task.Run(async () =>
        {
            try
            {
                await _emailService.SendAccountDeletedEmailAsync(userEmail, displayName, regNumber, roleName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send account deletion email to {Email}", userEmail);
            }
        });

        return true;
    }

    private static string GetUserDisplayName(User user)
    {
        return user.Role switch
        {
            UserRole.PATIENT => user.PatientProfile?.FullName ?? "Patient",
            UserRole.DOCTOR => $"Dr. {user.DoctorProfile?.FullName ?? "Doctor"}",
            UserRole.NURSE => $"Nurse {user.NurseProfile?.FullName ?? "Nurse"}",
            UserRole.HOSPITAL => user.HospitalProfile?.HospitalName ?? "Hospital",
            UserRole.ADMIN => "System Administrator",
            _ => "User"
        };
    }

    private static string? GetUserPhotoUrl(User user)
    {
        return user.Role switch
        {
            UserRole.PATIENT => user.PatientProfile?.ProfilePhotoUrl,
            UserRole.DOCTOR => user.DoctorProfile?.ProfilePhotoUrl,
            UserRole.NURSE => user.NurseProfile?.ProfilePhotoUrl,
            UserRole.HOSPITAL => user.HospitalProfile?.LogoUrl,
            _ => null
        };
    }

    private static object? GetUserProfileObject(User user)
    {
        return user.Role switch
        {
            UserRole.PATIENT => user.PatientProfile,
            UserRole.DOCTOR => user.DoctorProfile,
            UserRole.NURSE => user.NurseProfile,
            UserRole.HOSPITAL => user.HospitalProfile,
            _ => null
        };
    }
}
public class SecurityException : Exception
{
    public SecurityException(string message) : base(message) { }
}
