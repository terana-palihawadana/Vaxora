using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
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

namespace Vaxora.Api.Tests.BookingManagement;

public class ApiIntegrationTests : IDisposable
{
    private const string JwtSecret = "VaxoraTestPlatformSecretKeyLongEnoughForHmacSha256!2026";
    private readonly TestServer _server;
    private readonly HttpClient _client;
    private readonly string _databaseName = Guid.NewGuid().ToString();

    public ApiIntegrationTests()
    {
        var builder = new WebHostBuilder()
            .ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SecretKey"] = JwtSecret,
                    ["Jwt:Issuer"] = "Vaxora.Api",
                    ["Jwt:Audience"] = "Vaxora.Client",
                    ["Jwt:ExpiryInMinutes"] = "60",
                    ["PayHere:MerchantId"] = "121212",
                    ["PayHere:MerchantSecret"] = "testSecret456"
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
                    options.SaveToken = true;
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
                    .AddJsonOptions(options =>
                    {
                        options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
                    });

                services.AddDbContext<ApplicationDbContext>(options =>
                {
                    options.UseInMemoryDatabase(_databaseName);
                });

                // Register Application Services
                services.AddScoped<IPasswordHasher, PasswordHasher>();
                services.AddScoped<ITokenService, TokenService>();
                services.AddScoped<IR2StorageService, FakeR2StorageService>();
                services.AddScoped<IRegistrationNumberService, FakeRegistrationNumberService>();
                services.AddScoped<IVaccinationCardService, FakeVaccinationCardService>();
                services.AddScoped<IEmailService, FakeEmailService>();
                services.AddScoped<IAuthService, AuthService>();
                services.AddScoped<IAppointmentService, AppointmentService>();
                services.AddScoped<IPayHereService, PayHereService>();

                services.AddRouting();
            })
            .Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapGet("/api/health", () => Results.Ok(new { status = "healthy", service = "Vaxora.Api" }));
                    endpoints.MapControllers();
                });
            });

        _server = new TestServer(builder);
        _client = _server.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _server.Dispose();
    }

    private ApplicationDbContext GetDbContext()
    {
        var scope = _server.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    }

    [Fact]
    public async Task GetHealth_returns_200_OK_with_healthy_status()
    {
        var response = await _client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var json = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.NotNull(json);
        Assert.Equal("healthy", json["status"]?.ToString());
        Assert.Equal("Vaxora.Api", json["service"]?.ToString());
    }

    [Fact]
    public async Task PostLogin_through_http_pipeline_executes_service_and_returns_auth_token()
    {
        // 1. Seed user in database
        await using (var context = GetDbContext())
        {
            var hasher = new PasswordHasher();
            context.Users.Add(new User
            {
                Email = "pipeline.test@vaxora.lk",
                PasswordHash = hasher.HashPassword("PipelinePass#1"),
                Role = UserRole.PATIENT,
                Status = UserStatus.Active,
                RegistrationNumber = "VAX-P-5555",
                PatientProfile = new PatientProfile
                {
                    FullName = "Pipeline Patient",
                    NicNumber = "998877665V"
                }
            });
            await context.SaveChangesAsync();
        }

        // 2. Dispatch real HTTP POST request through the ASP.NET Core pipeline
        var response = await _client.PostAsJsonAsync("/api/auth/login", new LoginDto
        {
            Email = "pipeline.test@vaxora.lk",
            Password = "PipelinePass#1"
        });

        // 3. Verify HTTP response & deserialized body
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<AuthResponseDto>();
        Assert.NotNull(result);
        Assert.NotNull(result.Token);
        Assert.Equal("pipeline.test@vaxora.lk", result.User.Email);
        Assert.Equal("PATIENT", result.User.Role);
        Assert.Equal("Pipeline Patient", result.User.Name);

        // 4. Verify DB was updated (last login timestamp and audit log recorded)
        await using (var context = GetDbContext())
        {
            var user = await context.Users.SingleAsync(u => u.Email == "pipeline.test@vaxora.lk");
            Assert.NotNull(user.LastLoginAt);
            Assert.NotNull(user.RefreshToken);

            var audit = await context.AuditLogs.SingleOrDefaultAsync(a => a.UserId == user.Id && a.Action == "LOGIN_SUCCESS");
            Assert.NotNull(audit);
        }
    }

    [Fact]
    public async Task PostLogin_with_invalid_credentials_returns_401_Unauthorized_through_pipeline()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login", new LoginDto
        {
            Email = "nonexistent.pipeline@vaxora.lk",
            Password = "WrongPassword"
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostBooking_complete_api_integration_flow_books_and_verifies_appointment()
    {
        var patientUserId = Guid.NewGuid();
        var hospitalUserId = Guid.NewGuid();
        var vaccineId = Guid.NewGuid();
        var scheduleId = Guid.NewGuid();
        var scheduleDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2));

        // 1. Seed database with required patient, hospital, vaccine, and schedule
        await using (var context = GetDbContext())
        {
            var patient = new User
            {
                Id = patientUserId,
                Email = "booking.patient@vaxora.lk",
                PasswordHash = "hashedPassword",
                Role = UserRole.PATIENT,
                Status = UserStatus.Active,
                RegistrationNumber = "VAX-P-8888",
                PatientProfile = new PatientProfile
                {
                    FullName = "Integration Booker",
                    NicNumber = "998877112V"
                }
            };
            context.Users.Add(patient);

            var hospital = new User
            {
                Id = hospitalUserId,
                Email = "booking.hospital@vaxora.lk",
                PasswordHash = "hashedPassword",
                Role = UserRole.HOSPITAL,
                Status = UserStatus.Active,
                RegistrationNumber = "VAX-H-8888",
                HospitalProfile = new HospitalProfile
                {
                    HospitalName = "Central Apex Hospital",
                    RegistrationNumber = "HOSP-8888",
                    Address = "100 Galle Road, Colombo"
                }
            };
            context.Users.Add(hospital);

            var vaccine = new Vaccine
            {
                Id = vaccineId,
                Name = "Pfizer Comirnaty",
                Manufacturer = "Pfizer",
                Category = VaccineCategory.Routine,
                DosesPerVial = 6,
                RequiredTemp = "2°C to 8°C Chilled",
                DefaultMinThreshold = 100,
                CreatedAt = DateTime.UtcNow
            };
            context.Vaccines.Add(vaccine);

            var schedule = new VaccineSchedule
            {
                Id = scheduleId,
                HospitalUserId = hospitalUserId,
                VaccineId = vaccineId,
                VaccineName = "Pfizer Comirnaty",
                ScheduleType = "OneTime",
                SpecificDate = scheduleDate,
                StartTime = "09:00",
                EndTime = "12:00",
                Price = 0.00m,
                Status = "Active",
                CreatedAt = DateTime.UtcNow
            };
            context.VaccineSchedules.Add(schedule);

            await context.SaveChangesAsync();
        }

        // 2. Generate valid JWT token for patient
        var tokenService = _server.Services.GetRequiredService<ITokenService>();
        var user = new User
        {
            Id = patientUserId,
            Email = "booking.patient@vaxora.lk",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active
        };
        var token = tokenService.GenerateAccessToken(user, "Integration Booker");

        // 3. Dispatch real HTTP POST to /api/appointments with Bearer token
        using var bookingRequest = new HttpRequestMessage(HttpMethod.Post, "/api/appointments");
        bookingRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        bookingRequest.Content = JsonContent.Create(new BookAppointmentRequestDto
        {
            HospitalUserId = hospitalUserId,
            VaccineName = "Pfizer Comirnaty",
            VaccineId = vaccineId,
            VaccineScheduleId = scheduleId,
            AppointmentDate = scheduleDate,
            TimeSlot = "09:00 AM - 09:20 AM",
            PaymentMethod = "Free"
        });

        var response = await _client.SendAsync(bookingRequest);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var createdAppointment = await response.Content.ReadFromJsonAsync<AppointmentResponseDto>();
        Assert.NotNull(createdAppointment);
        Assert.NotEqual(Guid.Empty, createdAppointment.Id);
        Assert.Equal("Confirmed", createdAppointment.Status);
        Assert.Equal("Paid", createdAppointment.PaymentStatus);
        Assert.Equal("Central Apex Hospital", createdAppointment.HospitalName);
        Assert.Equal("09:00 AM - 09:20 AM", createdAppointment.TimeSlot);

        // 4. Dispatch real HTTP GET to /api/appointments/my and verify newly booked appointment is returned
        using var myAppointmentsRequest = new HttpRequestMessage(HttpMethod.Get, "/api/appointments/my");
        myAppointmentsRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var myAppointmentsResponse = await _client.SendAsync(myAppointmentsRequest);
        Assert.Equal(HttpStatusCode.OK, myAppointmentsResponse.StatusCode);

        var list = await myAppointmentsResponse.Content.ReadFromJsonAsync<List<AppointmentResponseDto>>();
        Assert.NotNull(list);
        Assert.Contains(list, a => a.Id == createdAppointment.Id && a.TimeSlot == "09:00 AM - 09:20 AM");

        // 5. Verify direct database persistence and relationship integrity
        await using (var verifyContext = GetDbContext())
        {
            var savedAppointment = await verifyContext.Appointments
                .Include(a => a.PatientUser)
                .Include(a => a.HospitalUser)
                .SingleOrDefaultAsync(a => a.Id == createdAppointment.Id);

            Assert.NotNull(savedAppointment);
            Assert.Equal(patientUserId, savedAppointment.PatientUserId);
            Assert.Equal(hospitalUserId, savedAppointment.HospitalUserId);
            Assert.Equal("Confirmed", savedAppointment.Status);
            Assert.Equal("Paid", savedAppointment.PaymentStatus);
        }
    }

    [Fact]
    public async Task PostPaymentConfirm_with_client_supplied_payment_id_does_not_mark_appointment_paid()
    {
        var (appointment, token) = await CreatePendingPayHereAppointmentAsync();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/payment/confirm");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(new
        {
            appointmentId = appointment.Id,
            paymentId = "CLIENT-FORGED-PAYMENT-ID"
        });

        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.NotNull(body);
        Assert.Equal("false", body["confirmed"]?.ToString());

        await using var context = GetDbContext();
        var saved = await context.Appointments.SingleAsync(a => a.Id == appointment.Id);
        Assert.Equal("PendingPayment", saved.Status);
        Assert.Equal("PendingOnline", saved.PaymentStatus);
        Assert.Null(saved.PaymentTransactionId);
    }

    [Fact]
    public async Task PostPayHereNotify_with_valid_signature_and_matching_payment_confirms_appointment()
    {
        var (appointment, _) = await CreatePendingPayHereAppointmentAsync();
        var orderId = $"APT-{appointment.Id.ToString("N")[..12].ToUpperInvariant()}";

        var response = await _client.PostAsync(
            "/api/payment/payhere-notify",
            CreatePayHereNotification(orderId, "PAYHERE-VALID-123", "1500.00", "LKR"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var context = GetDbContext();
        var saved = await context.Appointments.SingleAsync(a => a.Id == appointment.Id);
        Assert.Equal("Confirmed", saved.Status);
        Assert.Equal("Paid", saved.PaymentStatus);
        Assert.Equal("PAYHERE-VALID-123", saved.PaymentTransactionId);
    }

    [Fact]
    public async Task PostPayHereNotify_with_signed_non_lkr_currency_does_not_confirm_appointment()
    {
        var (appointment, _) = await CreatePendingPayHereAppointmentAsync();
        var orderId = $"APT-{appointment.Id.ToString("N")[..12].ToUpperInvariant()}";

        var response = await _client.PostAsync(
            "/api/payment/payhere-notify",
            CreatePayHereNotification(orderId, "PAYHERE-WRONG-CURRENCY", "1500.00", "USD"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        await using var context = GetDbContext();
        var saved = await context.Appointments.SingleAsync(a => a.Id == appointment.Id);
        Assert.Equal("PendingPayment", saved.Status);
        Assert.Equal("PendingOnline", saved.PaymentStatus);
        Assert.Null(saved.PaymentTransactionId);
    }

    private async Task<(Appointment Appointment, string Token)> CreatePendingPayHereAppointmentAsync()
    {
        var patient = new User
        {
            Email = $"payment.patient.{Guid.NewGuid():N}@vaxora.lk",
            PasswordHash = "hashedPassword",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            RegistrationNumber = $"VAX-P-{Guid.NewGuid():N}"[..14],
            PatientProfile = new PatientProfile
            {
                FullName = "PayHere Test Patient",
                NicNumber = $"{Guid.NewGuid():N}"[..12]
            }
        };
        var hospital = new User
        {
            Email = $"payment.hospital.{Guid.NewGuid():N}@vaxora.lk",
            PasswordHash = "hashedPassword",
            Role = UserRole.HOSPITAL,
            Status = UserStatus.Active,
            RegistrationNumber = $"VAX-H-{Guid.NewGuid():N}"[..14],
            HospitalProfile = new HospitalProfile
            {
                HospitalName = "Payment Test Hospital",
                RegistrationNumber = $"HP-{Guid.NewGuid():N}"[..12]
            }
        };
        var appointment = new Appointment
        {
            PatientUserId = patient.Id,
            PatientName = "PayHere Test Patient",
            PatientEmail = patient.Email,
            HospitalUserId = hospital.Id,
            HospitalName = "Payment Test Hospital",
            VaccineName = "Influenza",
            AppointmentDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2)),
            TimeSlot = "10:00 AM - 10:20 AM",
            Status = "PendingPayment",
            PaymentMethod = "PayHere",
            PaymentStatus = "PendingOnline",
            Fee = 1500m
        };

        await using (var context = GetDbContext())
        {
            context.Users.AddRange(patient, hospital);
            context.Appointments.Add(appointment);
            await context.SaveChangesAsync();
        }

        var token = _server.Services.GetRequiredService<ITokenService>()
            .GenerateAccessToken(patient, patient.PatientProfile!.FullName);
        return (appointment, token);
    }

    private static FormUrlEncodedContent CreatePayHereNotification(
        string orderId,
        string paymentId,
        string amount,
        string currency)
    {
        const string merchantId = "121212";
        const string merchantSecret = "testSecret456";
        const string statusCode = "2";
        var hashedSecret = Convert.ToHexString(
            MD5.HashData(Encoding.UTF8.GetBytes(merchantSecret))).ToUpperInvariant();
        var signaturePayload = $"{merchantId}{orderId}{amount}{currency}{statusCode}{hashedSecret}";
        var signature = Convert.ToHexString(
            MD5.HashData(Encoding.UTF8.GetBytes(signaturePayload))).ToUpperInvariant();

        return new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["merchant_id"] = merchantId,
            ["order_id"] = orderId,
            ["payment_id"] = paymentId,
            ["payhere_amount"] = amount,
            ["payhere_currency"] = currency,
            ["status_code"] = statusCode,
            ["md5sig"] = signature
        });
    }
}
