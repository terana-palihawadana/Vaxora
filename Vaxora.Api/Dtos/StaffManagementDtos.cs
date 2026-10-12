using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

public class InviteStaffDto
{
    [Required]
    [MaxLength(50)]
    public string RegistrationNumber { get; set; } = string.Empty;
}

public class StaffCandidateDto
{
    public Guid UserId { get; set; }
    public string RegistrationNumber { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string? Specialization { get; set; }
    public bool AlreadyAffiliated { get; set; }
}

public class AffiliationDecisionDto
{
    [Required]
    public string Decision { get; set; } = string.Empty; // "Accept" or "Reject"
}

public class UpdateDutyStatusDto
{
    [Required]
    public string DutyStatus { get; set; } = string.Empty; // "Off", "OnDuty", "OnBreak"
}

public class CreateHospitalBoothDto
{
    [Required]
    [MaxLength(20)]
    public string Code { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    public int? SortOrder { get; set; }

    /// <summary>Vaccines this booth can give. Bookings for these vaccines open this booth.</summary>
    public List<Guid> VaccineIds { get; set; } = new();
}

public class UpdateHospitalBoothDto
{
    [Required]
    [MaxLength(20)]
    public string Code { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public int? SortOrder { get; set; }

    public List<Guid> VaccineIds { get; set; } = new();
}

public class HospitalBoothDto
{
    public Guid BoothId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string DisplayLabel { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public List<Guid> VaccineIds { get; set; } = new();
    public List<string> VaccineNames { get; set; } = new();
}

public class CreateStaffShiftDto
{
    [Required]
    public Guid AffiliationId { get; set; }

    [Required]
    public DateOnly ShiftDate { get; set; }

    [Required]
    public TimeOnly StartTime { get; set; }

    [Required]
    public TimeOnly EndTime { get; set; }

    /// <summary>Preferred: assign a configured hospital booth.</summary>
    public Guid? BoothId { get; set; }

    /// <summary>Legacy free-text label when BoothId is omitted.</summary>
    [MaxLength(100)]
    public string? BoothOrStation { get; set; }

    [MaxLength(500)]
    public string? Notes { get; set; }

    /// <summary>Hospital confirmed a one-off shift outside the doctor's offered hours.</summary>
    public bool OverrideAvailability { get; set; }
}

public class UpdateStaffShiftDto
{
    [Required]
    public DateOnly ShiftDate { get; set; }

    [Required]
    public TimeOnly StartTime { get; set; }

    [Required]
    public TimeOnly EndTime { get; set; }

    public Guid? BoothId { get; set; }

    [MaxLength(100)]
    public string? BoothOrStation { get; set; }

    [MaxLength(500)]
    public string? Notes { get; set; }

    /// <summary>Hospital confirmed a one-off shift outside the doctor's offered hours.</summary>
    public bool OverrideAvailability { get; set; }
}

public class StaffAffiliationDto
{
    public Guid AffiliationId { get; set; }
    public Guid HospitalUserId { get; set; }
    public string? HospitalName { get; set; }
    public string? HospitalLogoUrl { get; set; }
    public Guid StaffUserId { get; set; }
    public string StaffRegistrationNumber { get; set; } = string.Empty;
    public string StaffName { get; set; } = string.Empty;
    public string? StaffProfilePhotoUrl { get; set; }
    public string StaffRole { get; set; } = string.Empty;
    public string? Specialization { get; set; }
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
    public string Status { get; set; } = string.Empty;
    /// <summary>Clock state: Off, OnDuty (clocked in) or OnBreak.</summary>
    public string DutyStatus { get; set; } = string.Empty;
    public DateTime? DutyUpdatedAt { get; set; }
    /// <summary>
    /// True when the staff member may act clinically now: a live rostered shift or a
    /// valid clock-in, and not on break.
    /// </summary>
    public bool IsOnDutyNow { get; set; }
    /// <summary>True when the staff member has a valid manual clock-in.</summary>
    public bool IsClockedIn { get; set; }
    public DateTime InvitedAt { get; set; }
    public DateTime? RespondedAt { get; set; }
    /// <summary>The doctor's main hospital, which rosters them without an hours limit.</summary>
    public bool IsPrimary { get; set; }
    /// <summary>Weekly hours the doctor offers this hospital. Empty means no limit set.</summary>
    public List<AvailabilityWindowDto> AvailabilityWindows { get; set; } = new();
    public List<DateOnly> UnavailableDates { get; set; } = new();
}

public class AvailabilityWindowDto
{
    /// <summary>0 = Sunday through 6 = Saturday.</summary>
    [Range(0, 6)]
    public int DayOfWeek { get; set; }

    [Required]
    public TimeOnly StartTime { get; set; }

    [Required]
    public TimeOnly EndTime { get; set; }
}

public class UpdateStaffAvailabilityDto
{
    public bool IsPrimary { get; set; }

    public List<AvailabilityWindowDto> Windows { get; set; } = new();

    public List<DateOnly> UnavailableDates { get; set; } = new();
}

public class StaffShiftDto
{
    public Guid ShiftId { get; set; }
    public Guid AffiliationId { get; set; }
    public Guid StaffUserId { get; set; }
    public string StaffName { get; set; } = string.Empty;
    public string StaffRole { get; set; } = string.Empty;
    public string? StaffPhotoUrl { get; set; }
    public DateOnly ShiftDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public Guid? BoothId { get; set; }
    public string? BoothOrStation { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    /// <summary>Requested, Covering, or Declined.</summary>
    public string? CoverStatus { get; set; }
    public string? CoverLabel { get; set; }
    public string? CoverForName { get; set; }
}

/// <summary>
/// A time block when an affiliated clinician is already booked (this hospital or another).
/// </summary>
public class StaffBusyBlockDto
{
    public Guid StaffUserId { get; set; }
    /// <summary>This hospital's affiliation id for the same staff member (for agent mapping).</summary>
    public Guid LocalAffiliationId { get; set; }
    public DateOnly ShiftDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool IsExternal { get; set; }
    /// <summary>Not a shift: a day off or hours the doctor does not offer this hospital.</summary>
    public bool IsUnavailable { get; set; }
}

/// <summary>One dated run of a posted vaccine session, with the staff rostered onto it.</summary>
public class RosterSessionDto
{
    public Guid ScheduleId { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public Guid? BoothId { get; set; }
    public string? BoothLabel { get; set; }
    public string VaccineName { get; set; } = string.Empty;
    public List<RosterSessionStaffDto> Doctors { get; set; } = new();
    public List<RosterSessionStaffDto> Nurses { get; set; } = new();
    /// <summary>False once the session has ended.</summary>
    public bool CanAssign { get; set; }
}

public class RosterSessionStaffDto
{
    public Guid ShiftId { get; set; }
    public Guid AffiliationId { get; set; }
    public string StaffName { get; set; } = string.Empty;
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
}

public class SessionCandidateDto
{
    public Guid AffiliationId { get; set; }
    public string StaffName { get; set; } = string.Empty;
    public string StaffRole { get; set; } = string.Empty;
    public string? Specialization { get; set; }
    public string? StaffPhotoUrl { get; set; }
    public bool Available { get; set; }
    /// <summary>Why this person cannot simply be picked, when not available.</summary>
    public string? Reason { get; set; }
    /// <summary>Only the doctor's own hours or day off are in the way, so the hospital may confirm a one-off.</summary>
    public bool CanOverride { get; set; }
    public int ShiftsThatDay { get; set; }
}

public class AssignSessionStaffDto
{
    [Required]
    public Guid ScheduleId { get; set; }

    [Required]
    public DateOnly Date { get; set; }

    [Required]
    [MinLength(1)]
    public List<Guid> AffiliationIds { get; set; } = new();

    public bool OverrideAvailability { get; set; }
}

public class StaffDayCoverageDto
{
    public DateOnly Date { get; set; }
    public int ActiveDoctors { get; set; }
    public int ActiveNurses { get; set; }
    public int ScheduledDoctors { get; set; }
    public int ScheduledNurses { get; set; }
    public int TotalShifts { get; set; }
    public string CoverageLevel { get; set; } = "Low"; // Low | Partial | Good
    public string Summary { get; set; } = string.Empty;
}

public class StaffCoverageReportDto
{
    public DateOnly From { get; set; }
    public DateOnly To { get; set; }
    public int ActiveDoctors { get; set; }
    public int ActiveNurses { get; set; }

    /// <summary>Staff with a shift covering hospital-local now at this hospital.</summary>
    public int CurrentlyOnDutyStaff { get; set; }

    public int DaysWithLowCoverage { get; set; }
    public List<StaffDayCoverageDto> Days { get; set; } = new();
}

/// <summary>
/// Request for rules-based week shift suggestions (does not create shifts).
/// </summary>
public class SuggestWeekCoverageDto
{
    [Required]
    public DateOnly From { get; set; }

    [Required]
    public DateOnly To { get; set; }

    /// <summary>Default shift start (HH:mm). Defaults to 08:00.</summary>
    public string? DefaultStart { get; set; }

    /// <summary>Default shift end (HH:mm). Defaults to 16:00.</summary>
    public string? DefaultEnd { get; set; }
}

public class ShiftProposalDto
{
    public Guid AffiliationId { get; set; }
    public string StaffName { get; set; } = string.Empty;
    public string StaffRole { get; set; } = string.Empty;
    public DateOnly ShiftDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public Guid? BoothId { get; set; }
    public string? BoothOrStation { get; set; }
    public string? Notes { get; set; }
    public string Reason { get; set; } = string.Empty;
}

public class SuggestWeekCoverageResultDto
{
    public DateOnly From { get; set; }
    public DateOnly To { get; set; }
    public int ActiveDoctors { get; set; }
    public int ActiveNurses { get; set; }
    public int ProposalCount { get; set; }

    /// <summary>Low-coverage days that were skipped because they can no longer be scheduled.</summary>
    public int SkippedPastDays { get; set; }

    public string Message { get; set; } = string.Empty;
    public List<ShiftProposalDto> Proposals { get; set; } = new();
}
