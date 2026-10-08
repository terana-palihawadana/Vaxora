using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IShiftSwapService
{
    Task<ShiftSwapRequestDto> CreateAsync(Guid staffUserId, CreateShiftSwapRequestDto dto);
    Task<CoverQuotaDto> GetQuotaAsync(Guid staffUserId, Guid? shiftId = null);
    Task<List<ShiftSwapRequestDto>> ListForHospitalAsync(
        Guid hospitalUserId,
        string? status = null,
        int limit = 40);
    /// <summary>Re-orders one pending request's replacements with the AI agent, on demand.</summary>
    Task<ShiftSwapRequestDto> RankWithAgentAsync(Guid hospitalUserId, Guid requestId, string? bearerToken);
    Task<ShiftSwapRequestDto> DecideAsync(Guid hospitalUserId, Guid requestId, ShiftSwapDecisionDto decision);
    Task<List<ShiftSwapRequestDto>> ListForStaffAsync(Guid staffUserId, int limit = 40);
    Task TryRecordFromAgentAsync(Guid staffUserId, string? agentJson);
}

/// <summary>
/// Hospital-scoped cover requests. Separate from AgentWorkflows so a hospital
/// can list affiliated staff requests without impersonating those users.
/// </summary>
public class ShiftSwapService : IShiftSwapService
{
    private const int MonthlyCoverLimit = 3;
    private const int MonthlyUrgentLimit = 1;
    private const int MinNoticeDays = 2;
    private static readonly TimeSpan HospitalUtcOffset = TimeSpan.FromHours(5.5);

    private static DateTime HospitalNow() => DateTime.UtcNow + HospitalUtcOffset;
    private static DateOnly HospitalToday() => DateOnly.FromDateTime(HospitalNow());
    private readonly ApplicationDbContext _context;
    private readonly IAgentGatewayService _agentGateway;
    private readonly ILogger<ShiftSwapService> _logger;

    public ShiftSwapService(
        ApplicationDbContext context,
        IAgentGatewayService agentGateway,
        ILogger<ShiftSwapService> logger)
    {
        _context = context;
        _agentGateway = agentGateway;
        _logger = logger;
    }

    public async Task<ShiftSwapRequestDto> CreateAsync(Guid staffUserId, CreateShiftSwapRequestDto dto)
    {
        await EnsureActiveStaffAsync(staffUserId);

        var shift = await _context.StaffShifts
            .Include(s => s.Booth)
            .Include(s => s.Affiliation)
            .FirstOrDefaultAsync(s => s.Id == dto.ShiftId);

        if (shift == null)
            throw new KeyNotFoundException("Shift not found.");

        if (shift.Affiliation.StaffUserId != staffUserId)
            throw new UnauthorizedAccessException("You can only request cover for your own shifts.");

        if (shift.Affiliation.Status != AffiliationStatus.Active)
            throw new InvalidOperationException("Your affiliation with this hospital is not active.");

        var snippet = Truncate(dto.ConversationSnippet, 600);
        var reason = Truncate(dto.Reason, 500);

        var existing = await _context.ShiftSwapRequests
            .FirstOrDefaultAsync(r =>
                r.ShiftId == shift.Id &&
                r.RequesterUserId == staffUserId &&
                r.Status == ShiftSwapStatus.Pending);

        if (existing != null)
        {
            if (!string.IsNullOrWhiteSpace(reason)) existing.Reason = reason;
            if (!string.IsNullOrWhiteSpace(snippet)) existing.ConversationSnippet = snippet;
            existing.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
            return await GetMappedAsync(existing.Id);
        }

        var quota = await BuildQuotaAsync(staffUserId, shift, reason, submitting: true);
        if (!quota.CanRequest)
            throw new InvalidOperationException(quota.BlockReason ?? "You cannot request cover for this shift.");

        var row = new ShiftSwapRequest
        {
            ShiftId = shift.Id,
            HospitalUserId = shift.Affiliation.HospitalUserId,
            RequesterUserId = staffUserId,
            ShiftDate = shift.ShiftDate,
            ShiftWindow = $"{shift.StartTime:HH\\:mm}–{shift.EndTime:HH\\:mm}",
            BoothOrStation = Truncate(shift.Booth?.DisplayLabel ?? shift.BoothOrStation, 120),
            Reason = reason,
            ConversationSnippet = snippet,
            Status = ShiftSwapStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _context.ShiftSwapRequests.Add(row);
        await _context.SaveChangesAsync();

        _logger.LogInformation(
            "Shift swap {RequestId} opened by {StaffUserId} for shift {ShiftId}",
            row.Id,
            staffUserId,
            shift.Id);

        return await GetMappedAsync(row.Id);
    }

    public async Task<CoverQuotaDto> GetQuotaAsync(Guid staffUserId, Guid? shiftId = null)
    {
        await EnsureActiveStaffAsync(staffUserId);

        StaffShift? shift = null;
        if (shiftId.HasValue && shiftId.Value != Guid.Empty)
        {
            shift = await _context.StaffShifts
                .Include(s => s.Affiliation)
                .FirstOrDefaultAsync(s => s.Id == shiftId.Value);
            if (shift != null && shift.Affiliation.StaffUserId != staffUserId)
                shift = null;
        }

        return await BuildQuotaAsync(staffUserId, shift, reason: null, submitting: false);
    }

    public async Task<List<ShiftSwapRequestDto>> ListForHospitalAsync(
        Guid hospitalUserId,
        string? status = null,
        int limit = 40)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);
        limit = Math.Clamp(limit, 1, 80);

        var query = _context.ShiftSwapRequests
            .AsNoTracking()
            .Include(r => r.RequesterUser).ThenInclude(u => u.DoctorProfile)
            .Include(r => r.RequesterUser).ThenInclude(u => u.NurseProfile)
            .Include(r => r.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Where(r => r.HospitalUserId == hospitalUserId);

        if (!string.IsNullOrWhiteSpace(status) &&
            Enum.TryParse<ShiftSwapStatus>(status.Trim(), true, out var parsed))
        {
            query = query.Where(r => r.Status == parsed);
        }

        var rows = await query
            .OrderByDescending(r => r.Status == ShiftSwapStatus.Pending)
            .ThenByDescending(r => r.CreatedAt)
            .Take(limit)
            .ToListAsync();

        // Roster-order suggestions only; the AI ranking is a separate, on-demand call
        // so a slow LLM never blocks the inbox.
        var dtos = rows.Select(Map).ToList();
        await AttachSuggestionsAsync(hospitalUserId, dtos);
        return dtos;
    }

    public async Task<ShiftSwapRequestDto> RankWithAgentAsync(
        Guid hospitalUserId,
        Guid requestId,
        string? bearerToken)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var row = await _context.ShiftSwapRequests
            .AsNoTracking()
            .Include(r => r.RequesterUser).ThenInclude(u => u.DoctorProfile)
            .Include(r => r.RequesterUser).ThenInclude(u => u.NurseProfile)
            .Include(r => r.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .FirstOrDefaultAsync(r => r.Id == requestId && r.HospitalUserId == hospitalUserId);

        if (row == null)
            throw new KeyNotFoundException("Cover request not found.");
        if (row.Status != ShiftSwapStatus.Pending)
            throw new InvalidOperationException("Only pending cover requests can be ranked.");

        var dto = Map(row);
        await AttachSuggestionsAsync(hospitalUserId, new List<ShiftSwapRequestDto> { dto });
        if (dto.Suggestions.Count > 1)
            dto.AiRanked = await RankCoverWithAgentAsync(new List<ShiftSwapRequestDto> { dto }, bearerToken);
        return dto;
    }

    public async Task<List<ShiftSwapRequestDto>> ListForStaffAsync(Guid staffUserId, int limit = 40)
    {
        await EnsureActiveStaffAsync(staffUserId);
        limit = Math.Clamp(limit, 1, 80);

        var rows = await _context.ShiftSwapRequests
            .AsNoTracking()
            .Include(r => r.RequesterUser).ThenInclude(u => u.DoctorProfile)
            .Include(r => r.RequesterUser).ThenInclude(u => u.NurseProfile)
            .Include(r => r.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .Where(r =>
                r.RequesterUserId == staffUserId ||
                (r.Status == ShiftSwapStatus.Approved && r.ReplacementUserId == staffUserId))
            .OrderByDescending(r => r.Status == ShiftSwapStatus.Pending)
            .ThenByDescending(r => r.CreatedAt)
            .Take(limit)
            .ToListAsync();

        return rows.Select(r =>
        {
            var dto = Map(r);
            dto.Direction = r.RequesterUserId == staffUserId ? "Outgoing" : "Incoming";
            return dto;
        }).ToList();
    }

    public async Task<ShiftSwapRequestDto> DecideAsync(
        Guid hospitalUserId,
        Guid requestId,
        ShiftSwapDecisionDto decision)
    {
        await EnsureActiveHospitalAsync(hospitalUserId);

        var row = await _context.ShiftSwapRequests
            .FirstOrDefaultAsync(r => r.Id == requestId && r.HospitalUserId == hospitalUserId);

        if (row == null)
            throw new KeyNotFoundException("Cover request not found.");

        if (row.Status != ShiftSwapStatus.Pending)
            throw new InvalidOperationException($"Request cannot be decided from status '{row.Status}'.");

        if (decision.Approved)
        {
            if (!decision.ReplacementAffiliationId.HasValue ||
                decision.ReplacementAffiliationId.Value == Guid.Empty)
            {
                throw new InvalidOperationException("Pick a replacement before approving.");
            }

            await ReassignShiftAsync(
                hospitalUserId,
                row,
                decision.ReplacementAffiliationId.Value);
        }

        row.Status = decision.Approved ? ShiftSwapStatus.Approved : ShiftSwapStatus.Declined;
        row.DecidedByUserId = hospitalUserId;
        row.DecidedAt = DateTime.UtcNow;
        row.DecisionNote = Truncate(decision.Note, 500) ?? row.DecisionNote;
        row.UpdatedAt = DateTime.UtcNow;

        var hospital = await _context.Users.FirstAsync(u => u.Id == hospitalUserId);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = hospital.Role.ToString(),
            Action = decision.Approved ? "SHIFT_SWAP_APPROVED" : "SHIFT_SWAP_DECLINED",
            Details = decision.Approved
                ? $"Cover request {row.Id} reassigned shift {row.ShiftId} on {row.ShiftDate:yyyy-MM-dd}"
                : $"Cover request {row.Id} declined for shift {row.ShiftId} on {row.ShiftDate:yyyy-MM-dd}"
        });

        await _context.SaveChangesAsync();
        return await GetMappedAsync(row.Id);
    }

    public async Task TryRecordFromAgentAsync(Guid staffUserId, string? agentJson)
    {
        if (string.IsNullOrWhiteSpace(agentJson)) return;

        try
        {
            using var document = JsonDocument.Parse(agentJson);
            var root = document.RootElement;

            if (!root.TryGetProperty("proposals", out var proposals) ||
                proposals.ValueKind != JsonValueKind.Array)
            {
                return;
            }

            foreach (var proposal in proposals.EnumerateArray())
            {
                if (proposal.ValueKind != JsonValueKind.Object) continue;

                var kind = proposal.TryGetProperty("kind", out var kindEl) && kindEl.ValueKind == JsonValueKind.String
                    ? kindEl.GetString()
                    : null;
                if (!string.IsNullOrWhiteSpace(kind) &&
                    !string.Equals(kind, "ShiftSwapRequest", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (!proposal.TryGetProperty("shiftId", out var shiftEl)) continue;
                var shiftRaw = shiftEl.ValueKind == JsonValueKind.String ? shiftEl.GetString() : shiftEl.ToString();
                if (!Guid.TryParse(shiftRaw, out var shiftId) || shiftId == Guid.Empty) continue;

                var snippet = proposal.TryGetProperty("conversationSnippet", out var snEl) && snEl.ValueKind == JsonValueKind.String
                    ? snEl.GetString()
                    : null;
                var reason = proposal.TryGetProperty("reason", out var reasonEl) && reasonEl.ValueKind == JsonValueKind.String
                    ? reasonEl.GetString()
                    : null;

                await CreateAsync(staffUserId, new CreateShiftSwapRequestDto
                {
                    ShiftId = shiftId,
                    Reason = reason,
                    ConversationSnippet = snippet
                });
                return;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not persist shift-swap request from agent payload for {StaffUserId}", staffUserId);
        }
    }

    private async Task<ShiftSwapRequestDto> GetMappedAsync(Guid id)
    {
        var row = await _context.ShiftSwapRequests
            .AsNoTracking()
            .Include(r => r.RequesterUser).ThenInclude(u => u.DoctorProfile)
            .Include(r => r.RequesterUser).ThenInclude(u => u.NurseProfile)
            .Include(r => r.HospitalUser).ThenInclude(h => h.HospitalProfile)
            .FirstAsync(r => r.Id == id);
        return Map(row);
    }

    private static ShiftSwapRequestDto Map(ShiftSwapRequest row)
    {
        var staff = row.RequesterUser;
        return new ShiftSwapRequestDto
        {
            Id = row.Id,
            ShiftId = row.ShiftId,
            HospitalUserId = row.HospitalUserId,
            HospitalName = row.HospitalUser?.HospitalProfile?.HospitalName ?? string.Empty,
            RequesterUserId = row.RequesterUserId,
            RequesterName = GetStaffName(staff),
            RequesterRole = staff?.Role.ToString() ?? string.Empty,
            RequesterPhotoUrl = staff?.DoctorProfile?.ProfilePhotoUrl
                ?? staff?.NurseProfile?.ProfilePhotoUrl,
            ShiftDate = row.ShiftDate.ToString("yyyy-MM-dd"),
            ShiftWindow = row.ShiftWindow,
            BoothOrStation = row.BoothOrStation,
            Reason = row.Reason,
            ConversationSnippet = row.ConversationSnippet,
            Status = row.Status.ToString(),
            DecisionNote = row.DecisionNote,
            CreatedAt = row.CreatedAt,
            DecidedAt = row.DecidedAt,
            ReplacementUserId = row.ReplacementUserId,
            ReplacementName = row.ReplacementName,
            Suggestions = new List<ShiftSwapReplacementDto>()
        };
    }

    private async Task AttachSuggestionsAsync(
        Guid hospitalUserId,
        List<ShiftSwapRequestDto> dtos)
    {
        var pending = dtos.Where(d =>
            string.Equals(d.Status, nameof(ShiftSwapStatus.Pending), StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (pending.Count == 0) return;

        var shiftIds = pending.Select(d => d.ShiftId).Distinct().ToList();
        var shifts = await _context.StaffShifts
            .Include(s => s.Booth)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(s => shiftIds.Contains(s.Id))
            .ToListAsync();
        var shiftById = shifts.ToDictionary(s => s.Id);

        var pool = await _context.StaffAffiliations
            .Include(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .Where(a => a.HospitalUserId == hospitalUserId && a.Status == AffiliationStatus.Active)
            .ToListAsync();

        var staffIds = pool.Select(a => a.StaffUserId).Distinct().ToList();
        var dates = shifts.Select(s => s.ShiftDate).Distinct().ToList();
        var dayShifts = staffIds.Count == 0 || dates.Count == 0
            ? new List<StaffShift>()
            : await _context.StaffShifts
                .Include(s => s.Affiliation)
                .Where(s =>
                    staffIds.Contains(s.Affiliation.StaffUserId) &&
                    s.Affiliation.Status == AffiliationStatus.Active &&
                    dates.Contains(s.ShiftDate))
                .ToListAsync();

        foreach (var dto in pending)
        {
            if (!shiftById.TryGetValue(dto.ShiftId, out var shift))
            {
                dto.ReviewSummary = "This shift is no longer on the roster.";
                continue;
            }

            var role = ResolveCoverRole(shift, dto);
            var roleLabel = role == UserRole.DOCTOR ? "doctor" : "nurse";
            var neededSpec = shift.Affiliation.StaffUser?.DoctorProfile?.Specialization;
            var booth = shift.Booth?.DisplayLabel ?? shift.BoothOrStation ?? dto.BoothOrStation;
            var candidates = new List<(StaffAffiliation Aff, bool SpecMatch, int OtherCount, string Why)>();

            foreach (var affiliation in pool)
            {
                if (affiliation.StaffUser == null) continue;
                if (!IsSameCoverRole(affiliation, role)) continue;
                if (affiliation.StaffUserId == dto.RequesterUserId) continue;

                var theirs = dayShifts
                    .Where(s =>
                        s.Affiliation.StaffUserId == affiliation.StaffUserId &&
                        s.ShiftDate == shift.ShiftDate &&
                        s.Id != shift.Id)
                    .ToList();

                // Only a clashing window blocks assignment — another slot the same day is fine.
                var overlaps = theirs.Any(s =>
                    shift.StartTime < s.EndTime && shift.EndTime > s.StartTime);
                if (overlaps) continue;

                var specMatch = SpecializationFits(
                    affiliation.StaffUser.DoctorProfile?.Specialization,
                    neededSpec,
                    booth);
                var window = $"{shift.StartTime:HH\\:mm}–{shift.EndTime:HH\\:mm}";
                string why;
                if (specMatch)
                {
                    why = theirs.Count == 0
                        ? $"Same specialization · free {window}"
                        : $"Same specialization · free {window} · {theirs.Count} other shift(s) that day";
                }
                else
                {
                    why = theirs.Count == 0
                        ? $"Same role · free {window}"
                        : $"Same role · free {window} · {theirs.Count} other shift(s) that day";
                }

                candidates.Add((affiliation, specMatch, theirs.Count, why));
            }

            // Matching specialization first, then other same-role colleagues who are free.
            var picked = candidates
                .OrderByDescending(c => c.SpecMatch)
                .ThenBy(c => c.OtherCount)
                .ThenBy(c => GetStaffName(c.Aff.StaffUser), StringComparer.OrdinalIgnoreCase)
                .Take(5)
                .ToList();

            dto.Suggestions = picked.Select(c => new ShiftSwapReplacementDto
            {
                AffiliationId = c.Aff.Id,
                StaffUserId = c.Aff.StaffUserId,
                StaffName = GetStaffName(c.Aff.StaffUser),
                StaffRole = c.Aff.StaffRole.ToString(),
                StaffPhotoUrl = c.Aff.StaffUser.DoctorProfile?.ProfilePhotoUrl
                    ?? c.Aff.StaffUser.NurseProfile?.ProfilePhotoUrl,
                Specialization = c.Aff.StaffUser.DoctorProfile?.Specialization,
                Why = c.Why,
                Available = true
            }).ToList();

            var specCount = picked.Count(c => c.SpecMatch);
            dto.ReviewSummary = picked.Count == 0
                ? $"No other {roleLabel} is free in this window."
                : specCount > 0
                    ? $"{specCount} matching specialization, then other {roleLabel}s."
                    : $"{picked.Count} other {roleLabel}(s) can cover this window.";
        }
    }

    /// <summary>Returns true when the agent replied and its ranking was applied.</summary>
    private async Task<bool> RankCoverWithAgentAsync(List<ShiftSwapRequestDto> dtos, string? bearerToken)
    {
        var pending = dtos.Where(d =>
                string.Equals(d.Status, nameof(ShiftSwapStatus.Pending), StringComparison.OrdinalIgnoreCase) &&
                d.Suggestions.Count > 0)
            .ToList();
        if (pending.Count == 0 || string.IsNullOrWhiteSpace(bearerToken))
            return false;

        var payload = new
        {
            requests = pending.Select(d => new
            {
                requestId = d.Id,
                requester = d.RequesterName,
                role = d.RequesterRole,
                date = d.ShiftDate,
                window = d.ShiftWindow,
                booth = d.BoothOrStation,
                reason = d.Reason,
                candidates = d.Suggestions.Select(s => new
                {
                    affiliationId = s.AffiliationId,
                    name = s.StaffName,
                    specialization = s.Specialization,
                    available = s.Available,
                    facts = s.Why
                })
            })
        };

        var request = new AgentChatRequestDto
        {
            TargetAgent = "StaffSchedulingAgent",
            Messages =
            {
                new AgentMessageDto
                {
                    Role = "user",
                    Content = "RANK_COVER_REPLACEMENTS\n" + JsonSerializer.Serialize(payload)
                }
            }
        };

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            var result = await _agentGateway.ChatAsync(request, bearerToken, new[] { "StaffSchedulingAgent" }, cts.Token);
            if (!result.Success || string.IsNullOrWhiteSpace(result.Json))
                return false;

            return ApplyAgentRanking(pending, result.Json);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Cover ranking agent unavailable; using roster order.");
            return false;
        }
    }

    private static bool ApplyAgentRanking(List<ShiftSwapRequestDto> pending, string agentJson)
    {
        using var document = JsonDocument.Parse(agentJson);
        var root = document.RootElement;
        var content = root.TryGetProperty("content", out var contentEl) && contentEl.ValueKind == JsonValueKind.String
            ? contentEl.GetString()
            : agentJson;
        if (string.IsNullOrWhiteSpace(content))
            return false;

        var json = content.Trim();
        var start = json.IndexOf('{');
        var end = json.LastIndexOf('}');
        if (start < 0 || end <= start)
            return false;

        using var rankedDoc = JsonDocument.Parse(json[start..(end + 1)]);
        if (!rankedDoc.RootElement.TryGetProperty("reviews", out var reviews) ||
            reviews.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        var byId = pending.ToDictionary(d => d.Id);
        var applied = false;
        foreach (var review in reviews.EnumerateArray())
        {
            if (!review.TryGetProperty("requestId", out var idEl)) continue;
            if (!Guid.TryParse(idEl.GetString(), out var requestId)) continue;
            if (!byId.TryGetValue(requestId, out var dto)) continue;

            if (review.TryGetProperty("summary", out var summaryEl) &&
                summaryEl.ValueKind == JsonValueKind.String)
            {
                var summary = summaryEl.GetString();
                if (!string.IsNullOrWhiteSpace(summary))
                    dto.ReviewSummary = summary.Trim();
            }

            if (!review.TryGetProperty("ranked", out var ranked) || ranked.ValueKind != JsonValueKind.Array)
                continue;

            var pool = dto.Suggestions.ToDictionary(s => s.AffiliationId);
            var ordered = new List<ShiftSwapReplacementDto>();
            foreach (var item in ranked.EnumerateArray())
            {
                if (!item.TryGetProperty("affiliationId", out var affEl)) continue;
                if (!Guid.TryParse(affEl.GetString(), out var affId)) continue;
                if (!pool.Remove(affId, out var match)) continue;
                if (item.TryGetProperty("why", out var whyEl) && whyEl.ValueKind == JsonValueKind.String)
                {
                    var why = whyEl.GetString();
                    if (!string.IsNullOrWhiteSpace(why))
                        match.Why = why.Trim();
                }
                ordered.Add(match);
            }

            applied |= ordered.Count > 0;
            ordered.AddRange(pool.Values);
            dto.Suggestions = ordered;
        }

        return applied;
    }

    private async Task ReassignShiftAsync(
        Guid hospitalUserId,
        ShiftSwapRequest row,
        Guid replacementAffiliationId)
    {
        var shift = await _context.StaffShifts
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(s => s.Affiliation).ThenInclude(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .FirstOrDefaultAsync(s => s.Id == row.ShiftId && s.Affiliation.HospitalUserId == hospitalUserId);

        if (shift == null)
            throw new InvalidOperationException("This shift is no longer on the roster.");

        var today = HospitalToday();
        if (shift.ShiftDate < today ||
            (shift.ShiftDate == today && TimeOnly.FromDateTime(HospitalNow()) >= shift.StartTime))
        {
            throw new InvalidOperationException(
                "This shift has already started — it can no longer be reassigned. Decline the request instead.");
        }

        var replacement = await _context.StaffAffiliations
            .Include(a => a.StaffUser).ThenInclude(u => u.DoctorProfile)
            .Include(a => a.StaffUser).ThenInclude(u => u.NurseProfile)
            .FirstOrDefaultAsync(a =>
                a.Id == replacementAffiliationId &&
                a.HospitalUserId == hospitalUserId);

        if (replacement == null || replacement.Status != AffiliationStatus.Active)
            throw new InvalidOperationException("That staff member is not an active affiliate of this hospital.");

        if (replacement.StaffUserId == row.RequesterUserId)
            throw new InvalidOperationException("Pick someone other than the requester.");

        var neededRole = ResolveCoverRole(shift);
        if (!IsSameCoverRole(replacement, neededRole))
            throw new InvalidOperationException("Replacement must match the original role for this shift.");

        var overlapping = await _context.StaffShifts
            .Include(s => s.Affiliation)
            .Where(s =>
                s.Id != shift.Id &&
                s.Affiliation.StaffUserId == replacement.StaffUserId &&
                s.Affiliation.Status == AffiliationStatus.Active &&
                s.ShiftDate == shift.ShiftDate)
            .ToListAsync();

        if (overlapping.Any(s => shift.StartTime < s.EndTime && shift.EndTime > s.StartTime))
            throw new InvalidOperationException("That person is already booked in this window.");

        var fromName = GetStaffName(shift.Affiliation.StaffUser);
        var toName = GetStaffName(replacement.StaffUser);

        row.ReplacementUserId = replacement.StaffUserId;
        row.ReplacementAffiliationId = replacement.Id;
        row.ReplacementName = Truncate(toName, 120);

        shift.Affiliation = replacement;
        shift.AffiliationId = replacement.Id;
        shift.UpdatedAt = DateTime.UtcNow;
        if (string.IsNullOrWhiteSpace(row.DecisionNote))
            row.DecisionNote = Truncate($"Assigned to {toName}", 500);

        var hospital = await _context.Users.FirstAsync(u => u.Id == hospitalUserId);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = hospitalUserId,
            UserEmail = hospital.Email,
            Role = hospital.Role.ToString(),
            Action = "STAFF_SHIFT_REASSIGNED",
            Details =
                $"Shift {shift.Id} on {shift.ShiftDate:yyyy-MM-dd} {shift.StartTime:HH\\:mm}-{shift.EndTime:HH\\:mm} " +
                $"moved from {fromName} to {toName}"
        });
    }

    private static UserRole ResolveCoverRole(StaffShift shift, ShiftSwapRequestDto? dto = null)
    {
        if (shift.Affiliation.StaffRole is UserRole.DOCTOR or UserRole.NURSE)
            return shift.Affiliation.StaffRole;
        if (shift.Affiliation.StaffUser?.Role is UserRole.DOCTOR or UserRole.NURSE)
            return shift.Affiliation.StaffUser.Role;
        if (dto != null &&
            Enum.TryParse<UserRole>(dto.RequesterRole, true, out var parsed) &&
            parsed is UserRole.DOCTOR or UserRole.NURSE)
        {
            return parsed;
        }
        return UserRole.DOCTOR;
    }

    private static bool IsSameCoverRole(StaffAffiliation affiliation, UserRole role) =>
        affiliation.StaffRole == role || affiliation.StaffUser?.Role == role;

    private static bool SpecializationFits(string? staffSpec, string? neededSpec, string? booth)
    {
        var spec = (staffSpec ?? string.Empty).Trim().ToLowerInvariant();
        if (spec.Length < 3) return false;

        var needed = (neededSpec ?? string.Empty).Trim().ToLowerInvariant();
        if (needed.Length >= 3 && (spec.Contains(needed) || needed.Contains(spec)))
            return true;

        var boothText = (booth ?? string.Empty).Trim().ToLowerInvariant();
        if (boothText.Length == 0) return false;

        foreach (var token in spec.Split(new[] { ' ', '/', ',', '-' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (token.Length >= 4 && boothText.Contains(token))
                return true;
        }

        return false;
    }

    private static string GetStaffName(User? staffUser) => StaffNameFormatter.Format(staffUser);

    private async Task<CoverQuotaDto> BuildQuotaAsync(
        Guid staffUserId,
        StaffShift? shift,
        string? reason,
        bool submitting)
    {
        var today = HospitalToday();
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var monthEnd = monthStart.AddMonths(1);
        // Npgsql rejects Kind=Unspecified for timestamptz parameters.
        var monthStartUtc = DateTime.SpecifyKind(
            monthStart.ToDateTime(TimeOnly.MinValue) - HospitalUtcOffset,
            DateTimeKind.Utc);
        var monthEndUtc = DateTime.SpecifyKind(
            monthEnd.ToDateTime(TimeOnly.MinValue) - HospitalUtcOffset,
            DateTimeKind.Utc);

        var monthRows = await _context.ShiftSwapRequests
            .AsNoTracking()
            .Where(r =>
                r.RequesterUserId == staffUserId &&
                (r.Status == ShiftSwapStatus.Pending || r.Status == ShiftSwapStatus.Approved) &&
                r.CreatedAt >= monthStartUtc &&
                r.CreatedAt < monthEndUtc)
            .ToListAsync();

        var used = monthRows.Count;
        var urgentUsed = monthRows.Count(r =>
        {
            var createdLocal = DateOnly.FromDateTime(r.CreatedAt + HospitalUtcOffset);
            return r.ShiftDate.DayNumber - createdLocal.DayNumber < MinNoticeDays;
        });

        var quota = new CoverQuotaDto
        {
            UsedThisMonth = used,
            MonthlyLimit = MonthlyCoverLimit,
            UrgentUsedThisMonth = urgentUsed,
            UrgentLimit = MonthlyUrgentLimit,
            MinNoticeDays = MinNoticeDays,
            CanRequest = true,
            Summary = $"{used} of {MonthlyCoverLimit} covers used this month."
        };

        if (shift == null)
            return quota;

        quota.AlreadyPending = monthRows.Any(r =>
            r.ShiftId == shift.Id && r.Status == ShiftSwapStatus.Pending);
        if (quota.AlreadyPending)
        {
            quota.Summary = "You already have a pending request for this shift.";
            return quota;
        }

        var daysUntil = shift.ShiftDate.DayNumber - today.DayNumber;
        quota.DaysUntilShift = daysUntil;

        // Reassigning a started shift would credit the replacement with hours the
        // requester already worked, so cover is only possible before the start.
        if (daysUntil < 0 ||
            (daysUntil == 0 && HospitalNow().TimeOfDay >= shift.StartTime.ToTimeSpan()))
        {
            quota.CanRequest = false;
            quota.BlockReason = "This shift has already started — tell the hospital desk directly.";
            quota.Summary = quota.BlockReason;
            return quota;
        }

        quota.IsUrgent = daysUntil < MinNoticeDays;
        quota.ReasonRequired = quota.IsUrgent;

        if (used >= MonthlyCoverLimit)
        {
            quota.CanRequest = false;
            quota.BlockReason =
                $"You've already requested {MonthlyCoverLimit} covers this month. Try again next month.";
            quota.Summary = quota.BlockReason;
            return quota;
        }

        if (quota.IsUrgent && urgentUsed >= MonthlyUrgentLimit)
        {
            quota.CanRequest = false;
            quota.BlockReason =
                $"Short-notice cover (under {MinNoticeDays} days) is limited to {MonthlyUrgentLimit} per month. Ask at least {MinNoticeDays} days ahead next time.";
            quota.Summary = quota.BlockReason;
            return quota;
        }

        if (quota.IsUrgent && string.IsNullOrWhiteSpace(reason))
        {
            quota.Summary =
                $"Short notice ({daysUntil} day{(daysUntil == 1 ? "" : "s")} left). Add a reason — {MonthlyUrgentLimit - urgentUsed} urgent slot left this month.";
            if (submitting)
            {
                quota.CanRequest = false;
                quota.BlockReason = "Short-notice cover needs a reason so the hospital can triage it.";
                quota.Summary = quota.BlockReason;
            }
            return quota;
        }

        var left = MonthlyCoverLimit - used;
        quota.Summary = quota.IsUrgent
            ? $"Short notice. {left} cover{(left == 1 ? "" : "s")} left this month."
            : $"{left} cover{(left == 1 ? "" : "s")} left this month · ask at least {MinNoticeDays} days ahead.";
        return quota;
    }

    private async Task EnsureActiveHospitalAsync(Guid hospitalUserId)
    {
        var hospital = await _context.Users.FirstOrDefaultAsync(u => u.Id == hospitalUserId);
        if (hospital == null || hospital.Role != UserRole.HOSPITAL)
            throw new UnauthorizedAccessException("Only hospital accounts can perform this action.");
        if (hospital.Status != UserStatus.Active)
            throw new InvalidOperationException("Hospital account must be Active.");
    }

    private async Task EnsureActiveStaffAsync(Guid staffUserId)
    {
        var staff = await _context.Users.FirstOrDefaultAsync(u => u.Id == staffUserId);
        if (staff == null || staff.Role is not (UserRole.DOCTOR or UserRole.NURSE))
            throw new UnauthorizedAccessException("Only doctor or nurse accounts can perform this action.");
        if (staff.Status != UserStatus.Active)
            throw new InvalidOperationException("Staff account must be Active.");
    }

    private static string? Truncate(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}
