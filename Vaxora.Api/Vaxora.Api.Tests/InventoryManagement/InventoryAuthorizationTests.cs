using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Xunit;
using Vaxora.Api.Controllers;

namespace Vaxora.Api.Tests;

public class InventoryAuthorizationTests
{
    [Theory]
    [InlineData(nameof(InventoryController.RegisterFormulary))]
    [InlineData(nameof(InventoryController.UpdateFormularyPrice))]
    [InlineData(nameof(InventoryController.RemoveFormulary))]
    [InlineData(nameof(InventoryController.Restock))]
    [InlineData(nameof(InventoryController.LogWastage))]
    [InlineData(nameof(InventoryController.AdjustStock))]
    public void Stock_changing_endpoints_are_limited_to_hospital_and_admin(string methodName)
    {
        var attr = typeof(InventoryController).GetMethod(methodName)!.GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("HOSPITAL,ADMIN", attr.Roles);
    }
}
