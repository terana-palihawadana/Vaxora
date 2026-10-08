using System.ComponentModel.DataAnnotations;
using Vaxora.Api.Dtos;
using Xunit;

namespace Vaxora.Api.Tests;

public class InventoryDtosValidationTests
{
    private static List<ValidationResult> Validate(object dto)
    {
        var ctx = new ValidationContext(dto);
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, ctx, results, validateAllProperties: true);
        return results;
    }

    // ---------- RestockBatchDto ----------

    [Fact]
    public void RestockBatchDto_WithValidData_Passes() =>
        Assert.Empty(Validate(new RestockBatchDto
        {
            VaccineName = "Pfizer", LotNumber = "LOT-001", Quantity = 100
        }));

    [Fact]
    public void RestockBatchDto_WithoutVaccineName_Fails() =>
        Assert.NotEmpty(Validate(new RestockBatchDto
        {
            LotNumber = "LOT-001", Quantity = 100
        }));

    [Fact]
    public void RestockBatchDto_WithoutLotNumber_Fails() =>
        Assert.NotEmpty(Validate(new RestockBatchDto
        {
            VaccineName = "Pfizer", Quantity = 100
        }));

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public void RestockBatchDto_WithNonPositiveQuantity_Fails(int quantity) =>
        Assert.NotEmpty(Validate(new RestockBatchDto
        {
            VaccineName = "Pfizer", LotNumber = "LOT-001", Quantity = quantity
        }));

    [Fact]
    public void RestockBatchDto_WithQuantityOne_Passes() =>
        Assert.Empty(Validate(new RestockBatchDto
        {
            VaccineName = "Pfizer", LotNumber = "LOT-001", Quantity = 1
        }));

    // ---------- IssueStockDto ----------

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void IssueStockDto_WithNonPositiveQuantity_Fails(int qty) =>
        Assert.NotEmpty(Validate(new IssueStockDto { Quantity = qty }));

    [Fact]
    public void IssueStockDto_WithQuantityOne_Passes() =>
        Assert.Empty(Validate(new IssueStockDto { Quantity = 1 }));

    // ---------- WastageDto ----------

    [Fact]
    public void WastageDto_WithValidData_Passes() =>
        Assert.Empty(Validate(new WastageDto { Quantity = 5, Reason = "Vial breakage" }));

    [Fact]
    public void WastageDto_WithoutReason_Fails() =>
        Assert.NotEmpty(Validate(new WastageDto { Quantity = 5 }));

    [Fact]
    public void WastageDto_WithZeroQuantity_Fails() =>
        Assert.NotEmpty(Validate(new WastageDto { Quantity = 0, Reason = "Breakage" }));

    // ---------- AdjustStockDto ----------

    [Theory]
    [InlineData(25)]
    [InlineData(-25)]
    [InlineData(0)]
    public void AdjustStockDto_AllowsAnyDelta(int delta) =>
        Assert.Empty(Validate(new AdjustStockDto { Delta = delta, Reason = "Correction" }));

    // ---------- RegisterFormularyDto ----------

    [Fact]
    public void RegisterFormularyDto_WithValidData_Passes() =>
        Assert.Empty(Validate(new RegisterFormularyDto
        {
            VaccineName = "Pfizer", Price = 1500m
        }));

    [Fact]
    public void RegisterFormularyDto_WithoutVaccineName_Fails() =>
        Assert.NotEmpty(Validate(new RegisterFormularyDto { Price = 100m }));

    [Theory]
    [InlineData(-1)]
    [InlineData(-100000)]
    public void RegisterFormularyDto_WithNegativePrice_Fails(decimal price) =>
        Assert.NotEmpty(Validate(new RegisterFormularyDto
        {
            VaccineName = "Pfizer", Price = price
        }));

    [Fact]
    public void RegisterFormularyDto_WithZeroPrice_Passes() =>
        Assert.Empty(Validate(new RegisterFormularyDto
        {
            VaccineName = "Pfizer", Price = 0m
        }));

    [Fact]
    public void RegisterFormularyDto_WithPriceAboveMax_Fails() =>
        Assert.NotEmpty(Validate(new RegisterFormularyDto
        {
            VaccineName = "Pfizer", Price = 2_000_000m
        }));
}