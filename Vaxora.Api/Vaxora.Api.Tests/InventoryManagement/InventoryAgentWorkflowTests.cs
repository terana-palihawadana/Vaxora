using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests;

public class InventoryAgentWorkflowTests
{
    [Fact]
    public async Task GetRecentAgentWorkflowsAsync_is_user_scoped_and_caps_result_count()
    {
        await using var context = TestDb.CreateContext();
        var ownerId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();

        for (var i = 0; i < 52; i++)
        {
            context.AuditLogs.Add(new AuditLog
            {
                UserId = ownerId,
                Action = "AI_PO_EXECUTED",
                Details = $"Executed AI purchase order AI-PO-{i} (workflow {Guid.NewGuid()})",
                Timestamp = DateTime.UtcNow.AddMinutes(-i)
            });
        }

        context.AuditLogs.Add(new AuditLog
        {
            UserId = otherUserId,
            Action = "AI_PO_EXECUTED",
            Details = $"Executed another user's order (workflow {Guid.NewGuid()})",
            Timestamp = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var service = new InventoryService(
            context,
            NullLogger<InventoryService>.Instance,
            new FakeEmailService());

        var results = await service.GetRecentAgentWorkflowsAsync(ownerId, limit: 500);

        Assert.Equal(50, results.Count);
        Assert.All(results, result => Assert.Contains("AI purchase order", result.Summary));
    }
}
