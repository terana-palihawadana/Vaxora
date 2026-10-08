using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.AdminManagement;

public class AdminServiceTests
{
    private static AdminService Create(ApplicationDbContext context) =>
        new(context, new FakeR2StorageService(), new FakeEmailService(), NullLogger<AdminService>.Instance);

    private static User AddPendingDoctor(ApplicationDbContext ctx, string email = "doc@example.com")
    {
        var u = new User
        {
            Email = email,
            PasswordHash = "h",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Pending,
            RegistrationNumber = "VAX-D-9001",
            DoctorProfile = new DoctorProfile
            {
                FullName = "Doc",
                SlmcNumber = $"SLMC-{Guid.NewGuid():N}"[..10],
                VerificationStatus = VerificationStatus.Pending
            }
        };
        ctx.Users.Add(u);
        return u;
    }

    // ============================================================
    // GetPendingVerificationsAsync
    // ============================================================

    [Fact]
    public async Task GetPendingVerifications_excludes_patients_and_admins()
    {
        await using var ctx = TestDb.CreateContext();
        AddPendingDoctor(ctx, "d@example.com");
        ctx.Users.Add(new User { Email = "p@example.com", PasswordHash = "h", Role = UserRole.PATIENT, Status = UserStatus.Pending });
        ctx.Users.Add(new User { Email = "a@example.com", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Pending });
        await ctx.SaveChangesAsync();

        var result = await Create(ctx).GetPendingVerificationsAsync();

        Assert.Single(result);
        Assert.Equal("DOCTOR", result[0].Role);
    }

    [Fact]
    public async Task GetPendingVerifications_excludes_active_users()
    {
        await using var ctx = TestDb.CreateContext();
        var active = AddPendingDoctor(ctx, "active@example.com");
        active.Status = UserStatus.Active;
        AddPendingDoctor(ctx, "pending@example.com");
        await ctx.SaveChangesAsync();

        var result = await Create(ctx).GetPendingVerificationsAsync();

        Assert.Single(result);
        Assert.Equal("pending@example.com", result[0].Email);
    }

    // ============================================================
    // ProcessVerificationDecisionAsync
    // ============================================================

    [Fact]
    public async Task Approve_sets_status_active_and_writes_audit_log()
    {
        await using var ctx = TestDb.CreateContext();
        var admin = new User { Email = "admin@vaxora.test", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Active };
        var target = AddPendingDoctor(ctx);
        ctx.Users.Add(admin);
        await ctx.SaveChangesAsync();

        await Create(ctx).ProcessVerificationDecisionAsync(admin.Id, target.Id,
            new VerificationDecisionDto { Decision = "Approve" });

        var refreshed = await ctx.Users.FindAsync(target.Id);
        Assert.Equal(UserStatus.Active, refreshed!.Status);

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "VERIFICATION_APPROVED");
        Assert.Equal(admin.Id, log.UserId);
    }

    [Fact]
    public async Task Reject_deletes_user_and_writes_audit_log()
    {
        await using var ctx = TestDb.CreateContext();
        var admin = new User { Email = "admin@vaxora.test", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Active };
        var target = AddPendingDoctor(ctx);
        ctx.Users.Add(admin);
        await ctx.SaveChangesAsync();

        await Create(ctx).ProcessVerificationDecisionAsync(admin.Id, target.Id,
            new VerificationDecisionDto { Decision = "Reject", Reason = "Bad docs" });

        Assert.Null(await ctx.Users.FindAsync(target.Id));
        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "VERIFICATION_REJECTED");
        Assert.Contains("Bad docs", log.Details);
    }

    [Fact]
    public async Task ProcessDecision_throws_KeyNotFound_for_unknown_user()
    {
        await using var ctx = TestDb.CreateContext();
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            Create(ctx).ProcessVerificationDecisionAsync(
                Guid.NewGuid(), Guid.NewGuid(),
                new VerificationDecisionDto { Decision = "Approve" }));
    }

    // ============================================================
    // UpdateUserStatusAsync
    // ============================================================

    [Fact]
    public async Task UpdateUserStatus_blocks_admin_target()
    {
        await using var ctx = TestDb.CreateContext();
        var adminTarget = new User { Email = "a@vaxora.test", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Active };
        ctx.Users.Add(adminTarget);
        await ctx.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Create(ctx).UpdateUserStatusAsync(Guid.NewGuid(), adminTarget.Id,
                new UserStatusUpdateDto { Status = "Suspended" }));
    }

    [Fact]
    public async Task UpdateUserStatus_writes_audit_entry()
    {
        await using var ctx = TestDb.CreateContext();
        var admin = new User { Email = "admin@vaxora.test", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Active };
        var target = AddPendingDoctor(ctx);
        ctx.Users.Add(admin);
        await ctx.SaveChangesAsync();

        await Create(ctx).UpdateUserStatusAsync(admin.Id, target.Id,
            new UserStatusUpdateDto { Status = "Suspended" });

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "USER_STATUS_UPDATE");
        Assert.Contains("Suspended", log.Details);
    }

    // ============================================================
    // GetAuditLogsAsync
    // ============================================================

    [Fact]
    public async Task GetAuditLogs_returns_newest_first_with_limit()
    {
        await using var ctx = TestDb.CreateContext();
        for (var i = 0; i < 5; i++)
        {
            ctx.AuditLogs.Add(new AuditLog
            {
                Action = "X",
                Details = "y",
                Timestamp = DateTime.UtcNow.AddMinutes(-i)
            });
        }
        await ctx.SaveChangesAsync();

        var list = await Create(ctx).GetAuditLogsAsync(limit: 3);
        Assert.Equal(3, list.Count);
        Assert.True(list[0].Timestamp >= list[1].Timestamp);
    }

    // ============================================================
    // GetAllUsersAsync
    // ============================================================

    [Fact]
    public async Task GetAllUsers_filters_by_status()
    {
        await using var ctx = TestDb.CreateContext();
        AddPendingDoctor(ctx, "pending@example.com");
        var active = AddPendingDoctor(ctx, "active@example.com");
        active.Status = UserStatus.Active;
        await ctx.SaveChangesAsync();

        var result = await Create(ctx).GetAllUsersAsync(status: "Active");

        Assert.Single(result);
        Assert.Equal("active@example.com", result[0].Email);
    }

    // ============================================================
    // GetDashboardStatsAsync
    // ============================================================

    [Fact]
    public async Task GetDashboardStats_counts_users_by_role()
    {
        await using var ctx = TestDb.CreateContext();
        AddPendingDoctor(ctx, "d1@example.com");
        AddPendingDoctor(ctx, "d2@example.com");
        ctx.Users.Add(new User { Email = "p1@example.com", PasswordHash = "h", Role = UserRole.PATIENT, Status = UserStatus.Active });
        await ctx.SaveChangesAsync();

        var stats = await Create(ctx).GetDashboardStatsAsync();

        Assert.Equal(3, stats.UsersCount.Total);
        Assert.Equal(2, stats.UsersCount.Doctors);
        Assert.Equal(1, stats.UsersCount.Patients);
    }

    [Fact]
    public async Task GetDashboardStats_counts_pending_verifications()
    {
        await using var ctx = TestDb.CreateContext();
        AddPendingDoctor(ctx, "p1@example.com");
        AddPendingDoctor(ctx, "p2@example.com");
        var active = AddPendingDoctor(ctx, "a@example.com");
        active.Status = UserStatus.Active;
        await ctx.SaveChangesAsync();

        var stats = await Create(ctx).GetDashboardStatsAsync();
        Assert.Equal(2, stats.PendingVerificationsCount);
    }
}
