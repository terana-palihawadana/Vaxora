using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

public class CreateVaccineScheduleDto
{
    [Required]
    public Guid BoothId { get; set; }

    public Guid? VaccineId { get; set; }

    [Required]
    public string VaccineName { get; set; } = string.Empty;

    [Required]
    public string ScheduleType { get; set; } = "OneTime"; // "OneTime" or "Weekly"

    public DateOnly? SpecificDate { get; set; }

    public List<string>? DaysOfWeek { get; set; } = new();

    public DateOnly? StartDate { get; set; }

    public DateOnly? EndDate { get; set; }

    [Required]
    public string StartTime { get; set; } = "09:00";

    [Required]
    public string EndTime { get; set; } = "11:00";

    [Range(0, 1000000, ErrorMessage = "Price must be greater than or equal to 0.")]
    public decimal Price { get; set; } = 0.00m;
}

public class ScheduleStockHorizonRequestDto
{
    public Guid? VaccineId { get; set; }

    public string? VaccineName { get; set; }

    [Required]
    public string ScheduleType { get; set; } = "OneTime";

    public DateOnly? SpecificDate { get; set; }

    public List<string>? DaysOfWeek { get; set; } = new();

    public DateOnly? StartDate { get; set; }

    public DateOnly? EndDate { get; set; }

    [Required]
    public string StartTime { get; set; } = "09:00";

    [Required]
    public string EndTime { get; set; } = "11:00";
}

public class ScheduleStockHorizonDto
{
    public int PhysicalDoses { get; set; }
    public int CommittedDoses { get; set; }
    public int EmergencyBufferDoses { get; set; }
    public int FreeDoses { get; set; }
    public int TimeBandsPerSession { get; set; }
    public int PatientsPerSlot { get; set; }
    public int SeatsPerSession { get; set; }
    public int ProposedDemandDoses { get; set; }
    public DateOnly? MaxEndDate { get; set; }
    public bool CanCreate { get; set; }
    public string Message { get; set; } = string.Empty;
}

public class VaccineScheduleDto
{
    public Guid Id { get; set; }
    public Guid HospitalUserId { get; set; }
    public string HospitalName { get; set; } = string.Empty;
    public Guid? BoothId { get; set; }
    public string? BoothLabel { get; set; }
    public Guid? VaccineId { get; set; }
    public string VaccineName { get; set; } = string.Empty;
    public string ScheduleType { get; set; } = "OneTime";
    public DateOnly? SpecificDate { get; set; }
    public List<string> DaysOfWeek { get; set; } = new();
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string StartTime { get; set; } = string.Empty;
    public string EndTime { get; set; } = string.Empty;
    public string FormattedTime { get; set; } = string.Empty;
    public string DisplayRecurrence { get; set; } = string.Empty;
    public decimal Price { get; set; } = 0.00m;
    public string FormattedPrice { get; set; } = "Free (0 LKR)";
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; }
}
