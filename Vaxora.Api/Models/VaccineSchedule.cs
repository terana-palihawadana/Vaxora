using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vaxora.Api.Models;

public class VaccineSchedule
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid HospitalUserId { get; set; }

    public Guid? HospitalProfileId { get; set; }

    public Guid? BoothId { get; set; }

    [MaxLength(120)]
    public string? BoothLabel { get; set; }

    public Guid? VaccineId { get; set; }

    [Required]
    [MaxLength(200)]
    public string VaccineName { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string ScheduleType { get; set; } = "OneTime"; // "OneTime" or "Weekly"

    public DateOnly? SpecificDate { get; set; }

    [MaxLength(255)]
    public string? DaysOfWeek { get; set; } // Comma-separated: e.g., "Monday,Wednesday,Friday" or "Mon,Wed,Fri"

    public DateOnly? StartDate { get; set; }

    public DateOnly? EndDate { get; set; }

    [Required]
    [MaxLength(20)]
    public string StartTime { get; set; } = "09:00";

    [Required]
    [MaxLength(20)]
    public string EndTime { get; set; } = "11:00";

    [MaxLength(50)]
    public string Status { get; set; } = "Active"; // "Active", "Cancelled"

    public decimal Price { get; set; } = 0.00m; // Vaccine fee per person in LKR (0 = Free)

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    [ForeignKey(nameof(HospitalUserId))]
    public User? HospitalUser { get; set; }

    [ForeignKey(nameof(BoothId))]
    public HospitalBooth? Booth { get; set; }

    [ForeignKey(nameof(VaccineId))]
    public Vaccine? Vaccine { get; set; }
}
