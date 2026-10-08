using Xunit;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests;

public class InventoryDoseHelperTests
{
    [Theory]
    [InlineData(0, 1)]
    [InlineData(-3, 1)]
    [InlineData(1, 1)]
    [InlineData(6, 6)]
    [InlineData(10, 10)]
    public void ResolveDosesPerVial_clamps_zero_and_negative_to_one(int rawDoses, int expected)
    {
        var vaccine = new Vaccine { DosesPerVial = rawDoses };
        var resolved = InventoryDoseHelper.ResolveDosesPerVial(vaccine);
        Assert.Equal(expected, resolved);
    }

    [Fact]
    public void AvailableDoseCount_calculates_total_doses_across_sealed_vials_and_open_vial()
    {
        var vaccine = new Vaccine { DosesPerVial = 6 };
        var batch = new Batch
        {
            QuantityAvailable = 4,
            OpenVialDosesRemaining = 3
        };

        var available = InventoryDoseHelper.AvailableDoseCount(batch, vaccine);
        // 4 vials * 6 doses + 3 open doses = 27 doses
        Assert.Equal(27, available);
    }

    [Fact]
    public void HasUsableDose_returns_true_if_open_doses_or_sealed_vials_exist()
    {
        var batchWithOpenOnly = new Batch { QuantityAvailable = 0, OpenVialDosesRemaining = 2 };
        var batchWithSealedOnly = new Batch { QuantityAvailable = 5, OpenVialDosesRemaining = null };
        var batchDepleted = new Batch { QuantityAvailable = 0, OpenVialDosesRemaining = null };
        var batchZeroOpen = new Batch { QuantityAvailable = 0, OpenVialDosesRemaining = 0 };

        Assert.True(InventoryDoseHelper.HasUsableDose(batchWithOpenOnly));
        Assert.True(InventoryDoseHelper.HasUsableDose(batchWithSealedOnly));
        Assert.False(InventoryDoseHelper.HasUsableDose(batchDepleted));
        Assert.False(InventoryDoseHelper.HasUsableDose(batchZeroOpen));
    }

    [Fact]
    public void ConsumeOneDose_decrements_open_vial_and_clears_to_null_when_zero()
    {
        var vaccine = new Vaccine { DosesPerVial = 5 };
        var batch = new Batch
        {
            BatchNumber = "LOT-100",
            QuantityAvailable = 2,
            OpenVialDosesRemaining = 2,
            Status = BatchStatus.Active
        };

        InventoryDoseHelper.ConsumeOneDose(batch, vaccine);
        Assert.Equal(1, batch.OpenVialDosesRemaining);
        Assert.Equal(2, batch.QuantityAvailable);

        InventoryDoseHelper.ConsumeOneDose(batch, vaccine);
        Assert.Null(batch.OpenVialDosesRemaining);
        Assert.Equal(2, batch.QuantityAvailable);
        Assert.Equal(BatchStatus.Active, batch.Status);
    }

    [Fact]
    public void ConsumeOneDose_opens_new_vial_for_multidose_vaccine()
    {
        var vaccine = new Vaccine { DosesPerVial = 5 };
        var batch = new Batch
        {
            BatchNumber = "LOT-101",
            QuantityAvailable = 3,
            OpenVialDosesRemaining = null,
            Status = BatchStatus.Active
        };

        InventoryDoseHelper.ConsumeOneDose(batch, vaccine);

        Assert.Equal(2, batch.QuantityAvailable);
        Assert.Equal(4, batch.OpenVialDosesRemaining);
        Assert.Equal(BatchStatus.Active, batch.Status);
    }

    [Fact]
    public void ConsumeOneDose_opens_new_vial_for_single_dose_vaccine_without_leaving_open_doses()
    {
        var vaccine = new Vaccine { DosesPerVial = 1 };
        var batch = new Batch
        {
            BatchNumber = "LOT-102",
            QuantityAvailable = 3,
            OpenVialDosesRemaining = null,
            Status = BatchStatus.Active
        };

        InventoryDoseHelper.ConsumeOneDose(batch, vaccine);

        Assert.Equal(2, batch.QuantityAvailable);
        Assert.Null(batch.OpenVialDosesRemaining);
        Assert.Equal(BatchStatus.Active, batch.Status);
    }

    [Fact]
    public void ConsumeOneDose_marks_batch_depleted_when_last_dose_consumed()
    {
        var vaccine = new Vaccine { DosesPerVial = 5 };
        var batch = new Batch
        {
            BatchNumber = "LOT-103",
            QuantityAvailable = 0,
            OpenVialDosesRemaining = 1,
            Status = BatchStatus.Active
        };

        InventoryDoseHelper.ConsumeOneDose(batch, vaccine);

        Assert.Equal(0, batch.QuantityAvailable);
        Assert.Null(batch.OpenVialDosesRemaining);
        Assert.Equal(BatchStatus.Depleted, batch.Status);
    }

    [Fact]
    public void ConsumeOneDose_throws_InvalidOperationException_when_no_doses_remain()
    {
        var vaccine = new Vaccine { DosesPerVial = 5 };
        var batch = new Batch
        {
            BatchNumber = "LOT-104",
            QuantityAvailable = 0,
            OpenVialDosesRemaining = null,
            Status = BatchStatus.Depleted
        };

        var ex = Assert.Throws<InvalidOperationException>(() =>
            InventoryDoseHelper.ConsumeOneDose(batch, vaccine));

        Assert.Contains("no usable doses", ex.Message, StringComparison.OrdinalIgnoreCase);
    }
}
