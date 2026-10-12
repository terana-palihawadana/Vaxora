using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Dtos;
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
    public async Task GetSummary_CountsLowStockPerVaccine()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, threshold: 50);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 20, lot: "LOW-A");
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 25, lot: "LOW-B");
        await ctx.SaveChangesAsync();

        var summary = await CreateService(ctx).GetSummaryAsync(user.Id);

        Assert.Equal(1, summary.LowStockCount);
    }

    [Fact]
    public async Task GetSummary_LowBatchCoveredByAnotherBatch_IsNotLowStock()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, threshold: 50);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 30, lot: "LOW");
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 200, lot: "OK");
        await ctx.SaveChangesAsync();

        var service = CreateService(ctx);
        var summary = await service.GetSummaryAsync(user.Id);
        var items = await service.GetInventoryAsync(user.Id);

        Assert.Equal(0, summary.LowStockCount);
        Assert.All(items, i => Assert.False(i.IsLowStock));
        Assert.All(items, i => Assert.Equal(230, i.VaccineAvailable));
    }

    [Fact]
    public async Task GetInventory_ExpiredBatchDoesNotCoverLowStock()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, threshold: 50);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 30, lot: "LOW");
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 200, lot: "OLD", expiry: DateTime.UtcNow.AddDays(-1));
        await ctx.SaveChangesAsync();

        var items = await CreateService(ctx).GetInventoryAsync(user.Id);

        Assert.All(items, i => Assert.True(i.IsLowStock));
    }

    // ==================== Formulary supplier cost ====================

    [Fact]
    public async Task RegisterFormulary_StoresSupplierCostSeparatelyFromFee()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);

        await service.RegisterFormularyAsync(user.Id, new RegisterFormularyDto
        {
            VaccineName = "BCG", Category = "pediatric", Price = 0m, SupplierCost = 850m
        });

        var entry = Assert.Single(await service.GetFormularyAsync(user.Id));
        Assert.Equal(0m, entry.Price);
        Assert.Equal(850m, entry.SupplierCost);
        Assert.Equal("pediatric", entry.Category);
    }

    [Fact]
    public async Task UpdateFormularyPrice_ChangesSupplierCostOnlyWhenSent()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);
        var created = await service.RegisterFormularyAsync(user.Id, new RegisterFormularyDto
        {
            VaccineName = "BCG", Price = 500m, SupplierCost = 850m
        });

        var feeOnly = await service.UpdateFormularyPriceAsync(user.Id, created.Id,
            new UpdateFormularyPriceDto { Price = 600m });
        Assert.Equal(600m, feeOnly.Price);
        Assert.Equal(850m, feeOnly.SupplierCost);

        var both = await service.UpdateFormularyPriceAsync(user.Id, created.Id,
            new UpdateFormularyPriceDto { Price = 600m, SupplierCost = 900m });
        Assert.Equal(900m, both.SupplierCost);
    }

    // ==================== Formulary supplier contact ====================

    [Fact]
    public async Task RegisterFormulary_StoresSupplierContact_AndRejectsBadEmail()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);

        var created = await service.RegisterFormularyAsync(user.Id, new RegisterFormularyDto
        {
            VaccineName = "BCG", SupplierName = " Serum Institute ", SupplierEmail = "orders@serum.example"
        });
        Assert.Equal("Serum Institute", created.SupplierName);
        Assert.Equal("orders@serum.example", created.SupplierEmail);

        // Fee-only update leaves the contact alone; an empty string clears it
        var feeOnly = await service.UpdateFormularyPriceAsync(user.Id, created.Id, new UpdateFormularyPriceDto { Price = 10m });
        Assert.Equal("orders@serum.example", feeOnly.SupplierEmail);
        var cleared = await service.UpdateFormularyPriceAsync(user.Id, created.Id, new UpdateFormularyPriceDto { Price = 10m, SupplierEmail = "" });
        Assert.Null(cleared.SupplierEmail);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateFormularyPriceAsync(user.Id, created.Id, new UpdateFormularyPriceDto { Price = 10m, SupplierEmail = "not-an-email" }));
    }

    [Fact]
    public async Task ApprovingPurchaseOrder_EmailsEachLineToItsOwnSupplier()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var withSupplier = AddVaccine(ctx);
        var withoutSupplier = new Vaccine
        {
            Name = "MMR", Manufacturer = "GSK", Category = VaccineCategory.Routine,
            DosesPerVial = 1, DefaultMinThreshold = 50, RequiredTemp = "2-8C"
        };
        ctx.Vaccines.Add(withoutSupplier);
        ctx.HospitalFormularies.Add(new HospitalFormulary
        {
            HospitalProfileId = hospital.Id, VaccineId = withSupplier.Id,
            SupplierName = "Pfizer Lanka", SupplierEmail = "orders@pfizer.example"
        });
        await ctx.SaveChangesAsync();
        var email = new FakeEmailService();
        var service = new InventoryService(ctx, NullLogger<InventoryService>.Instance, email);

        var lineItems = System.Text.Json.JsonSerializer.SerializeToElement(new[]
        {
            new { vaccine_id = withSupplier.Id.ToString(), vaccine_name = "Pfizer", quantity = 100, unit_price_lkr = 100, total_lkr = 10000 },
            new { vaccine_id = withoutSupplier.Id.ToString(), vaccine_name = "MMR", quantity = 50, unit_price_lkr = 100, total_lkr = 5000 }
        });
        await service.ExecuteAgentDraftAsync(user.Id, new ExecuteDraftDto
        {
            WorkflowId = "wf-1",
            DraftType = "purchase_order",
            Payload = new Dictionary<string, object> { ["po_number"] = "AI-PO-TEST-2", ["line_items"] = lineItems }
        });

        Assert.Equal(2, email.PurchaseOrdersSent.Count);
        Assert.Contains(email.PurchaseOrdersSent, m => m.ToEmail == "orders@pfizer.example" && m.SupplierName == "Pfizer Lanka" && m.LineCount == 1);
        // No supplier saved on the product: falls back to the default supplier
        Assert.Contains(email.PurchaseOrdersSent, m => m.SupplierName == "State Pharmaceuticals Corporation" && m.LineCount == 1);
    }

    // ==================== Purchase orders: on order, then received ====================

    private static ExecuteDraftDto PurchaseOrder(Guid vaccineId, int quantity, string poNumber = "AI-PO-TEST-1")
    {
        var lineItems = System.Text.Json.JsonSerializer.SerializeToElement(new[]
        {
            new { vaccine_id = vaccineId.ToString(), vaccine_name = "Pfizer", quantity, unit_price_lkr = 100, total_lkr = quantity * 100 }
        });
        return new ExecuteDraftDto
        {
            WorkflowId = "wf-1",
            DraftType = "purchase_order",
            Payload = new Dictionary<string, object> { ["po_number"] = poNumber, ["line_items"] = lineItems }
        };
    }

    [Fact]
    public async Task ApprovingPurchaseOrder_PlacesStockOnOrder_WithoutAddingUsableStock()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, threshold: 50);
        AddBatch(ctx, hospital.Id, vaccine.Id, available: 20, lot: "LOW");
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);

        await service.ExecuteAgentDraftAsync(user.Id, PurchaseOrder(vaccine.Id, 100));

        var items = await service.GetInventoryAsync(user.Id);
        var ordered = Assert.Single(items, i => i.Status == "ordered");
        Assert.Equal(0, ordered.Available);
        Assert.Equal(100, ordered.Capacity);
        Assert.All(items, i => Assert.Equal(20, i.VaccineAvailable));
        Assert.All(items, i => Assert.Equal(100, i.VaccineOnOrder));
        // Covered by the order, so it is no longer flagged for reorder
        Assert.All(items, i => Assert.False(i.IsLowStock));

        var summary = await service.GetSummaryAsync(user.Id);
        Assert.Equal(20, summary.TotalVials);
        Assert.Equal(0, summary.LowStockCount);
    }

    [Fact]
    public async Task ApprovingSamePurchaseOrderTwice_IsRejected()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);

        await service.ExecuteAgentDraftAsync(user.Id, PurchaseOrder(vaccine.Id, 100));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.ExecuteAgentDraftAsync(user.Id, PurchaseOrder(vaccine.Id, 100)));
    }

    [Fact]
    public async Task ReceivingOrderedBatch_MakesItUsableWithRealLotAndExpiry()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx, threshold: 50);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);
        await service.ExecuteAgentDraftAsync(user.Id, PurchaseOrder(vaccine.Id, 100));
        var ordered = Assert.Single(await service.GetInventoryAsync(user.Id));
        var expiry = DateTime.UtcNow.AddMonths(8);

        var received = await service.ReceiveOrderedBatchAsync(user.Id, ordered.Id, new ReceiveBatchDto
        {
            LotNumber = "PF-9921", ExpiryDate = expiry, Quantity = 90
        });

        Assert.Equal("active", received.Status);
        Assert.Equal("PF-9921", received.LotNumber);
        Assert.Equal(90, received.Available);
        Assert.Equal(90, received.VaccineAvailable);
        Assert.Equal(0, received.VaccineOnOrder);
        Assert.Equal(expiry.ToString("yyyy-MM-dd"), received.Expiry);
    }

    [Fact]
    public async Task ReceivingBatch_RejectsActiveBatchAndDuplicateLot()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, hospital) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        var active = AddBatch(ctx, hospital.Id, vaccine.Id, lot: "LOT-001");
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);
        await service.ExecuteAgentDraftAsync(user.Id, PurchaseOrder(vaccine.Id, 100));
        var ordered = Assert.Single(await service.GetInventoryAsync(user.Id), i => i.Status == "ordered");
        var dto = new ReceiveBatchDto { LotNumber = "LOT-001", ExpiryDate = DateTime.UtcNow.AddMonths(6), Quantity = 100 };

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ReceiveOrderedBatchAsync(user.Id, active.Id, dto));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ReceiveOrderedBatchAsync(user.Id, ordered.Id, dto));
    }

    [Fact]
    public async Task AdjustStock_OnOrderedBatch_IsRejected()
    {
        await using var ctx = TestDb.CreateContext();
        var (user, _) = AddHospital(ctx);
        var vaccine = AddVaccine(ctx);
        await ctx.SaveChangesAsync();
        var service = CreateService(ctx);
        await service.ExecuteAgentDraftAsync(user.Id, PurchaseOrder(vaccine.Id, 100));
        var ordered = Assert.Single(await service.GetInventoryAsync(user.Id));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AdjustStockAsync(user.Id, ordered.Id, new AdjustStockDto { Delta = 20 }));
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