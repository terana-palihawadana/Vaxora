using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Models;

namespace Vaxora.Api.Tests.StaffManagement;

/// <summary>
/// Staff Management — real PostgreSQL CRUD for affiliations, shifts, swaps, agent workflows.
/// </summary>
[Collection("PostgreSql")]
public class PostgreSqlIntegrationTests
{
    private readonly PostgreSqlFixture _postgres;

    public PostgreSqlIntegrationTests(PostgreSqlFixture postgres)
    {
        _postgres = postgres;
    }

    private static string GetRequiredPostgreSqlConnectionString()
    {
        var conn = Environment.GetEnvironmentVariable("TEST_POSTGRESQL_CONNECTION")
            ?? Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
            ?? Environment.GetEnvironmentVariable("DATABASE_URL");

        if (!string.IsNullOrWhiteSpace(conn))
            return conn;

        var searchRoots = new[]
        {
            Directory.GetCurrentDirectory(),
            AppDomain.CurrentDomain.BaseDirectory
        };

        foreach (var root in searchRoots)
        {
            var dir = new DirectoryInfo(root);
            while (dir != null)
            {
                foreach (var candidate in new[]
                         {
                             Path.Combine(dir.FullName, "Vaxora.Api", ".env"),
                             Path.Combine(dir.FullName, ".env")
                         })
                {
                    if (!File.Exists(candidate)) continue;
                    foreach (var line in File.ReadAllLines(candidate))
                    {
                        var trimmed = line.Trim();
                        if (!trimmed.StartsWith("ConnectionStrings__DefaultConnection=", StringComparison.OrdinalIgnoreCase))
                            continue;
                        var val = trimmed.Split('=', 2)[1].Trim().Trim('"').Trim('\'');
                        if (!string.IsNullOrWhiteSpace(val)) return val;
                    }
                }

                dir = dir.Parent;
            }
        }

        Assert.Fail("PostgreSQL connection string was not found. Real PostgreSQL is required for this staff integration test.");
        return string.Empty;
    }

    [Fact]
    public void Schema_safety_sql_survives_ef_raw_sql_formatting()
    {
        // ExecuteSqlRaw runs string.Format over the SQL; unescaped JSON braces used to throw
        // and silently skip every safety column on startup.
        var formatted = string.Format(DbInitializer.SchemaSafetySql, Array.Empty<object>());

        Assert.Contains("DEFAULT '{}'", formatted);
        Assert.Contains("\"CheckedInAt\"", formatted);
    }

    [Fact]
    public async Task PostgreSql_schema_safety_sql_runs_on_a_migrated_database()
    {
        var connectionString = GetRequiredPostgreSqlConnectionString();
        _postgres.EnsureMigrated(connectionString);
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        await using var context = new ApplicationDbContext(options);

        // Same call DbInitializer makes on every API start; it must not throw.
        await context.Database.ExecuteSqlRawAsync(DbInitializer.SchemaSafetySql);

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT column_default FROM information_schema.columns
                            WHERE table_name = 'AgentWorkflows' AND column_name = 'PlanJson'";
        var columnDefault = (string?)await cmd.ExecuteScalarAsync();
        Assert.NotNull(columnDefault);
    }

    [Fact]
    public async Task PostgreSql_staff_affiliation_shift_and_swap_crud()
    {
        var connectionString = GetRequiredPostgreSqlConnectionString();

        await using (var probe = new NpgsqlConnection(connectionString))
        {
            try { await probe.OpenAsync(); }
            catch (Exception ex)
            {
                Assert.Fail($"PostgreSQL unavailable: {ex.Message}");
            }
        }

        // CI Postgres starts empty; migrate before touching staff/swap tables.
        _postgres.EnsureMigrated(connectionString);

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        var hospitalId = Guid.NewGuid();
        var doctorId = Guid.NewGuid();
        var affiliationId = Guid.NewGuid();
        var shiftId = Guid.NewGuid();
        var swapId = Guid.NewGuid();
        var shiftDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(6));

        try
        {
            await using (var context = new ApplicationDbContext(options))
            {
                context.Users.Add(new User
                {
                    Id = hospitalId,
                    Email = $"pg.staff.h.{hospitalId:N}@vaxora.lk",
                    PasswordHash = "hash",
                    Role = UserRole.HOSPITAL,
                    Status = UserStatus.Active,
                    RegistrationNumber = $"VAX-H-{hospitalId.ToString("N")[..4]}",
                    HospitalProfile = new HospitalProfile
                    {
                        HospitalName = "PG Staff Hospital",
                        RegistrationNumber = $"HP-{hospitalId.ToString("N")[..8]}"
                    }
                });
                context.Users.Add(new User
                {
                    Id = doctorId,
                    Email = $"pg.staff.d.{doctorId:N}@vaxora.lk",
                    PasswordHash = "hash",
                    Role = UserRole.DOCTOR,
                    Status = UserStatus.Active,
                    RegistrationNumber = $"VAX-D-{doctorId.ToString("N")[..4]}",
                    DoctorProfile = new DoctorProfile
                    {
                        FullName = "PG Staff Doctor",
                        SlmcNumber = $"SL-{doctorId.ToString("N")[..8]}",
                        VerificationStatus = VerificationStatus.Approved
                    }
                });
                await context.SaveChangesAsync();

                context.StaffAffiliations.Add(new StaffAffiliation
                {
                    Id = affiliationId,
                    HospitalUserId = hospitalId,
                    StaffUserId = doctorId,
                    StaffRole = UserRole.DOCTOR,
                    Status = AffiliationStatus.Active,
                    InvitedByUserId = hospitalId,
                    RespondedAt = DateTime.UtcNow
                });
                await context.SaveChangesAsync();

                context.StaffShifts.Add(new StaffShift
                {
                    Id = shiftId,
                    AffiliationId = affiliationId,
                    ShiftDate = shiftDate,
                    StartTime = new TimeOnly(10, 0),
                    EndTime = new TimeOnly(14, 0),
                    BoothOrStation = "Booth PG",
                    CreatedByUserId = hospitalId
                });
                await context.SaveChangesAsync();

                context.ShiftSwapRequests.Add(new ShiftSwapRequest
                {
                    Id = swapId,
                    ShiftId = shiftId,
                    HospitalUserId = hospitalId,
                    RequesterUserId = doctorId,
                    ShiftDate = shiftDate,
                    ShiftWindow = "10:00-14:00",
                    BoothOrStation = "Booth PG",
                    Reason = "PG integration test",
                    Status = ShiftSwapStatus.Pending
                });
                await context.SaveChangesAsync();
            }

            await using (var verify = new ApplicationDbContext(options))
            {
                var affiliation = await verify.StaffAffiliations
                    .Include(a => a.Shifts)
                    .SingleAsync(a => a.Id == affiliationId);
                Assert.Equal(AffiliationStatus.Active, affiliation.Status);
                Assert.Contains(affiliation.Shifts, s => s.Id == shiftId);

                var swap = await verify.ShiftSwapRequests.SingleAsync(s => s.Id == swapId);
                Assert.Equal(ShiftSwapStatus.Pending, swap.Status);
                Assert.Equal(shiftId, swap.ShiftId);
                Assert.Equal(hospitalId, swap.HospitalUserId);
            }
        }
        finally
        {
            await using var cleanup = new ApplicationDbContext(options);
            var swap = await cleanup.ShiftSwapRequests.FindAsync(swapId);
            if (swap != null) cleanup.ShiftSwapRequests.Remove(swap);

            var shift = await cleanup.StaffShifts.FindAsync(shiftId);
            if (shift != null) cleanup.StaffShifts.Remove(shift);

            var affiliation = await cleanup.StaffAffiliations.FindAsync(affiliationId);
            if (affiliation != null) cleanup.StaffAffiliations.Remove(affiliation);

            var doctor = await cleanup.Users.Include(u => u.DoctorProfile).FirstOrDefaultAsync(u => u.Id == doctorId);
            if (doctor != null) cleanup.Users.Remove(doctor);

            var hospital = await cleanup.Users.Include(u => u.HospitalProfile).FirstOrDefaultAsync(u => u.Id == hospitalId);
            if (hospital != null) cleanup.Users.Remove(hospital);

            await cleanup.SaveChangesAsync();
        }
    }
}
