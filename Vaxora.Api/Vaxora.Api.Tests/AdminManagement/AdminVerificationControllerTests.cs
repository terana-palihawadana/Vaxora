using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Controllers;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.AdminManagement;

public class AdminVerificationControllerTests
{
    private static (AdminVerificationController controller, AdminService service, ApplicationDbContext context) Create()
    {
        var context = TestDb.CreateContext();
        var service = new AdminService(
            context,
            new FakeR2StorageService(),
            new FakeEmailService(),
            NullLogger<AdminService>.Instance);
        var controller = new AdminVerificationController(
            service,
            NullLogger<AdminVerificationController>.Instance);
        return (controller, service, context);
    }

    private static void SetAdmin(ControllerBase controller, Guid adminId)
    {
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, adminId.ToString()),
            new Claim(ClaimTypes.Role, "ADMIN"),
            new Claim(ClaimTypes.Email, "admin@vaxora.test")
        }, "TestAuth");
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
        };
    }

    private static void SetNoIdentity(ControllerBase controller)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity()) }
        };
    }

    private static User AddPendingDoctor(ApplicationDbContext context, string email = "doc@example.com")
    {
        var user = new User
        {
            Email = email,
            PasswordHash = "hash",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Pending,
            RegistrationNumber = "VAX-D-9001",
            DoctorProfile = new DoctorProfile
            {
                FullName = "Test Doctor",
                SlmcNumber = $"SLMC-{Guid.NewGuid():N}"[..12],
                VerificationStatus = VerificationStatus.Pending
            }
        };
        context.Users.Add(user);
        return user;
    }

    // ============================================================
    // Reflection — verify endpoint intent
    // ============================================================

    [Fact]
    public void Controller_requires_Admin_role()
    {
        var attr = typeof(AdminVerificationController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .FirstOrDefault();
        Assert.NotNull(attr);
        Assert.Equal("ADMIN", attr!.Roles);
    }

    // ============================================================
    // Dashboard stats
    // ============================================================

    [Fact]
    public async Task GetDashboardStats_returns_200_with_stats()
    {
        var (controller, _, _) = Create();
        SetAdmin(controller, Guid.NewGuid());

        var result = await controller.GetDashboardStats();

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.IsType<AdminDashboardStatsDto>(ok.Value);
    }

    // ============================================================
    // Pending verifications
    // ============================================================

    [Fact]
    public async Task GetPendingVerifications_returns_only_pending_non_admin()
    {
        var (controller, _, context) = Create();
        AddPendingDoctor(context, "p1@example.com");
        AddPendingDoctor(context, "p2@example.com");

        var active = new User
        {
            Email = "active@example.com",
            PasswordHash = "h",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Active,
            DoctorProfile = new DoctorProfile
            {
                FullName = "Active Doc",
                SlmcNumber = "SLMC-A",
                VerificationStatus = VerificationStatus.Approved
            }
        };
        context.Users.Add(active);
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.GetPendingVerifications();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsAssignableFrom<List<PendingVerificationUserDto>>(ok.Value);
        Assert.Equal(2, list.Count);
    }

    // ============================================================
    // Process decision — approve
    // ============================================================

    [Fact]
    public async Task ProcessDecision_approve_activates_user()
    {
        var (controller, _, context) = Create();
        var target = AddPendingDoctor(context);
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.ProcessDecision(target.Id,
            new VerificationDecisionDto { Decision = "Approve" });

        Assert.IsType<OkObjectResult>(result);
        var refreshed = await context.Users.FindAsync(target.Id);
        Assert.Equal(UserStatus.Active, refreshed!.Status);
        Assert.Equal(VerificationStatus.Approved, refreshed.DoctorProfile!.VerificationStatus);
    }

    [Fact]
    public async Task ProcessDecision_reject_deletes_user()
    {
        var (controller, _, context) = Create();
        var target = AddPendingDoctor(context);
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.ProcessDecision(target.Id,
            new VerificationDecisionDto { Decision = "Reject", Reason = "Invalid SLMC" });

        Assert.IsType<OkObjectResult>(result);
        var after = await context.Users.FindAsync(target.Id);
        Assert.Null(after);
    }

    [Fact]
    public async Task ProcessDecision_returns_404_when_user_unknown()
    {
        var (controller, _, _) = Create();
        SetAdmin(controller, Guid.NewGuid());

        var result = await controller.ProcessDecision(Guid.NewGuid(),
            new VerificationDecisionDto { Decision = "Approve" });

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        Assert.Equal(StatusCodes.Status404NotFound, notFound.StatusCode);
    }

    [Fact]
    public async Task ProcessDecision_returns_401_when_no_identity()
    {
        var (controller, _, _) = Create();
        SetNoIdentity(controller);

        var result = await controller.ProcessDecision(Guid.NewGuid(),
            new VerificationDecisionDto { Decision = "Approve" });

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    // ============================================================
    // Update status
    // ============================================================

    [Fact]
    public async Task UpdateStatus_activates_pending_user()
    {
        var (controller, _, context) = Create();
        var target = AddPendingDoctor(context);
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.UpdateStatus(target.Id,
            new UserStatusUpdateDto { Status = "Active" });

        Assert.IsType<OkObjectResult>(result);
        var refreshed = await context.Users.FindAsync(target.Id);
        Assert.Equal(UserStatus.Active, refreshed!.Status);
    }

    [Fact]
    public async Task UpdateStatus_suspends_active_user()
    {
        var (controller, _, context) = Create();
        var target = AddPendingDoctor(context);
        target.Status = UserStatus.Active;
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.UpdateStatus(target.Id,
            new UserStatusUpdateDto { Status = "Suspended" });

        Assert.IsType<OkObjectResult>(result);
        var refreshed = await context.Users.FindAsync(target.Id);
        Assert.Equal(UserStatus.Suspended, refreshed!.Status);
    }

    [Fact]
    public async Task UpdateStatus_returns_400_when_modifying_admin()
    {
        var (controller, _, context) = Create();
        var admin = new User
        {
            Email = "other-admin@vaxora.test",
            PasswordHash = "h",
            Role = UserRole.ADMIN,
            Status = UserStatus.Active
        };
        context.Users.Add(admin);
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.UpdateStatus(admin.Id,
            new UserStatusUpdateDto { Status = "Suspended" });

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task UpdateStatus_returns_404_when_user_unknown()
    {
        var (controller, _, _) = Create();
        SetAdmin(controller, Guid.NewGuid());

        var result = await controller.UpdateStatus(Guid.NewGuid(),
            new UserStatusUpdateDto { Status = "Active" });

        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ============================================================
    // Audit logs
    // ============================================================

    [Fact]
    public async Task GetAuditLogs_respects_limit()
    {
        var (controller, _, context) = Create();
        for (var i = 0; i < 10; i++)
        {
            context.AuditLogs.Add(new AuditLog
            {
                Action = "TEST",
                Details = $"entry {i}",
                Timestamp = DateTime.UtcNow.AddSeconds(-i)
            });
        }
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.GetAuditLogs(limit: 3);

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsAssignableFrom<List<AuditLog>>(ok.Value);
        Assert.Equal(3, list.Count);
    }

    [Fact]
    public async Task GetAuditLogs_returns_newest_first()
    {
        var (controller, _, context) = Create();
        context.AuditLogs.Add(new AuditLog { Action = "OLD", Details = "old", Timestamp = DateTime.UtcNow.AddHours(-1) });
        context.AuditLogs.Add(new AuditLog { Action = "NEW", Details = "new", Timestamp = DateTime.UtcNow });
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.GetAuditLogs();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsAssignableFrom<List<AuditLog>>(ok.Value);
        Assert.Equal("NEW", list[0].Action);
    }

    // ============================================================
    // Users directory
    // ============================================================

    [Fact]
    public async Task GetAllUsers_filters_by_role()
    {
        var (controller, _, context) = Create();
        AddPendingDoctor(context, "d1@example.com");
        context.Users.Add(new User
        {
            Email = "p1@example.com",
            PasswordHash = "h",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            PatientProfile = new PatientProfile { FullName = "P", NicNumber = "999V" }
        });
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.GetAllUsers(role: "DOCTOR", status: null, search: null);

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsAssignableFrom<List<AdminUserItemDto>>(ok.Value);
        Assert.Single(list);
        Assert.Equal("doctor", list[0].Role);
    }

    [Fact]
    public async Task GetAllUsers_search_filters_by_email()
    {
        var (controller, _, context) = Create();
        AddPendingDoctor(context, "match@example.com");
        AddPendingDoctor(context, "other@example.com");
        await context.SaveChangesAsync();

        SetAdmin(controller, Guid.NewGuid());
        var result = await controller.GetAllUsers(role: null, status: null, search: "match");

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsAssignableFrom<List<AdminUserItemDto>>(ok.Value);
        Assert.Single(list);
    }
}
