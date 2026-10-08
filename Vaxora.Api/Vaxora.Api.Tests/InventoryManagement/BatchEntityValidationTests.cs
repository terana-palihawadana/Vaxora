using System.ComponentModel.DataAnnotations;
using Vaxora.Api.Models;
using Xunit;

namespace Vaxora.Api.Tests;

public class BatchEntityValidationTests
{
    private static List<ValidationResult> Validate(object entity)
    {
        var ctx = new ValidationContext(entity);
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(entity, ctx, results, validateAllProperties: true);
        return results;
    }

    private static Batch MakeValidBatch() => new Batch
    {
        HospitalProfileId = Guid.NewGuid(),
        VaccineId = Guid.NewGuid(),
        BatchNumber = "LOT-001",
        ExpiryDate = DateTime.UtcNow.AddMonths(6),
        QuantityReceived = 100,
        QuantityAvailable = 100,
        Status = BatchStatus.Active
    };

    // ---------- Batch ----------

    [Fact]
    public void Batch_WithValidData_Passes() =>
        Assert.Empty(Validate(MakeValidBatch()));

    [Theory]
    [InlineData(-1)]
    [InlineData(-100)]
    public void Batch_WithNegativeAvailable_Fails(int available)
    {
        var b = MakeValidBatch();
        b.QuantityAvailable = available;
        Assert.NotEmpty(Validate(b));
    }

    [Fact]
    public void Batch_WithZeroAvailable_Passes()
    {
        var b = MakeValidBatch();
        b.QuantityAvailable = 0;
        Assert.Empty(Validate(b));
    }

    [Fact]
    public void Batch_WithNegativeReceived_Fails()
    {
        var b = MakeValidBatch();
        b.QuantityReceived = -1;
        Assert.NotEmpty(Validate(b));
    }

    [Fact]
    public void Batch_WithNegativeOpenVial_Fails()
    {
        var b = MakeValidBatch();
        b.OpenVialDosesRemaining = -1;
        Assert.NotEmpty(Validate(b));
    }

    [Fact]
    public void Batch_WithNullOpenVial_Passes()
    {
        var b = MakeValidBatch();
        b.OpenVialDosesRemaining = null;
        Assert.Empty(Validate(b));
    }

    [Fact]
    public void Batch_WithZeroOpenVial_Passes()
    {
        var b = MakeValidBatch();
        b.OpenVialDosesRemaining = 0;
        Assert.Empty(Validate(b));
    }

    [Fact]
    public void Batch_WithBatchNumberOver100Chars_Fails()
    {
        var b = MakeValidBatch();
        b.BatchNumber = new string('X', 101);
        Assert.NotEmpty(Validate(b));
    }

    [Fact]
    public void Batch_WithBatchNumberAt100Chars_Passes()
    {
        var b = MakeValidBatch();
        b.BatchNumber = new string('X', 100);
        Assert.Empty(Validate(b));
    }

    // ---------- Vaccine ----------

    private static Vaccine MakeValidVaccine() => new Vaccine
    {
        Name = "Pfizer",
        Manufacturer = "BioNTech",
        Category = VaccineCategory.MRNA,
        DosesPerVial = 6,
        RequiredTemp = "2-8C",
        DefaultMinThreshold = 50
    };

    [Fact]
    public void Vaccine_WithValidData_Passes() =>
        Assert.Empty(Validate(MakeValidVaccine()));

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public void Vaccine_WithDosesPerVialOutOfRange_Fails(int doses)
    {
        var v = MakeValidVaccine();
        v.DosesPerVial = doses;
        Assert.NotEmpty(Validate(v));
    }

    [Fact]
    public void Vaccine_WithOneDose_Passes()
    {
        var v = MakeValidVaccine();
        v.DosesPerVial = 1;
        Assert.Empty(Validate(v));
    }

    [Fact]
    public void Vaccine_WithNegativeDefaultThreshold_Fails()
    {
        var v = MakeValidVaccine();
        v.DefaultMinThreshold = -1;
        Assert.NotEmpty(Validate(v));
    }

    // ---------- InventoryTransaction ----------

    private static InventoryTransaction MakeValidTransaction() => new InventoryTransaction
    {
        BatchId = Guid.NewGuid(),
        Type = TransactionType.Issue,
        Quantity = 5,
        Reason = "Issued to CLINIC-A"
    };

    [Fact]
    public void Transaction_WithValidData_Passes() =>
        Assert.Empty(Validate(MakeValidTransaction()));

    [Fact]
    public void Transaction_WithReasonOver500Chars_Fails()
    {
        var t = MakeValidTransaction();
        t.Reason = new string('X', 501);
        Assert.NotEmpty(Validate(t));
    }

    [Fact]
    public void Transaction_WithNullReason_Passes()
    {
        var t = MakeValidTransaction();
        t.Reason = null;
        Assert.Empty(Validate(t));
    }
}