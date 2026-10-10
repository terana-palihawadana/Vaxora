using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

public class AvailableDateDto
{
    public string Date { get; set; } = string.Empty; // "2026-09-16"
    public string DayOfWeek { get; set; } = string.Empty; // "Wednesday"
    public string DisplayText { get; set; } = string.Empty; // "2026-09-16 (Wednesday) - 09:00 AM to 11:00 AM"
    public Guid? BoothId { get; set; }
    public string? BoothLabel { get; set; }
    public string StartTime { get; set; } = string.Empty;
    public string EndTime { get; set; } = string.Empty;
    public Guid ScheduleId { get; set; }
    public decimal Price { get; set; } = 0.00m;
    public string FormattedPrice { get; set; } = "Free";
}

public class TimeSlotDto
{
    public string Slot { get; set; } = string.Empty; // "09:00 AM - 09:20 AM"
    public string StartTime { get; set; } = string.Empty; // "09:00"
    public string EndTime { get; set; } = string.Empty; // "09:20"
    /// <summary>True when this 20-min band has reached capacity (typically 3 patients).</summary>
    public bool IsBooked { get; set; }
    public int BookedCount { get; set; }
    public int Capacity { get; set; } = 3;
    public int SeatsRemaining => Math.Max(0, Capacity - BookedCount);
    public string DisplayStatus => IsBooked
        ? "Full (Unavailable)"
        : SeatsRemaining == Capacity
            ? "Available"
            : $"{SeatsRemaining} seat(s) left";
}

public class BookAppointmentRequestDto
{
    [Required]
    public Guid HospitalUserId { get; set; }

    [Required]
    public string VaccineName { get; set; } = string.Empty;

    public Guid? VaccineId { get; set; }

    public Guid? VaccineScheduleId { get; set; }

    [Required]
    public DateOnly AppointmentDate { get; set; }

    [Required]
    public string TimeSlot { get; set; } = string.Empty; // e.g., "09:00 AM - 09:20 AM"

    public string? Notes { get; set; }

    public string PaymentMethod { get; set; } = "Free"; // "Free", "PayHere"
}

public class AppointmentResponseDto
{
    public Guid Id { get; set; }
    public Guid? PatientUserId { get; set; }
    public Guid? PatientProfileId { get; set; }
    public string PatientName { get; set; } = string.Empty;
    public string? PatientProfilePhotoUrl { get; set; }
    public string? PatientNic { get; set; }
    public string? PatientPhone { get; set; }
    public string? PatientEmail { get; set; }
    public Guid HospitalUserId { get; set; }
    public string HospitalName { get; set; } = string.Empty;
    public Guid? VaccineScheduleId { get; set; }
    public Guid? VaccineId { get; set; }
    public string VaccineName { get; set; } = string.Empty;
    public string? DoctorName { get; set; }
    public string? NurseName { get; set; }
    public string AppointmentDate { get; set; } = string.Empty; // "yyyy-MM-dd"
    public string TimeSlot { get; set; } = string.Empty;
    public string? StartTime { get; set; }
    public string? EndTime { get; set; }
    public string Status { get; set; } = "Confirmed";
    public decimal Fee { get; set; } = 0.00m;
    public string PaymentMethod { get; set; } = "Free";
    public string PaymentStatus { get; set; } = "Paid";
    public string? PaymentTransactionId { get; set; }
    public string? Notes { get; set; }
    public Guid? BoothId { get; set; }
    public string? BoothLabel { get; set; }
    public string? PrescribedDosage { get; set; }
    public Guid? PrescribedByDoctorUserId { get; set; }
    public string? PrescribedByDoctorName { get; set; }
    public DateTime? DosageUpdatedAt { get; set; }
    public DateTime? CheckedInAt { get; set; }
    /// <summary>Doctor or nurse running the current clinical session (Administering or Observation).</summary>
    public Guid? SessionStaffUserId { get; set; }
    public string? SessionStaffName { get; set; }
    /// <summary>Walk-in registration matched the patient's existing booking for today (checked in, not duplicated).</summary>
    public bool MatchedExistingBooking { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>Patient identifiers for affiliated staff after explicit contact reveal.</summary>
public class StaffAppointmentPatientContactDto
{
    public Guid AppointmentId { get; set; }
    public string? PatientNic { get; set; }
    public string? PatientPhone { get; set; }
    public string? PatientEmail { get; set; }
    public string? PatientProfilePhotoUrl { get; set; }
}

public class UpdateAppointmentStatusDto
{
    /// <summary>
    /// Confirmed, Administering, Observation, Completed, Cancelled or Rejected.
    /// </summary>
    [Required]
    public string Status { get; set; } = "Confirmed";

    public string? Remarks { get; set; }

    /// <summary>
    /// Take over a colleague's live session: keeps the current status and makes the caller
    /// the session owner. Status must equal the appointment's current status.
    /// </summary>
    public bool? TakeOver { get; set; }

    /// <summary>
    /// Optional clinical administration details used when moving to Observation/Completed.
    /// When provided, the selected batch is consumed and site/route/notes are saved
    /// on the patient vaccination record (instead of silent FEFO + hardcoded IM).
    /// </summary>
    public Guid? BatchId { get; set; }

    [MaxLength(100)]
    public string? LotNumber { get; set; }

    [MaxLength(100)]
    public string? InjectionSite { get; set; }

    [MaxLength(100)]
    public string? Route { get; set; }

    [MaxLength(1000)]
    public string? AdministrationNotes { get; set; }

    public bool? ConsentConfirmed { get; set; }

    public bool? VitalsConfirmed { get; set; }

    /// <summary>Administering staff confirm the doctor's prescribed dose before giving it.</summary>
    public bool? DoseConfirmed { get; set; }
}

public class CreateWalkInAppointmentDto
{
    [Required]
    [MaxLength(50)]
    public string PatientNic { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? PatientName { get; set; }

    /// <summary>Required when auto-creating a patient account (NIC not already registered).</summary>
    [EmailAddress]
    [MaxLength(256)]
    public string? PatientEmail { get; set; }

    /// <summary>Required when auto-creating a patient account (NIC not already registered).</summary>
    [MaxLength(20)]
    public string? PatientPhone { get; set; }

    [Required]
    [MaxLength(200)]
    public string VaccineName { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Dose { get; set; }

    [MaxLength(100)]
    public string? BoothLabel { get; set; }

    public int? Age { get; set; }

    [MaxLength(20)]
    public string? Gender { get; set; }
}

public class PayHereInitRequestDto
{
    [Required]
    public Guid AppointmentId { get; set; }
}

public class PayHereInitResponseDto
{
    public string MerchantId { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public string Items { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string FormattedAmount { get; set; } = string.Empty;
    public string Currency { get; set; } = "LKR";
    public string Hash { get; set; } = string.Empty;
    public string CheckoutUrl { get; set; } = string.Empty;
    public string ReturnUrl { get; set; } = string.Empty;
    public string CancelUrl { get; set; } = string.Empty;
    public string NotifyUrl { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string Country { get; set; } = "Sri Lanka";
}

public class ConfirmPayHerePaymentRequestDto
{
    [Required]
    public Guid AppointmentId { get; set; }
}

public class ReportAefiDto
{
    [Required]
    [MaxLength(40)]
    public string Severity { get; set; } = "Mild";

    [Required]
    [MaxLength(2000)]
    public string Description { get; set; } = string.Empty;

    [Required]
    [MaxLength(2000)]
    public string TreatmentGiven { get; set; } = string.Empty;

    /// <summary>Optional physician alert (nurse reports).</summary>
    public bool NotifyDoctor { get; set; } = true;

    /// <summary>Kept for older clients; ignored for workflow (no MOH integration).</summary>
    public bool NotifyMOH { get; set; }

    /// <summary>When the patient should be contacted / reviewed again.</summary>
    [Required]
    public DateTime FollowUpAt { get; set; }

    /// <summary>What follow-up care or contact is planned.</summary>
    [Required]
    [MaxLength(2000)]
    public string FollowUpPlan { get; set; } = string.Empty;
}

public class AefiReportResponseDto
{
    public Guid AppointmentId { get; set; }
    public Guid? VaccinationRecordId { get; set; }
    public Guid? FollowUpVisitId { get; set; }
    public string Severity { get; set; } = string.Empty;
    public bool DocumentedOnDose { get; set; }
    public bool FollowUpScheduled { get; set; }
    public DateTime? FollowUpAt { get; set; }
    public bool NotifiedDoctor { get; set; }
    public string Message { get; set; } = string.Empty;
}
