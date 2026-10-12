using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vaxora.Api.Models;

public enum ShiftSwapStatus
{
    Pending,
    Approved,
    Declined,
    Cancelled,
}

/// <summary>
/// A doctor/nurse's request for someone else to cover one of their shifts.
/// Created from the staff cover-request form; the hospital approves or
/// declines. This lives in its own table so hospital users can query it
/// scoped to their own affiliations without touching AgentWorkflows.
/// </summary>
[Table("ShiftSwapRequests")]
public class ShiftSwapRequest
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The shift the requester cannot make. Kept as GUID to survive
    /// the shift being deleted after the fact.</summary>
    [Required]
    public Guid ShiftId { get; set; }

    /// <summary>Hospital that owns the shift — used for scoped listing.</summary>
    [Required]
    public Guid HospitalUserId { get; set; }

    [ForeignKey(nameof(HospitalUserId))]
    public virtual User HospitalUser { get; set; } = null!;

    [Required]
    public Guid RequesterUserId { get; set; }

    [ForeignKey(nameof(RequesterUserId))]
    public virtual User RequesterUser { get; set; } = null!;

    /// <summary>Snapshot of the shift date, so the row stays readable if
    /// the shift moves or is deleted later.</summary>
    [Required]
    public DateOnly ShiftDate { get; set; }

    [MaxLength(30)]
    public string? ShiftWindow { get; set; }

    [MaxLength(120)]
    public string? BoothOrStation { get; set; }

    [MaxLength(500)]
    public string? Reason { get; set; }

    /// <summary>Last message the requester typed in the swap chat, for
    /// context on the hospital's inbox card.</summary>
    [MaxLength(600)]
    public string? ConversationSnippet { get; set; }

    [Required]
    public ShiftSwapStatus Status { get; set; } = ShiftSwapStatus.Pending;

    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }

    /// <summary>Staff who took the shift after hospital approval.</summary>
    public Guid? ReplacementUserId { get; set; }
    public Guid? ReplacementAffiliationId { get; set; }

    [MaxLength(120)]
    public string? ReplacementName { get; set; }

    [MaxLength(500)]
    public string? DecisionNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
