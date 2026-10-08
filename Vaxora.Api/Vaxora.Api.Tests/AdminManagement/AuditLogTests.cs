using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.AdminManagement;

/// <summary>
/// End-to-end audit trail tests. Each test performs an action via AuthService
/// or AdminService, then verifies the correct AuditLog entry was written.
/// </summary>
public class AuditLogTests
{
    private static IConfiguration BuildConfig() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:SecretKey"] = "VaxoraTestPlatformSecretKeyLongEnoughForHmacSha256!2026",
                ["Jwt:Issuer"] = "Vaxora.Api",
                ["Jwt:Audience"] = "Vaxora.Client",
                ["Jwt:ExpiryInMinutes"] = "60"
            })
            .Build();

    private static AuthService CreateAuth(ApplicationDbContext ctx)
    {
        var cfg = BuildConfig();
        return new AuthService(
            ctx,
            new FakePasswordHasher(),
            new TokenService(cfg),
            new FakeR2StorageService(),
            new FakeRegistrationNumberService(),
            new FakeVaccinationCardService(),
            new FakeEmailService(),
            cfg,
            NullLogger<AuthService>.Instance);
    }

    private static AdminService CreateAdmin(ApplicationDbContext ctx) =>
        new(ctx, new FakeR2StorageService(), new FakeEmailService(), NullLogger<AdminService>.Instance);

    // ============================================================
    // Login audit
    // ============================================================

    [Fact]
    public async Task Successful_login_writes_LOGIN_SUCCESS_audit()
    {
        await using var ctx = TestDb.CreateContext();
        var hasher = new FakePasswordHasher();
        var user = new User
        {
            Email = "p@example.com",
            PasswordHash = hasher.HashPassword("Test123!"),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            PatientProfile = new PatientProfile { FullName = "P", NicNumber = "999V" }
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        await CreateAuth(ctx).LoginAsync(new LoginDto
        {
            Email = "p@example.com",
            Password = "Test123!"
        });

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "LOGIN_SUCCESS");
        Assert.Equal(user.Id, log.UserId);
        Assert.Equal("PATIENT", log.Role);
    }

    [Fact]
    public async Task Failed_login_does_not_write_audit_entry()
    {
        await using var ctx = TestDb.CreateContext();
        await ctx.SaveChangesAsync();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateAuth(ctx).LoginAsync(new LoginDto
            {
                Email = "missing@example.com",
                Password = "wrong"
            }));

        Assert.Empty(await ctx.AuditLogs.ToListAsync());
    }

    // ============================================================
    // Profile / password audit
    // ============================================================

    [Fact]
    public async Task Profile_update_writes_PROFILE_UPDATED_audit()
    {
        await using var ctx = TestDb.CreateContext();
        var hasher = new FakePasswordHasher();
        var user = new User
        {
            Email = "p@example.com",
            PasswordHash = hasher.HashPassword("x"),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            PatientProfile = new PatientProfile { FullName = "Old", NicNumber = "999V" }
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        await CreateAuth(ctx).UpdateProfileAsync(user.Id, new UpdateProfileDto
        {
            FullName = "New Name",
            PhoneNumber = "0770000000"
        });

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "PROFILE_UPDATED");
        Assert.Equal(user.Id, log.UserId);
    }

    [Fact]
    public async Task Password_change_writes_PASSWORD_CHANGE_audit()
    {
        await using var ctx = TestDb.CreateContext();
        var hasher = new FakePasswordHasher();
        var user = new User
        {
            Email = "p@example.com",
            PasswordHash = hasher.HashPassword("OldPass1!"),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        await CreateAuth(ctx).ChangePasswordAsync(user.Id, new ChangePasswordDto
        {
            CurrentPassword = "OldPass1!",
            NewPassword = "NewPass2!"
        });

        Assert.Single(await ctx.AuditLogs.Where(a => a.Action == "PASSWORD_CHANGE").ToListAsync());
    }

    // ============================================================
    // Account deletion — special case: UserId nulled
    // ============================================================

    [Fact]
    public async Task Account_deletion_writes_ACCOUNT_DELETED_with_null_UserId()
    {
        await using var ctx = TestDb.CreateContext();
        var hasher = new FakePasswordHasher();
        var user = new User
        {
            Email = "p@example.com",
            PasswordHash = hasher.HashPassword("x"),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            RegistrationNumber = "VAX-P-0001",
            PatientProfile = new PatientProfile { FullName = "P", NicNumber = "999V" }
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        await CreateAuth(ctx).DeleteAccountAsync(user.Id);

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "ACCOUNT_DELETED");
        Assert.Null(log.UserId);                 // deliberately nulled
        Assert.Equal("p@example.com", log.UserEmail);  // still recorded
    }

    // ============================================================
    // Admin verification audit
    // ============================================================

    [Fact]
    public async Task Approve_verification_writes_VERIFICATION_APPROVED()
    {
        await using var ctx = TestDb.CreateContext();
        var admin = new User { Email = "a@vaxora.test", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Active };
        var target = new User
        {
            Email = "doc@example.com",
            PasswordHash = "h",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Pending,
            RegistrationNumber = "VAX-D-9001",
            DoctorProfile = new DoctorProfile
            {
                FullName = "Doc",
                SlmcNumber = "SLMC-X",
                VerificationStatus = VerificationStatus.Pending
            }
        };
        ctx.Users.AddRange(admin, target);
        await ctx.SaveChangesAsync();

        await CreateAdmin(ctx).ProcessVerificationDecisionAsync(admin.Id, target.Id,
            new VerificationDecisionDto { Decision = "Approve" });

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "VERIFICATION_APPROVED");
        Assert.Equal(admin.Id, log.UserId);
        Assert.Equal("ADMIN", log.Role);
        Assert.Contains(target.Email, log.Details);
    }

    [Fact]
    public async Task Reject_verification_writes_VERIFICATION_REJECTED_with_reason()
    {
        await using var ctx = TestDb.CreateContext();
        var admin = new User { Email = "a@vaxora.test", PasswordHash = "h", Role = UserRole.ADMIN, Status = UserStatus.Active };
        var target = new User
        {
            Email = "doc@example.com",
            PasswordHash = "h",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Pending,
            DoctorProfile = new DoctorProfile
            {
                FullName = "Doc",
                SlmcNumber = "SLMC-X",
                VerificationStatus = VerificationStatus.Pending
            }
        };
        ctx.Users.AddRange(admin, target);
        await ctx.SaveChangesAsync();

        await CreateAdmin(ctx).ProcessVerificationDecisionAsync(admin.Id, target.Id,
            new VerificationDecisionDto { Decision = "Reject", Reason = "Illegible SLMC" });

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "VERIFICATION_REJECTED");
        Assert.Contains("Illegible SLMC", log.Details);
    }

    // ============================================================
    // Audit log schema sanity
    // ============================================================

    [Fact]
    public async Task Audit_log_defaults_timestamp_and_populates_required_fields()
    {
        await using var ctx = TestDb.CreateContext();
        var before = DateTime.UtcNow.AddSeconds(-1);
        ctx.AuditLogs.Add(new AuditLog { Action = "TEST", Details = "test details" });
        await ctx.SaveChangesAsync();

        var log = await ctx.AuditLogs.SingleAsync();
        Assert.True(log.Timestamp >= before);
        Assert.NotEqual(Guid.Empty, log.Id);
        Assert.Equal("TEST", log.Action);
    }
}
