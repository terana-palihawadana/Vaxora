using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

public class CreateDeskAccountDto
{
    [Required(ErrorMessage = "Full name is required.")]
    [MaxLength(150)]
    public string FullName { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? PhoneNumber { get; set; }

    [Required]
    [EmailAddress]
    [MaxLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(6, ErrorMessage = "Password must be at least 6 characters.")]
    public string Password { get; set; } = string.Empty;
}

public class DeskAccountDto
{
    public Guid AffiliationId { get; set; }
    public Guid UserId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string Email { get; set; } = string.Empty;
    public string RegistrationNumber { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
}

/// <summary>The hospital a front-desk account works for.</summary>
public class DeskContextDto
{
    public Guid HospitalUserId { get; set; }
    public string HospitalName { get; set; } = string.Empty;
    public string? HospitalLogoUrl { get; set; }
    public string? HospitalRegistrationNumber { get; set; }
    public string? HospitalType { get; set; }
    public string? OperatingHours { get; set; }
}
