using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;
using Vaxora.Api.Models;

namespace Vaxora.Api.Tests;

public class InventoryDatabaseSchemaTests
{
    private static IEntityType BatchType() =>
        TestDb.CreateContext().Model.FindEntityType(typeof(Batch))!;

    private static IEntityType TransactionType() =>
        TestDb.CreateContext().Model.FindEntityType(typeof(InventoryTransaction))!;

    // ---------- Batch foreign keys ----------

    [Fact]
    public void Batch_has_foreign_key_to_HospitalProfile()
    {
        var fk = BatchType().GetForeignKeys()
            .FirstOrDefault(f => f.PrincipalEntityType.ClrType == typeof(HospitalProfile));
        Assert.NotNull(fk);
        Assert.Equal("HospitalProfileId", fk.Properties.First().Name);
    }

    [Fact]
    public void Batch_has_foreign_key_to_Vaccine()
    {
        var fk = BatchType().GetForeignKeys()
            .FirstOrDefault(f => f.PrincipalEntityType.ClrType == typeof(Vaccine));
        Assert.NotNull(fk);
        Assert.Equal("VaccineId", fk.Properties.First().Name);
    }

    [Fact]
    public void Batch_batch_number_is_required_and_bounded()
    {
        var prop = BatchType().FindProperty("BatchNumber")!;
        Assert.False(prop.IsNullable);
        Assert.Equal(100, prop.GetMaxLength());
    }

    [Fact]
    public void Batch_quantity_available_is_required()
    {
        var prop = BatchType().FindProperty("QuantityAvailable")!;
        Assert.False(prop.IsNullable);
    }

    // ---------- InventoryTransaction foreign keys ----------

    [Fact]
    public void Transaction_has_foreign_key_to_Batch()
    {
        var fk = TransactionType().GetForeignKeys()
            .FirstOrDefault(f => f.PrincipalEntityType.ClrType == typeof(Batch));
        Assert.NotNull(fk);
        Assert.Equal("BatchId", fk.Properties.First().Name);
    }

    [Fact]
    public void Transaction_has_optional_foreign_key_to_User()
    {
        var fk = TransactionType().GetForeignKeys()
            .FirstOrDefault(f => f.PrincipalEntityType.ClrType == typeof(User));
        Assert.NotNull(fk);
        Assert.Equal("PerformedByUserId", fk.Properties.First().Name);
        Assert.True(fk.Properties.First().IsNullable, "PerformedByUserId should be nullable");
    }

    [Fact]
    public void Transaction_reason_has_max_length_500()
    {
        var prop = TransactionType().FindProperty("Reason")!;
        Assert.Equal(500, prop.GetMaxLength());
    }

    // ---------- Vaccine ----------

    [Fact]
    public void Vaccine_name_is_required_and_bounded()
    {
        var entityType = TestDb.CreateContext().Model.FindEntityType(typeof(Vaccine))!;
        var prop = entityType.FindProperty("Name")!;
        Assert.False(prop.IsNullable);
        Assert.Equal(200, prop.GetMaxLength());
    }

    [Fact]
    public void Vaccine_doses_per_vial_is_required()
    {
        var entityType = TestDb.CreateContext().Model.FindEntityType(typeof(Vaccine))!;
        var prop = entityType.FindProperty("DosesPerVial")!;
        Assert.False(prop.IsNullable);
    }
}