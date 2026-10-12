using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vaxora.Api.Models;

/// <summary>
/// A weekly block a doctor offers to one hospital (hospital wall-clock).
/// No rows for an affiliation means the doctor has not limited their hours there.
/// </summary>
[Table("StaffAvailabilityWindows")]
public class StaffAvailabilityWindow
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid AffiliationId { get; set; }

    [ForeignKey(nameof(AffiliationId))]
    public virtual StaffAffiliation Affiliation { get; set; } = null!;

    [Required]
    public DayOfWeek DayOfWeek { get; set; }

    [Required]
    public TimeOnly StartTime { get; set; }

    [Required]
    public TimeOnly EndTime { get; set; }
}

/// <summary>A single date the doctor cannot work at this hospital, overriding the weekly pattern.</summary>
[Table("StaffUnavailableDates")]
public class StaffUnavailableDate
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid AffiliationId { get; set; }

    [ForeignKey(nameof(AffiliationId))]
    public virtual StaffAffiliation Affiliation { get; set; } = null!;

    [Required]
    public DateOnly Date { get; set; }
}
