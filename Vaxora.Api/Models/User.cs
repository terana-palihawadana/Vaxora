using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vaxora.Api.Models;

[Table("Users")]
public class User
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    [EmailAddress]
    [MaxLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    [Required]
    public UserRole Role { get; set; }

    [Required]
    public UserStatus Status { get; set; } = UserStatus.Pending;

    /// <summary>Name for accounts that have no profile table of their own (front desk).</summary>
    [MaxLength(150)]
    public string? FullName { get; set; }

    [MaxLength(20)]
    public string? PhoneNumber { get; set; }

    [MaxLength(50)]
    public string? RegistrationNumber { get; set; }

    public string? RefreshToken { get; set; }
    public DateTime? RefreshTokenExpiryTime { get; set; }

    public string? ResetPasswordToken { get; set; }
    public DateTime? ResetPasswordExpiryTime { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }

    // Navigation properties
    public virtual PatientProfile? PatientProfile { get; set; }
    public virtual DoctorProfile? DoctorProfile { get; set; }
    public virtual NurseProfile? NurseProfile { get; set; }
    public virtual HospitalProfile? HospitalProfile { get; set; }
}
