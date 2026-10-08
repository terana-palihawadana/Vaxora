using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Http;
using Vaxora.Api.Models;

namespace Vaxora.Api.Dtos;

public class LoginDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}

public class UserDto
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? RegistrationNumber { get; set; }
    public string? ProfilePhotoUrl { get; set; }
    public object? ProfileDetails { get; set; }
}

public class AuthResponseDto
{
    public string? Token { get; set; }
    public string? RefreshToken { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public UserDto User { get; set; } = null!;
    public string? Message { get; set; }
}

public class LogoutRequestDto
{
    public string? RefreshToken { get; set; }
}

public class RefreshTokenRequestDto
{
    [Required]
    public string RefreshToken { get; set; } = string.Empty;
}

public class ForgotPasswordDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;
}

public class ResetPasswordDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string ResetToken { get; set; } = string.Empty;

    [Required]
    [MinLength(6, ErrorMessage = "Password must be at least 6 characters.")]
    public string NewPassword { get; set; } = string.Empty;

    public string? ConfirmPassword { get; set; }
}

public class ChangePasswordDto
{
    [Required]
    public string CurrentPassword { get; set; } = string.Empty;

    [Required]
    [MinLength(6)]
    public string NewPassword { get; set; } = string.Empty;
}

public class UpdateProfileDto
{
    public string? FullName { get; set; }
    public string? PhoneNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Specialization { get; set; }
    public string? HospitalName { get; set; }
    public string? HospitalType { get; set; }
    public string? OperatingHours { get; set; }
    public string? Address { get; set; }
    public string? District { get; set; }
    public string? Province { get; set; }
    public string? ProfilePhotoUrl { get; set; }
}

// Signup DTOs exactly matching frontend forms
public class PatientSignupDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(6)]
    public string Password { get; set; } = string.Empty;

    [Required]
    public string FullName { get; set; } = string.Empty;

    [Required]
    public string NicNumber { get; set; } = string.Empty;

    [Required]
    public DateTime DateOfBirth { get; set; }

    public string? PhoneNumber { get; set; }

    public IFormFile? ProfilePhoto { get; set; }
}

public class DoctorSignupDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(6)]
    public string Password { get; set; } = string.Empty;

    [Required]
    public string FullName { get; set; } = string.Empty;

    [Required]
    public string SlmcNumber { get; set; } = string.Empty;

    public string? Specialization { get; set; }
    public string? PhoneNumber { get; set; }

    public IFormFile? ProfilePhoto { get; set; }
    public IFormFile? SlmcCertificate { get; set; }
    public IFormFile? SupportingDocument { get; set; }
}

public class NurseSignupDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(6)]
    public string Password { get; set; } = string.Empty;

    [Required]
    public string FullName { get; set; } = string.Empty;

    [Required]
    public string SlncNumber { get; set; } = string.Empty;

    public string? PhoneNumber { get; set; }

    public IFormFile? ProfilePhoto { get; set; }
    public IFormFile? SlncCertificate { get; set; }
    public IFormFile? SupportingDocument { get; set; }
}

public class HospitalSignupDto
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(6)]
    public string Password { get; set; } = string.Empty;

    [Required]
    public string HospitalName { get; set; } = string.Empty;

    [Required]
    public string RegistrationNumber { get; set; } = string.Empty;

    public string? HospitalType { get; set; }
    public string? OperatingHours { get; set; }
    public string? Address { get; set; }
    public string? District { get; set; }
    public string? Province { get; set; }
    public string? ContactNumber { get; set; }

    public IFormFile? Logo { get; set; }
    public IFormFile? RegistrationCertificate { get; set; }
    public IFormFile? MohDocument { get; set; }
}

public class AdminUserItemDto
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? RegistrationNumber { get; set; }
    public string Identifier { get; set; } = string.Empty;
    public string FacilityOrDetails { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public object? Profile { get; set; }
}

public class ProfilePhotoUploadDto
{
    public IFormFile Photo { get; set; } = null!;
}
