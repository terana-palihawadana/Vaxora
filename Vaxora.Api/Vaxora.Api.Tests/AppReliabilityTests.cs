using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Vaxora.Api.Data;

namespace Vaxora.Api.Tests;

/// <summary>
/// Whole-app reliability and recovery tests.
/// Uses EF Core InMemory to avoid needing a real PostgreSQL instance.
/// Scope: startup, error consistency, safe failure and recovery across
/// auth, inventory, appointments, staff and patient modules.
/// </summary>
public class AppReliabilityTests : IClassFixture<AppReliabilityFactory>
{
    private readonly AppReliabilityFactory _factory;

    public AppReliabilityTests(AppReliabilityFactory factory)
    {
        _factory = factory;
    }

    // ==================== STARTUP ====================

    [Fact]
    public void App_Starts_And_Host_Is_Available()
    {
        var client = _factory.CreateClient();
        Assert.NotNull(client);
        Assert.NotNull(client.BaseAddress);
    }

    // ==================== AUTH BOUNDARY (401) ====================
    // Every protected module must reject unauthenticated requests identically.

    [Theory]
    [InlineData("/api/inventory/batches")]
    [InlineData("/api/inventory/summary")]
    [InlineData("/api/appointments/patient")]
    [InlineData("/api/staff/my-affiliations")]
    [InlineData("/api/auth/me")]
    public async Task ProtectedEndpoints_WithoutToken_Return401(string path)
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ==================== ROUTING CONSISTENCY (404) ====================

    [Fact]
    public async Task UnknownRoute_Returns404_Not500()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/this-route-does-not-exist");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UnknownRoute_With_Trailing_Slash_Returns404_Not500()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/nope/");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ==================== ERROR BODY CONSISTENCY ====================

    [Theory]
    [InlineData("/api/inventory/batches")]
    [InlineData("/api/appointments/patient")]
    [InlineData("/api/staff/my-affiliations")]
    public async Task ErrorResponses_AreNotHtml(string path)
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync(path);
        var contentType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
        Assert.NotEqual("text/html", contentType);
    }

    // ==================== INVALID PAYLOAD (400) ====================

    [Fact]
    public async Task Login_WithEmptyBody_Returns400_Not500()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { });
        Assert.True(
            response.StatusCode == HttpStatusCode.BadRequest ||
            response.StatusCode == HttpStatusCode.Unauthorized,
            $"Expected 400 or 401, got {(int)response.StatusCode}");
    }

    [Fact]
    public async Task Login_WithMalformedJson_Returns400_Not500()
    {
        var client = _factory.CreateClient();
        var content = new StringContent("{ not json", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/api/auth/login", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ==================== HEALTH / LIVENESS ====================

    [Fact]
    public async Task ApiHealthEndpoint_Returns200()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task RootEndpoint_ReturnsHealthyJson()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("healthy", body, StringComparison.OrdinalIgnoreCase);
    }

    // ==================== RECOVERY ====================

    [Fact]
    public async Task RepeatedRequests_AfterFailure_StillReturnCorrectStatus()
    {
        var client = _factory.CreateClient();

        // First: unauthenticated request fails with 401
        var first = await client.GetAsync("/api/inventory/batches");
        Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);

        // Second: same request still fails cleanly (no stuck state)
        var second = await client.GetAsync("/api/inventory/batches");
        Assert.Equal(HttpStatusCode.Unauthorized, second.StatusCode);

        // Third: an invalid route still returns 404
        var third = await client.GetAsync("/api/nope");
        Assert.Equal(HttpStatusCode.NotFound, third.StatusCode);
    }

    [Fact]
    public async Task ConcurrentProtectedRequests_AllReturn401_NoStateLeak()
    {
        var client = _factory.CreateClient();

        var paths = new[]
        {
            "/api/inventory/batches",
            "/api/appointments/patient",
            "/api/staff/my-affiliations",
            "/api/auth/me",
            "/api/inventory/summary",
        };

        var tasks = paths.Select(p => client.GetAsync(p));
        var responses = await Task.WhenAll(tasks);

        Assert.All(responses, r =>
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
    }

    // ==================== CROSS-MODULE SAFE FAILURE ====================

    [Fact]
    public async Task Failure_In_One_Module_Does_Not_Affect_Another()
    {
        var client = _factory.CreateClient();

        // Failure in one protected module (staff)
        var staffFailure = await client.GetAsync("/api/staff/my-affiliations");
        Assert.Equal(HttpStatusCode.Unauthorized, staffFailure.StatusCode);

        // Public endpoint still works
        var publicOk = await client.GetAsync("/api/inventory/vaccines");
        Assert.Equal(HttpStatusCode.OK, publicOk.StatusCode);

        // Another protected module still behaves normally
        var apptFailure = await client.GetAsync("/api/appointments/patient");
        Assert.Equal(HttpStatusCode.Unauthorized, apptFailure.StatusCode);
    }
}

// ==================== FACTORY ====================

public class AppReliabilityFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureServices(services =>
        {
            // Remove the real PostgreSQL DbContext registration
            var descriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(DbContextOptions<ApplicationDbContext>));
            if (descriptor != null)
                services.Remove(descriptor);

            // Also remove the DbContext itself if registered explicitly
            var contextDescriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(ApplicationDbContext));
            if (contextDescriptor != null)
                services.Remove(contextDescriptor);

            // Register an in-memory database for these tests
            services.AddDbContext<ApplicationDbContext>(options =>
            {
                options.UseInMemoryDatabase("VaxoraReliabilityTests");
            });
        });
    }
}