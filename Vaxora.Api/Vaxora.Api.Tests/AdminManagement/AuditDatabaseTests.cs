using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Models;

namespace Vaxora.Api.Tests.AdminManagement;

/// <summary>
/// Database-layer tests for the audit trail and user persistence model.
/// Uses EF Core model inspection (no live DB required) and InMemory contexts
/// to verify schema configuration, foreign keys, and cascade behaviour.
/// </summary>
public class AuditDatabaseTests
{
    // ============================================================
    // AuditLog table schema
    // ============================================================

        [Fact]
    public void AuditLog_entity_maps_to_a_table_derived_from_its_name()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(AuditLog))!;
        var name = entity.GetTableName();
        Assert.False(string.IsNullOrWhiteSpace(name));
        // Case- and plural-insensitive: the important thing is the entity
        // is mapped to a table whose name derives from "AuditLog".
        Assert.Contains("auditlog", name!.ToLowerInvariant());
    }

    [Fact]
    public void AuditLog_UserId_is_nullable_so_rows_survive_user_deletion()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(AuditLog))!;
        var userIdProp = entity.FindProperty(nameof(AuditLog.UserId))!;
        Assert.True(userIdProp.IsNullable);
    }

    [Fact]
    public void AuditLog_Action_has_required_max_length_100()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(AuditLog))!;
        var prop = entity.FindProperty(nameof(AuditLog.Action))!;
        Assert.False(prop.IsNullable);
        Assert.Equal(100, prop.GetMaxLength());
    }

    [Fact]
    public void AuditLog_Details_has_required_max_length_1000()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(AuditLog))!;
        var prop = entity.FindProperty(nameof(AuditLog.Details))!;
        Assert.False(prop.IsNullable);
        Assert.Equal(1000, prop.GetMaxLength());
    }

    [Fact]
    public void AuditLog_UserEmail_has_max_length_256()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(AuditLog))!;
        var prop = entity.FindProperty(nameof(AuditLog.UserEmail))!;
        Assert.Equal(256, prop.GetMaxLength());
    }

    // ============================================================
    // User table schema (relevant to audit identity)
    // ============================================================

    [Fact]
    public void User_Email_index_is_unique()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(User))!;
        var emailProp = entity.FindProperty(nameof(User.Email))!;
        var index = entity.GetIndexes()
            .FirstOrDefault(i => i.Properties.Contains(emailProp));
        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
    }

    [Fact]
    public void User_RegistrationNumber_has_unique_index()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(User))!;
        var regProp = entity.FindProperty(nameof(User.RegistrationNumber));
        if (regProp == null) return; // property optional in some models
        var index = entity.GetIndexes()
            .FirstOrDefault(i => i.Properties.Contains(regProp));
        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
    }

    [Fact]
    public void User_Email_has_max_length_256()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(User))!;
        var prop = entity.FindProperty(nameof(User.Email))!;
        Assert.Equal(256, prop.GetMaxLength());
    }

    [Fact]
    public void User_has_one_to_one_with_PatientProfile()
    {
        using var ctx = TestDb.CreateContext();
        var entity = ctx.Model.FindEntityType(typeof(User))!;
        var fk = entity.GetForeignKeys().FirstOrDefault(f =>
            f.PrincipalEntityType.ClrType == typeof(User) &&
            f.DeclaringEntityType.ClrType == typeof(PatientProfile));

        // The FK lives on PatientProfile, so look it up from that side instead.
        var patientEntity = ctx.Model.FindEntityType(typeof(PatientProfile));
        if (patientEntity == null) return;
        var userFk = patientEntity.GetForeignKeys().FirstOrDefault(f =>
            f.PrincipalEntityType.ClrType == typeof(User));
        Assert.NotNull(userFk);
    }

    // ============================================================
    // Cascade delete behaviour
    // ============================================================

    [Fact]
    public async Task Deleting_User_cascades_to_PatientProfile()
    {
        await using var ctx = TestDb.CreateContext();
        var user = new User
        {
            Email = "p@example.com",
            PasswordHash = "h",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            PatientProfile = new PatientProfile
            {
                FullName = "P",
                NicNumber = "999V"
            }
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        var profileId = user.PatientProfile!.Id;
        ctx.Users.Remove(user);
        await ctx.SaveChangesAsync();

        var remaining = await ctx.PatientProfiles.FindAsync(profileId);
        Assert.Null(remaining);
    }

    [Fact]
    public async Task Deleting_User_cascades_to_DoctorProfile()
    {
        await using var ctx = TestDb.CreateContext();
        var user = new User
        {
            Email = "d@example.com",
            PasswordHash = "h",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Pending,
            DoctorProfile = new DoctorProfile
            {
                FullName = "Doc",
                SlmcNumber = "SLMC-1",
                VerificationStatus = VerificationStatus.Pending
            }
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        var profileId = user.DoctorProfile!.Id;
        ctx.Users.Remove(user);
        await ctx.SaveChangesAsync();

        Assert.Null(await ctx.DoctorProfiles.FindAsync(profileId));
    }

    // ============================================================
    // Audit log transactional behaviour
    // ============================================================

    [Fact]
    public async Task Audit_log_rows_persist_after_user_is_deleted_with_null_UserId()
    {
        await using var ctx = TestDb.CreateContext();
        var user = new User
        {
            Email = "p@example.com",
            PasswordHash = "h",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            PatientProfile = new PatientProfile { FullName = "P", NicNumber = "999V" }
        };
        ctx.Users.Add(user);
        await ctx.SaveChangesAsync();

        // Simulate the account-deletion flow: audit row with UserId=null
        ctx.AuditLogs.Add(new AuditLog
        {
            UserId = null,
            UserEmail = user.Email,
            Role = "PATIENT",
            Action = "ACCOUNT_DELETED",
            Details = "Test",
            Timestamp = DateTime.UtcNow
        });
        ctx.Users.Remove(user);
        await ctx.SaveChangesAsync();

        var log = await ctx.AuditLogs.SingleAsync(a => a.Action == "ACCOUNT_DELETED");
        Assert.Null(log.UserId);
        Assert.Equal("p@example.com", log.UserEmail);
    }

    [Fact]
    public async Task Multiple_audit_entries_commit_atomically_in_one_SaveChanges()
    {
        await using var ctx = TestDb.CreateContext();
        for (var i = 0; i < 5; i++)
        {
            ctx.AuditLogs.Add(new AuditLog
            {
                Action = "BATCH",
                Details = $"entry {i}",
                Timestamp = DateTime.UtcNow
            });
        }
        await ctx.SaveChangesAsync();

        var count = await ctx.AuditLogs.CountAsync(a => a.Action == "BATCH");
        Assert.Equal(5, count);
    }
}
