using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

public class CreateShiftSwapRequestDto
{
    [Required]
    public Guid ShiftId { get; set; }

    [MaxLength(500)]
    public string? Reason { get; set; }

    [MaxLength(600)]
    public string? ConversationSnippet { get; set; }
}

public class ShiftSwapDecisionDto
{
    [Required]
    public bool Approved { get; set; }

    [MaxLength(500)]
    public string? Note { get; set; }

    /// <summary>Required when approving — the affiliation that takes over the shift.</summary>
    public Guid? ReplacementAffiliationId { get; set; }
}

public class ShiftSwapReplacementDto
{
    public Guid AffiliationId { get; set; }
    public Guid StaffUserId { get; set; }
    public string StaffName { get; set; } = string.Empty;
    public string StaffRole { get; set; } = string.Empty;
    public string? StaffPhotoUrl { get; set; }
    public string? Specialization { get; set; }
    public string Why { get; set; } = string.Empty;
    public bool Available { get; set; } = true;
}

public class ShiftSwapRequestDto
{
    public Guid Id { get; set; }
    public Guid ShiftId { get; set; }
    public Guid HospitalUserId { get; set; }
    public string HospitalName { get; set; } = string.Empty;
    public Guid RequesterUserId { get; set; }
    public string RequesterName { get; set; } = string.Empty;
    public string RequesterRole { get; set; } = string.Empty;
    public string? RequesterPhotoUrl { get; set; }
    public string ShiftDate { get; set; } = string.Empty;
    public string? ShiftWindow { get; set; }
    public string? BoothOrStation { get; set; }
    public string? Reason { get; set; }
    public string? ConversationSnippet { get; set; }
    public string Status { get; set; } = "Pending";
    public string? DecisionNote { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DecidedAt { get; set; }
    public Guid? ReplacementUserId { get; set; }
    public string? ReplacementName { get; set; }
    /// <summary>Outgoing for the requester, Incoming when this staff was assigned cover.</summary>
    public string? Direction { get; set; }
    public string? ReviewSummary { get; set; }
    /// <summary>True when Suggestions were ordered by the AI agent (Rank with AI).</summary>
    public bool AiRanked { get; set; }
    public List<ShiftSwapReplacementDto> Suggestions { get; set; } = new();
}

public class CoverQuotaDto
{
    public int UsedThisMonth { get; set; }
    public int MonthlyLimit { get; set; }
    public int UrgentUsedThisMonth { get; set; }
    public int UrgentLimit { get; set; }
    public int MinNoticeDays { get; set; }
    public int? DaysUntilShift { get; set; }
    public bool IsUrgent { get; set; }
    public bool ReasonRequired { get; set; }
    public bool AlreadyPending { get; set; }
    public bool CanRequest { get; set; }
    public string? BlockReason { get; set; }
    public string Summary { get; set; } = string.Empty;
}
