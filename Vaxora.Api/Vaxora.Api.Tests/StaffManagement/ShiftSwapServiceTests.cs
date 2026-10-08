using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class ShiftSwapServiceTests
{
    [Fact]
    public async Task GetQuotaAsync_returns_limits_and_utc_safe_month_window()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-2001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        var shift = TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 5);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var quota = await service.GetQuotaAsync(doctor.Id, shift.Id);

        Assert.True(quota.CanRequest);
        Assert.Equal(0, quota.UsedThisMonth);
        Assert.Equal(3, quota.MonthlyLimit);
        Assert.Equal(1, quota.UrgentLimit);
        Assert.Equal(5, quota.DaysUntilShift);
        Assert.False(quota.IsUrgent);
        Assert.False(quota.ReasonRequired);
    }

    [Fact]
    public async Task GetQuotaAsync_marks_short_notice_as_urgent_and_requires_reason()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-2002");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        var shift = TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 1);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var quota = await service.GetQuotaAsync(doctor.Id, shift.Id);

        Assert.True(quota.CanRequest);
        Assert.True(quota.IsUrgent);
        Assert.True(quota.ReasonRequired);
        Assert.Equal(1, quota.DaysUntilShift);
    }

    [Fact]
    public async Task GetQuotaAsync_blocks_shift_that_already_started()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-2003");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        var past = new StaffShift
        {
            AffiliationId = affiliation.Id,
            Affiliation = affiliation,
            ShiftDate = StaffDutyHelper.HospitalToday().AddDays(-1),
            StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0),
            CreatedByUserId = hospital.Id
        };
        context.StaffShifts.Add(past);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var quota = await service.GetQuotaAsync(doctor.Id, past.Id);

        Assert.False(quota.CanRequest);
        Assert.Contains("already started", quota.BlockReason ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateAsync_blocks_when_monthly_cover_limit_reached()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-2004");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        var target = TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 5);

        for (var i = 0; i < 3; i++)
        {
            var usedShift = TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 6 + i);
            context.ShiftSwapRequests.Add(new ShiftSwapRequest
            {
                ShiftId = usedShift.Id,
                HospitalUserId = hospital.Id,
                RequesterUserId = doctor.Id,
                ShiftDate = usedShift.ShiftDate,
                ShiftWindow = "09:00–12:00",
                Status = ShiftSwapStatus.Approved,
                CreatedAt = DateTime.UtcNow.AddDays(-i),
                UpdatedAt = DateTime.UtcNow.AddDays(-i)
            });
        }

        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateAsync(doctor.Id, new CreateShiftSwapRequestDto
            {
                ShiftId = target.Id,
                Reason = "Family emergency"
            }));

        Assert.Contains("3 covers", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateAsync_requires_reason_for_short_notice_cover()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-2005");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        var shift = TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 1);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateAsync(doctor.Id, new CreateShiftSwapRequestDto
            {
                ShiftId = shift.Id
            }));

        Assert.Contains("reason", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateAsync_stores_pending_cover_request_for_own_future_shift()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-2006");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        var shift = TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 4);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var created = await service.CreateAsync(doctor.Id, new CreateShiftSwapRequestDto
        {
            ShiftId = shift.Id,
            Reason = "Clinic clash"
        });

        Assert.Equal("Pending", created.Status);
        Assert.Equal(shift.Id, created.ShiftId);
        Assert.Equal(1, await context.ShiftSwapRequests.CountAsync());
    }

    [Fact]
    public async Task DecideAsync_reassigns_shift_and_returns_approved_status_to_both_staff_members()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var requester = TestDb.AddDoctor(context, "requester@example.com", "VAX-D-2010");
        var replacement = TestDb.AddDoctor(context, "replacement@example.com", "VAX-D-2011");
        var requesterAffiliation = TestDb.AddActiveAffiliation(context, hospital, requester);
        var replacementAffiliation = TestDb.AddActiveAffiliation(context, hospital, replacement);
        var shift = TestDb.AddFutureShift(context, requesterAffiliation, hospital);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var request = await service.CreateAsync(requester.Id, new CreateShiftSwapRequestDto
        {
            ShiftId = shift.Id,
            Reason = "Clinic conflict"
        });

        var decided = await service.DecideAsync(hospital.Id, request.Id, new ShiftSwapDecisionDto
        {
            Approved = true,
            ReplacementAffiliationId = replacementAffiliation.Id
        });

        var updatedShift = await context.StaffShifts.SingleAsync(s => s.Id == shift.Id);
        var requesterHistory = Assert.Single(await service.ListForStaffAsync(requester.Id));
        var replacementHistory = Assert.Single(await service.ListForStaffAsync(replacement.Id));

        Assert.Equal("Approved", decided.Status);
        Assert.Equal(replacementAffiliation.Id, updatedShift.AffiliationId);
        Assert.Equal("Approved", requesterHistory.Status);
        Assert.Equal("Outgoing", requesterHistory.Direction);
        Assert.Equal($"Dr. {replacement.DoctorProfile!.FullName}", requesterHistory.ReplacementName);
        Assert.Equal("Incoming", replacementHistory.Direction);
        Assert.Equal(requester.Id, replacementHistory.RequesterUserId);
    }

    [Fact]
    public async Task DecideAsync_refuses_to_reassign_a_shift_that_already_started()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var requester = TestDb.AddDoctor(context, "requester@example.com", "VAX-D-2020");
        var replacement = TestDb.AddDoctor(context, "replacement@example.com", "VAX-D-2021");
        var requesterAffiliation = TestDb.AddActiveAffiliation(context, hospital, requester);
        var replacementAffiliation = TestDb.AddActiveAffiliation(context, hospital, replacement);
        var started = new StaffShift
        {
            AffiliationId = requesterAffiliation.Id,
            Affiliation = requesterAffiliation,
            ShiftDate = StaffDutyHelper.HospitalToday().AddDays(-1),
            StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0),
            CreatedByUserId = hospital.Id
        };
        context.StaffShifts.Add(started);
        // Request logged before the shift began, still pending afterwards.
        var pending = new ShiftSwapRequest
        {
            ShiftId = started.Id,
            HospitalUserId = hospital.Id,
            RequesterUserId = requester.Id,
            ShiftDate = started.ShiftDate,
            ShiftWindow = "09:00–12:00",
            Status = ShiftSwapStatus.Pending
        };
        context.ShiftSwapRequests.Add(pending);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.DecideAsync(hospital.Id, pending.Id, new ShiftSwapDecisionDto
            {
                Approved = true,
                ReplacementAffiliationId = replacementAffiliation.Id
            }));

        Assert.Contains("already started", exception.Message, StringComparison.OrdinalIgnoreCase);
        var unchanged = await context.StaffShifts.SingleAsync(s => s.Id == started.Id);
        Assert.Equal(requesterAffiliation.Id, unchanged.AffiliationId);
    }

    [Fact]
    public async Task ListForHospitalAsync_never_waits_on_the_ai_agent()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, request, _, _) = await SeedPendingRequestWithTwoReplacementsAsync(context);
        var gateway = new RankingGateway(reverse: true);
        var service = new ShiftSwapService(context, gateway, NullLogger<ShiftSwapService>.Instance);

        var list = await service.ListForHospitalAsync(hospital.Id);

        Assert.Equal(0, gateway.Calls);
        var dto = Assert.Single(list, r => r.Id == request.Id);
        Assert.Equal(2, dto.Suggestions.Count);
        Assert.False(dto.AiRanked);
    }

    [Fact]
    public async Task RankWithAgentAsync_applies_ai_order_on_demand()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, request, first, second) = await SeedPendingRequestWithTwoReplacementsAsync(context);
        var gateway = new RankingGateway(reverse: true);
        var service = new ShiftSwapService(context, gateway, NullLogger<ShiftSwapService>.Instance);
        var rosterOrder = (await service.ListForHospitalAsync(hospital.Id))
            .Single(r => r.Id == request.Id)
            .Suggestions.Select(s => s.AffiliationId)
            .ToList();

        var ranked = await service.RankWithAgentAsync(hospital.Id, request.Id, "token");

        Assert.Equal(1, gateway.Calls);
        Assert.True(ranked.AiRanked);
        Assert.Equal(rosterOrder.AsEnumerable().Reverse(), ranked.Suggestions.Select(s => s.AffiliationId));
        Assert.Contains(ranked.Suggestions, s => s.Why == "AI pick");
        Assert.Contains(first.Id, rosterOrder);
        Assert.Contains(second.Id, rosterOrder);
    }

    private static async Task<(User Hospital, ShiftSwapRequest Request, StaffAffiliation First, StaffAffiliation Second)>
        SeedPendingRequestWithTwoReplacementsAsync(Vaxora.Api.Data.ApplicationDbContext context)
    {
        var hospital = TestDb.AddHospital(context);
        var requester = TestDb.AddDoctor(context, "requester@example.com", "VAX-D-2030");
        var first = TestDb.AddActiveAffiliation(context, hospital, TestDb.AddDoctor(context, "a@example.com", "VAX-D-2031"));
        var second = TestDb.AddActiveAffiliation(context, hospital, TestDb.AddDoctor(context, "b@example.com", "VAX-D-2032"));
        var requesterAffiliation = TestDb.AddActiveAffiliation(context, hospital, requester);
        var shift = TestDb.AddFutureShift(context, requesterAffiliation, hospital, daysAhead: 5);
        var request = new ShiftSwapRequest
        {
            ShiftId = shift.Id,
            HospitalUserId = hospital.Id,
            RequesterUserId = requester.Id,
            ShiftDate = shift.ShiftDate,
            ShiftWindow = "09:00–12:00",
            Status = ShiftSwapStatus.Pending
        };
        context.ShiftSwapRequests.Add(request);
        await context.SaveChangesAsync();
        return (hospital, request, first, second);
    }

    [Theory]
    [InlineData("this is not json at all")]
    [InlineData("{\"reviews\": \"oops\"}")]
    [InlineData("{\"content\": \"{ broken json \"}")]
    public async Task RankWithAgentAsync_falls_back_to_roster_order_on_malformed_ai_output(string agentJson)
    {
        await using var context = TestDb.CreateContext();
        var (hospital, request, _, _) = await SeedPendingRequestWithTwoReplacementsAsync(context);
        var rosterService = CreateService(context);
        var rosterOrder = (await rosterService.ListForHospitalAsync(hospital.Id))
            .Single(r => r.Id == request.Id)
            .Suggestions.Select(s => s.AffiliationId)
            .ToList();
        var service = new ShiftSwapService(context, new CannedGateway(agentJson), NullLogger<ShiftSwapService>.Instance);

        var ranked = await service.RankWithAgentAsync(hospital.Id, request.Id, "token");

        Assert.False(ranked.AiRanked);
        Assert.Equal(rosterOrder, ranked.Suggestions.Select(s => s.AffiliationId));
    }

    [Fact]
    public async Task RankWithAgentAsync_ignores_staff_the_ai_invents()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, request, first, _) = await SeedPendingRequestWithTwoReplacementsAsync(context);
        var invented = Guid.NewGuid();
        var content = System.Text.Json.JsonSerializer.Serialize(new
        {
            reviews = new[]
            {
                new
                {
                    requestId = request.Id,
                    summary = "Ranked",
                    ranked = new[]
                    {
                        new { affiliationId = invented, why = "Not on the roster" },
                        new { affiliationId = first.Id, why = "Free all day" }
                    }
                }
            }
        });
        var agentJson = System.Text.Json.JsonSerializer.Serialize(new { content });
        var service = new ShiftSwapService(context, new CannedGateway(agentJson), NullLogger<ShiftSwapService>.Instance);

        var ranked = await service.RankWithAgentAsync(hospital.Id, request.Id, "token");

        Assert.True(ranked.AiRanked);
        Assert.DoesNotContain(ranked.Suggestions, s => s.AffiliationId == invented);
        Assert.Equal(first.Id, ranked.Suggestions[0].AffiliationId);
        Assert.Equal(2, ranked.Suggestions.Count);
    }

    /// <summary>Agent fake that always returns the same raw JSON.</summary>
    private sealed class CannedGateway : IAgentGatewayService
    {
        private readonly string _json;

        public CannedGateway(string json) => _json = json;

        public Task<AgentGatewayResult> ChatAsync(
            AgentChatRequestDto request,
            string? bearerToken,
            IReadOnlyCollection<string>? allowedAgents = null,
            CancellationToken ct = default) =>
            Task.FromResult(AgentGatewayResult.Ok(_json));

        public Task<AgentGatewayResult> PatientCarePlanAsync(Guid patientProfileId, string? bearerToken, CancellationToken ct = default) =>
            Task.FromResult(AgentGatewayResult.Ok("{}"));

        public Task<AgentHealthDto> HealthAsync(CancellationToken ct = default) =>
            Task.FromResult(new AgentHealthDto { Online = true, Agents = new List<string>() });
    }

    /// <summary>Agent fake that ranks the given candidates in reverse order and counts calls.</summary>
    private sealed class RankingGateway : IAgentGatewayService
    {
        private readonly bool _reverse;
        public int Calls { get; private set; }

        public RankingGateway(bool reverse) => _reverse = reverse;

        public Task<AgentGatewayResult> ChatAsync(
            AgentChatRequestDto request,
            string? bearerToken,
            IReadOnlyCollection<string>? allowedAgents = null,
            CancellationToken ct = default)
        {
            Calls++;
            var body = request.Messages[0].Content["RANK_COVER_REPLACEMENTS\n".Length..];
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            var reviews = doc.RootElement.GetProperty("requests").EnumerateArray().Select(r =>
            {
                var ids = r.GetProperty("candidates").EnumerateArray()
                    .Select(c => c.GetProperty("affiliationId").GetString())
                    .ToList();
                if (_reverse) ids.Reverse();
                return new
                {
                    requestId = r.GetProperty("requestId").GetString(),
                    summary = "AI reviewed",
                    ranked = ids.Select(id => new { affiliationId = id, why = "AI pick" })
                };
            }).ToList();
            var content = System.Text.Json.JsonSerializer.Serialize(new { reviews });
            var json = System.Text.Json.JsonSerializer.Serialize(new { agent = "StaffSchedulingAgent", content });
            return Task.FromResult(AgentGatewayResult.Ok(json));
        }

        public Task<AgentGatewayResult> PatientCarePlanAsync(Guid patientProfileId, string? bearerToken, CancellationToken ct = default) =>
            Task.FromResult(AgentGatewayResult.Ok("{}"));

        public Task<AgentHealthDto> HealthAsync(CancellationToken ct = default) =>
            Task.FromResult(new AgentHealthDto { Online = true, Agents = new List<string>() });
    }

    private static ShiftSwapService CreateService(Vaxora.Api.Data.ApplicationDbContext context) =>
        new(context, new FakeAgentGateway(), NullLogger<ShiftSwapService>.Instance);
}
