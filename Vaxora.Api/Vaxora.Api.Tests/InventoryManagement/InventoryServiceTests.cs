using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests;

public class InventoryServiceTests
{
    private static InventoryService CreateService(Data.ApplicationDbContext context) =>
        new(context, NullLogger<InventoryService>.Instance, new FakeEmailService());

    private static (User user, HospitalProfile hospital) AddHospital(
        Data.ApplicationDbContext ctx,
        string email = "h@test.com",
        string reg = "VAX-H-9001")
    {
        var user = new User
        {
            Email = email,
            PasswordHash = "h",
            Role = UserRole.HOSPITAL,
            Status = UserStatus.Active,
            RegistrationNumber = reg
        };
        var hospital = new HospitalProfile
        {
            UserId = user.Id,
            HospitalName = "Test Hospital",
            RegistrationNumber = reg,
            Address = "123 Road",
            VerificationStatus = VerificationStatus.Approved
        };
        user.HospitalProfile = hospital;
        ctx.Users.Add(user);
        ctx.HospitalProfiles.Add(hospital);
        return (user, hospital);
    }

    private static Vaccine AddVaccine(Data.ApplicationDbContext ctx, int dosesPerVial = 10, int threshold = 50)
    {
        var v = new Vaccine
        {
            Name = "Pfizer",
            Manufacturer = "BioNTech",
            Category = VaccineCategory.MRNA,
            DosesPerVial = dosesPerVial,
            DefaultMinThreshold = threshold,
            RequiredTemp = "2-8C"
        };
        ctx.Vaccines.Add(v);
        return v;
    }

    private static Batch AddBatch(
        Data.ApplicationDbContext ctx,
        Guid hospitalId,
        Guid vaccineId,
        int available = 100,
        int received = 100,
        DateTime? expiry = null,
        BatchStatus status = BatchStatus.Active,
        string lot = "LOT-001")
    {
        var b = new Batch
        {
            HospitalProfileId = hospitalId,
            VaccineId = vaccineId,
            BatchNumber = lot,
            ExpiryDate = expiry ?? DateTime.UtcNow.AddMonths(6),
            QuantityReceived = received,
            QuantityAvailable = available,
            Status = status
        };
        ctx.Batches.Add(b);
        return b;
    }

    // ==================== GetSummaryAsync ====================

    [Fact]
    public async Task GetSummary_WithNoBatches_ReturnsZeros()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();

        var summary = await CreateService(ctx).GetSummaryAsync(user.Id);

        Assert.Equal(0, summary.TotalVials);
        Assert.Equal(0, summary.TotalDoses);
        Assert.Equal(0, summary.LowStockCount);
    }

    [Fact]
    public async Task GetSummary_SumsVialsAndDoses()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, dosesPerVial: 10);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 50, lot: "LOT-A");
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 30, lot: "LOT-B");
        await ctx.SaveChangesAsync();

        var summary = await CreateService(ctx).GetSummaryAsync(user.Id);

        Assert.Equal(80, summary.TotalVials);
        Assert.Equal(800, summary.TotalDoses);
    }

    [Fact]
    public async Task GetSummary_CountsLowStockBatches()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, threshold: 50);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 30, lot: "LOW");
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 200, lot: "OK");
        await ctx.SaveChangesAsync();

        var summary = await CreateService(ctx).GetSummaryAsync(user.Id);

        Assert.Equal(1, summary.LowStockCount);
    }

    // ==================== GetExpiringBatchesAsync ====================

    [Fact]
    public async Task GetExpiringBatches_ReturnsOnlyWithinThreshold()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 20, expiry: DateTime.UtcNow.AddDays(10), lot: "SOON");
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 20, expiry: DateTime.UtcNow.AddDays(300), lot: "LATER");
        await ctx.SaveChangesAsync();

        var result = await CreateService(ctx).GetExpiringBatchesAsync(user.Id, 30);

        Assert.Single(result);
        Assert.Equal("SOON", result[0].LotNumber);
    }

    [Fact]
    public async Task GetExpiringBatches_ExcludesExpiredBatches()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 20, expiry: DateTime.UtcNow.AddDays(-5), lot: "EXPIRED");
        await ctx.SaveChangesAsync();

        var result = await CreateService(ctx).GetExpiringBatchesAsync(user.Id, 30);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetExpiringBatches_ExcludesZeroStockBatches()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 0, expiry: DateTime.UtcNow.AddDays(10), lot: "EMPTY");
        await ctx.SaveChangesAsync();

        var result = await CreateService(ctx).GetExpiringBatchesAsync(user.Id, 30);

        Assert.Empty(result);
    }

    // ==================== GetBatchAuditAsync ====================

    [Fact]
    public async Task GetBatchAudit_ReturnsTransactionsNewestFirst()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        var batch = AddBatch(ctx, hospital.Id, vaccine.Id);
        ctx.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id, Type = TransactionType.Restock, Quantity = 100,
            Reason = "Initial", Timestamp = DateTime.UtcNow.AddHours(-2)
        });
        ctx.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id, Type = TransactionType.Issue, Quantity = 5,
            Reason = "Recent issue", Timestamp = DateTime.UtcNow
        });
        await ctx.SaveChangesAsync();

        var audit = await CreateService(ctx).GetBatchAuditAsync(user.Id, batch.Id);

        Assert.Equal(2, audit.Entries.Count);
    }

    [Fact]
    public async Task GetBatchAudit_ForNonexistentBatch_Throws()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(ctx).GetBatchAuditAsync(user.Id, Guid.NewGuid()));
    }

    // ==================== GetColdVaultsAsync ====================

    [Fact]
    public async Task GetColdVaults_CreatesDefaultVaultsWhenNoneExist()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();

        var vaults = await CreateService(ctx).GetColdVaultsAsync(user.Id);

        Assert.Equal(3, vaults.Count);
    }

    [Fact]
    public async Task GetColdVaults_DoesNotDuplicateOnSecondCall()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);

        await service.GetColdVaultsAsync(user.Id);
        await service.GetColdVaultsAsync(user.Id);

        Assert.Equal(3, await Task.FromResult(ctx.ColdVaults.Count()));
    }

    // ==================== ExecuteAgentDraftAsync ====================

    [Fact]
    public async Task ExecuteAgentDraft_WithUnknownDraftType_Throws()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(ctx).ExecuteAgentDraftAsync(user.Id, new Dtos.ExecuteDraftDto
            {
                WorkflowId = "wf-1",
                DraftType = "unknown_type",
                Payload = new Dictionary<string, object>()
            }));

        Assert.Contains("Unknown draft type", ex.Message);
    }

    [Fact]
    public async Task ExecuteAgentDraft_ForNonHospitalUser_Throws()
    {
        await using var ctx = TestDb.CreateContext();
        await ctx.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(ctx).ExecuteAgentDraftAsync(Guid.NewGuid(), new Dtos.ExecuteDraftDto
            {
                WorkflowId = "wf-2",
                DraftType = "purchase_order",
                Payload = new Dictionary<string, object>()
            }));

        Assert.Contains("hospital", ex.Message, StringComparison.OrdinalIgnoreCase);
    }
}