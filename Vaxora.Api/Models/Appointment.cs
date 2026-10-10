using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vaxora.Api.Models;

[Table("Appointments")]
public class Appointment
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Null only for legacy guest walk-ins created before auto-provisioning.</summary>
    public Guid? PatientUserId { get; set; }

    public Guid? PatientProfileId { get; set; }

    [Required]
    [MaxLength(200)]
    public string PatientName { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? PatientNic { get; set; }

    [MaxLength(50)]
    public string? PatientPhone { get; set; }

    [MaxLength(256)]
    public string? PatientEmail { get; set; }

    [Required]
    public Guid HospitalUserId { get; set; }

    public Guid? HospitalProfileId { get; set; }

    [Required]
    [MaxLength(200)]
    public string HospitalName { get; set; } = string.Empty;

    public Guid? VaccineScheduleId { get; set; }

    public Guid? VaccineId { get; set; }

    [Required]
    [MaxLength(200)]
    public string VaccineName { get; set; } = string.Empty;

    public Guid? DoctorUserId { get; set; }

    [MaxLength(200)]
    public string? DoctorName { get; set; }

    public Guid? NurseUserId { get; set; }

    [MaxLength(200)]
    public string? NurseName { get; set; }

    [Required]
    public DateOnly AppointmentDate { get; set; }

    [Required]
    [MaxLength(100)]
    public string TimeSlot { get; set; } = string.Empty; // e.g. "09:00 AM - 09:20 AM"

    [MaxLength(20)]
    public string? StartTime { get; set; } // "09:00"

    [MaxLength(20)]
    public string? EndTime { get; set; } // "09:20"

    [Required]
    [MaxLength(50)]
    public string Status { get; set; } = "Confirmed"; // "PendingPayment", "Confirmed", "Completed", "Cancelled"

    public decimal Fee { get; set; } = 0.00m; // Vaccination fee in LKR (0 = Free)

    [MaxLength(50)]
    public string PaymentMethod { get; set; } = "Free"; // "Free", "Hospital", "PayHere"

    [MaxLength(50)]
    public string PaymentStatus { get; set; } = "Paid"; // "Paid", "PendingOnline", "Failed"

    [MaxLength(100)]
    public string? PaymentTransactionId { get; set; } // PayHere payment/order reference

    [MaxLength(1000)]
    public string? Notes { get; set; }

    /// <summary>Physician-prescribed dosage/volume (e.g. "0.5ml").</summary>
    [MaxLength(100)]
    public string? PrescribedDosage { get; set; }

    public Guid? PrescribedByDoctorUserId { get; set; }

    [MaxLength(200)]
    public string? PrescribedByDoctorName { get; set; }

    public DateTime? DosageUpdatedAt { get; set; }

    /// <summary>When the patient arrived and was checked in (UTC). Only checked-in patients can be called.</summary>
    public DateTime? CheckedInAt { get; set; }

    public Guid? CheckedInByUserId { get; set; }

    /// <summary>
    /// Doctor or nurse who called the patient into the current clinical session.
    /// Cleared when the patient goes back to the queue or the visit is cancelled.
    /// </summary>
    public Guid? SessionStaffUserId { get; set; }

    [MaxLength(200)]
    public string? SessionStaffName { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    [ForeignKey(nameof(PatientUserId))]
    public virtual User? PatientUser { get; set; }

    [ForeignKey(nameof(HospitalUserId))]
    public virtual User? HospitalUser { get; set; }

    [ForeignKey(nameof(VaccineScheduleId))]
    public virtual VaccineSchedule? VaccineSchedule { get; set; }
}
