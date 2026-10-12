using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Xunit;
using Vaxora.Api.Controllers;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

/// <summary>
/// Front desk: real JWT HTTP checks that a desk account reaches the queue actions of its
/// own hospital and nothing that belongs to hospital management.
/// </summary>
public class DeskAuthorizationTests
{
    private const string JwtSecret = "VaxoraTestPlatformSecretKeyLongEnoughForHmacSha256!2026";

    [Fact]
    public async Task Desk_can_read_the_queue_views_of_its_hospital()
    {
        using var host = CreateHost();
        var (hospital, desk) = await SeedHospitalWithDeskAsync(host);
        using (var db = host.GetDb())
        {
            TestDb.AddAppointment(db, await db.Users.Include(u => u.HospitalProfile).SingleAsync(u => u.Id == hospital));
            await db.SaveChangesAsync();
        }

        foreach (var path in new[]
        {
            "/api/appointments/hospital",
            "/api/staff/booths?activeOnly=true",
            "/api/staff/shifts/hospital",
            "/api/staff/hospital?status=Active",
            "/api/schedule/hospital",
            "/api/desk/me",
            "/api/desk/formulary",
        })
        {
            var response = await host.SendAsync(HttpMethod.Get, path, desk, "FRONT_DESK");
            Assert.True(response.StatusCode == HttpStatusCode.OK, $"{path} returned {(int)response.StatusCode}");
        }

        var appointments = await (await host.SendAsync(HttpMethod.Get, "/api/appointments/hospital", desk, "FRONT_DESK"))
            .Content.ReadFromJsonAsync<List<AppointmentResponseDto>>();
        Assert.Single(appointments!);
    }

    [Fact]
    public async Task Desk_can_check_in_and_settle_payment_and_the_action_is_attributed_to_the_desk_user()
    {
        using var host = CreateHost();
        var (hospital, desk) = await SeedHospitalWithDeskAsync(host);
        Guid confirmedId, unpaidId;
        using (var db = host.GetDb())
        {
            var hospitalUser = await db.Users.Include(u => u.HospitalProfile).SingleAsync(u => u.Id == hospital);
            confirmedId = TestDb.AddAppointment(db, hospitalUser).Id;
            unpaidId = TestDb.AddAppointment(db, hospitalUser, status: "PendingPayment", paymentStatus: "Pending").Id;
            await db.SaveChangesAsync();
        }

        var checkIn = await host.SendAsync(HttpMethod.Post, $"/api/appointments/{confirmedId}/check-in", desk, "FRONT_DESK");
        var markPaid = await host.SendAsync(
            HttpMethod.Patch,
            $"/api/appointments/{unpaidId}/status",
            desk,
            "FRONT_DESK",
            new UpdateAppointmentStatusDto { Status = "Confirmed" });

        Assert.Equal(HttpStatusCode.OK, checkIn.StatusCode);
        Assert.Equal(HttpStatusCode.OK, markPaid.StatusCode);

        using var verify = host.GetDb();
        Assert.NotNull((await verify.Appointments.SingleAsync(a => a.Id == confirmedId)).CheckedInAt);
        Assert.Equal("Confirmed", (await verify.Appointments.SingleAsync(a => a.Id == unpaidId)).Status);
        Assert.True(await verify.AuditLogs.AnyAsync(a => a.UserId == desk && a.Action == "DESK_CHECK_IN"));
        Assert.True(await verify.AuditLogs.AnyAsync(a => a.UserId == desk && a.Action == "DESK_STATUS_UPDATE"));
    }

    [Fact]
    public async Task Desk_can_cancel_an_appointment_of_its_hospital_but_not_of_another()
    {
        using var host = CreateHost();
        var (hospital, desk) = await SeedHospitalWithDeskAsync(host);
        Guid ownId, foreignId;
        using (var db = host.GetDb())
        {
            var tomorrow = StaffDutyHelper.HospitalToday().AddDays(1);
            var hospitalUser = await db.Users.Include(u => u.HospitalProfile).SingleAsync(u => u.Id == hospital);
            var otherHospital = TestDb.AddHospital(db, "other-hospital@example.com", "VAX-H-9002");
            ownId = TestDb.AddAppointment(db, hospitalUser, date: tomorrow).Id;
            foreignId = TestDb.AddAppointment(db, otherHospital, date: tomorrow).Id;
            await db.SaveChangesAsync();
        }

        var own = await host.SendAsync(HttpMethod.Delete, $"/api/appointments/{ownId}/cancel", desk, "FRONT_DESK");
        var foreign = await host.SendAsync(HttpMethod.Delete, $"/api/appointments/{foreignId}/cancel", desk, "FRONT_DESK");

        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        using var verify = host.GetDb();
        Assert.Equal("Cancelled", (await verify.Appointments.SingleAsync(a => a.Id == ownId)).Status);
        Assert.Equal("Confirmed", (await verify.Appointments.SingleAsync(a => a.Id == foreignId)).Status);
    }

    [Fact]
    public async Task Desk_cannot_perform_clinical_status_changes()
    {
        using var host = CreateHost();
        var (hospital, desk) = await SeedHospitalWithDeskAsync(host);
        Guid appointmentId;
        using (var db = host.GetDb())
        {
            appointmentId = TestDb.AddAppointment(
                db,
                await db.Users.Include(u => u.HospitalProfile).SingleAsync(u => u.Id == hospital)).Id;
            await db.SaveChangesAsync();
        }

        var response = await host.SendAsync(
            HttpMethod.Patch,
            $"/api/appointments/{appointmentId}/status",
            desk,
            "FRONT_DESK",
            new UpdateAppointmentStatusDto { Status = "Administering" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Desk_cannot_act_on_another_hospitals_appointment()
    {
        using var host = CreateHost();
        var (_, desk) = await SeedHospitalWithDeskAsync(host);
        Guid foreignAppointmentId;
        using (var db = host.GetDb())
        {
            var otherHospital = TestDb.AddHospital(db, "other-hospital@example.com", "VAX-H-9002");
            foreignAppointmentId = TestDb.AddAppointment(db, otherHospital).Id;
            await db.SaveChangesAsync();
        }

        var checkIn = await host.SendAsync(HttpMethod.Post, $"/api/appointments/{foreignAppointmentId}/check-in", desk, "FRONT_DESK");
        var status = await host.SendAsync(
            HttpMethod.Patch,
            $"/api/appointments/{foreignAppointmentId}/status",
            desk,
            "FRONT_DESK",
            new UpdateAppointmentStatusDto { Status = "Cancelled" });

        Assert.Equal(HttpStatusCode.Forbidden, checkIn.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, status.StatusCode);
        using var verify = host.GetDb();
        var appointment = await verify.Appointments.SingleAsync(a => a.Id == foreignAppointmentId);
        Assert.Null(appointment.CheckedInAt);
        Assert.Equal("Confirmed", appointment.Status);
    }

    [Theory]
    [InlineData("POST", "/api/staff/invite")]
    [InlineData("GET", "/api/staff/candidates?q=doc")]
    [InlineData("DELETE", "/api/staff/affiliations/11111111-1111-1111-1111-111111111111")]
    [InlineData("POST", "/api/staff/shifts")]
    [InlineData("PUT", "/api/staff/shifts/11111111-1111-1111-1111-111111111111")]
    [InlineData("DELETE", "/api/staff/shifts/11111111-1111-1111-1111-111111111111")]
    [InlineData("GET", "/api/staff/shifts/busy")]
    [InlineData("GET", "/api/staff/coverage")]
    [InlineData("POST", "/api/staff/shifts/suggest-week")]
    [InlineData("POST", "/api/staff/booths")]
    [InlineData("PUT", "/api/staff/booths/11111111-1111-1111-1111-111111111111")]
    [InlineData("DELETE", "/api/staff/booths/11111111-1111-1111-1111-111111111111")]
    [InlineData("GET", "/api/staff/shift-swaps/hospital")]
    [InlineData("POST", "/api/staff/shift-swaps/11111111-1111-1111-1111-111111111111/decision")]
    [InlineData("POST", "/api/schedule")]
    [InlineData("PUT", "/api/schedule/11111111-1111-1111-1111-111111111111")]
    [InlineData("DELETE", "/api/schedule/11111111-1111-1111-1111-111111111111")]
    [InlineData("POST", "/api/schedule/stock-horizon")]
    [InlineData("GET", "/api/inventory/formulary")]
    [InlineData("GET", "/api/inventory/batches")]
    [InlineData("POST", "/api/inventory/batches")]
    [InlineData("POST", "/api/inventory/batches/11111111-1111-1111-1111-111111111111/issue")]
    [InlineData("POST", "/api/inventory/batches/11111111-1111-1111-1111-111111111111/wastage")]
    [InlineData("POST", "/api/desk/accounts")]
    [InlineData("GET", "/api/desk/accounts")]
    [InlineData("DELETE", "/api/desk/accounts/11111111-1111-1111-1111-111111111111")]
    public async Task Desk_is_forbidden_from_hospital_management_endpoints(string method, string path)
    {
        using var host = CreateHost();
        var (_, desk) = await SeedHospitalWithDeskAsync(host);

        var response = await host.SendAsync(new HttpMethod(method), path, desk, "FRONT_DESK", new { });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Removed_desk_account_loses_access_even_with_a_valid_token()
    {
        using var host = CreateHost();
        var (hospital, desk) = await SeedHospitalWithDeskAsync(host);
        using (var db = host.GetDb())
        {
            var affiliation = await db.StaffAffiliations.SingleAsync(a => a.StaffUserId == desk);
            var removed = await host.SendAsync(HttpMethod.Delete, $"/api/desk/accounts/{affiliation.Id}", hospital, "HOSPITAL");
            Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        }

        var appointments = await host.SendAsync(HttpMethod.Get, "/api/appointments/hospital", desk, "FRONT_DESK");
        var booths = await host.SendAsync(HttpMethod.Get, "/api/staff/booths", desk, "FRONT_DESK");

        Assert.Equal(HttpStatusCode.Forbidden, appointments.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, booths.StatusCode);
    }

    [Fact]
    public async Task Hospital_keeps_its_desk_actions_and_manages_desk_accounts()
    {
        using var host = CreateHost();
        var (hospital, _) = await SeedHospitalWithDeskAsync(host);
        Guid appointmentId;
        using (var db = host.GetDb())
        {
            appointmentId = TestDb.AddAppointment(
                db,
                await db.Users.Include(u => u.HospitalProfile).SingleAsync(u => u.Id == hospital)).Id;
            await db.SaveChangesAsync();
        }

        var list = await host.SendAsync(HttpMethod.Get, "/api/appointments/hospital", hospital, "HOSPITAL");
        var checkIn = await host.SendAsync(HttpMethod.Post, $"/api/appointments/{appointmentId}/check-in", hospital, "HOSPITAL");
        var accounts = await host.SendAsync(HttpMethod.Get, "/api/desk/accounts", hospital, "HOSPITAL");
        var created = await host.SendAsync(
            HttpMethod.Post,
            "/api/desk/accounts",
            hospital,
            "HOSPITAL",
            new CreateDeskAccountDto { FullName = "Desk Two", Email = "second-desk@example.com", Password = "desk-pass-2" });
        var deskOnly = await host.SendAsync(HttpMethod.Get, "/api/desk/me", hospital, "HOSPITAL");

        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Equal(HttpStatusCode.OK, checkIn.StatusCode);
        Assert.Equal(HttpStatusCode.OK, accounts.StatusCode);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, deskOnly.StatusCode);
        Assert.Single((await accounts.Content.ReadFromJsonAsync<List<DeskAccountDto>>())!);

        using var verify = host.GetDb();
        Assert.False(await verify.AuditLogs.AnyAsync(a => a.Action == "DESK_CHECK_IN"));
    }

    [Theory]
    [InlineData("DOCTOR")]
    [InlineData("NURSE")]
    [InlineData("PATIENT")]
    public async Task Other_roles_cannot_manage_desk_accounts(string role)
    {
        using var host = CreateHost();
        await SeedHospitalWithDeskAsync(host);

        var response = await host.SendAsync(
            HttpMethod.Post,
            "/api/desk/accounts",
            Guid.NewGuid(),
            role,
            new CreateDeskAccountDto { FullName = "Desk X", Email = "x@example.com", Password = "desk-pass-1" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static async Task<(Guid HospitalUserId, Guid DeskUserId)> SeedHospitalWithDeskAsync(DeskHost host)
    {
        using var db = host.GetDb();
        var hospital = TestDb.AddHospital(db);
        await db.SaveChangesAsync();

        var created = await host.SendAsync(
            HttpMethod.Post,
            "/api/desk/accounts",
            hospital.Id,
            "HOSPITAL",
            new CreateDeskAccountDto { FullName = "Desk One", Email = "desk@example.com", Password = "desk-pass-1" });
        created.EnsureSuccessStatusCode();
        var account = await created.Content.ReadFromJsonAsync<DeskAccountDto>();
        return (hospital.Id, account!.UserId);
    }

    private static string GenerateJwt(Guid userId, string role)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));
        var token = new JwtSecurityToken(
            issuer: "Vaxora.Api",
            audience: "Vaxora.Client",
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Email, $"{role.ToLowerInvariant()}@example.com"),
                new Claim(ClaimTypes.Role, role)
            },
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static DeskHost CreateHost()
    {
        var dbName = Guid.NewGuid().ToString();
        var builder = new WebHostBuilder()
            .ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SecretKey"] = JwtSecret,
                    ["Jwt:Issuer"] = "Vaxora.Api",
                    ["Jwt:Audience"] = "Vaxora.Client",
                    ["Jwt:ExpiryInMinutes"] = "60"
                });
            })
            .ConfigureServices(services =>
            {
                services.AddAuthentication(options =>
                {
                    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
                })
                .AddJwtBearer(options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidateAudience = true,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                        ValidIssuer = "Vaxora.Api",
                        ValidAudience = "Vaxora.Client",
                        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret)),
                        ClockSkew = TimeSpan.Zero
                    };
                });

                services.AddAuthorization();
                services.AddControllers()
                    .AddApplicationPart(typeof(AuthController).Assembly)
                    .AddJsonOptions(o => o.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles);
                services.AddDbContext<ApplicationDbContext>(o => o.UseInMemoryDatabase(dbName));

                services.AddScoped<IPasswordHasher, PasswordHasher>();
                services.AddScoped<IEmailService, FakeEmailService>();
                services.AddScoped<IRegistrationNumberService, FakeRegistrationNumberService>();
                services.AddScoped<IR2StorageService, FakeR2StorageService>();
                services.AddScoped<IVaccinationCardService, FakeVaccinationCardService>();
                services.AddScoped<IInventoryService, InventoryService>();
                services.AddScoped<IAppointmentService, AppointmentService>();
                services.AddScoped<IPayHereService, PayHereService>();
                services.AddScoped<IScheduleService, ScheduleService>();
                services.AddScoped<IStaffManagementService, StaffManagementService>();
                services.AddScoped<IShiftSwapService, ShiftSwapService>();
                services.AddScoped<IAgentGatewayService, FakeAgentGateway>();
                services.AddScoped<IAgentWorkflowService, AgentWorkflowService>();
                services.AddScoped<IDeskAccessService, DeskAccessService>();
                services.AddRouting();
            })
            .Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(e => e.MapControllers());
            });

        var server = new TestServer(builder);
        return new DeskHost(server, server.CreateClient());
    }

    private sealed class DeskHost : IDisposable
    {
        private readonly TestServer _server;
        private readonly HttpClient _client;

        public DeskHost(TestServer server, HttpClient client)
        {
            _server = server;
            _client = client;
        }

        public ApplicationDbContext GetDb() =>
            _server.Services.CreateScope().ServiceProvider.GetRequiredService<ApplicationDbContext>();

        public Task<HttpResponseMessage> SendAsync(
            HttpMethod method,
            string path,
            Guid userId,
            string role,
            object? body = null)
        {
            var request = new HttpRequestMessage(method, path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", GenerateJwt(userId, role));
            if (body != null && method != HttpMethod.Get && method != HttpMethod.Delete)
                request.Content = JsonContent.Create(body);
            return _client.SendAsync(request);
        }

        public void Dispose()
        {
            _client.Dispose();
            _server.Dispose();
        }
    }
}
