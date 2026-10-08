using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Vaxora.Api.Data;
using Vaxora.Api.Services;

// Load .env file if present in the working directory
var envFilePath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
if (File.Exists(envFilePath))
{
    foreach (var line in File.ReadAllLines(envFilePath))
    {
        var trimmed = line.Trim();
        if (string.IsNullOrWhiteSpace(trimmed) || trimmed.StartsWith("#")) continue;
        var parts = trimmed.Split('=', 2);
        if (parts.Length == 2)
        {
            var key = parts[0].Trim();
            var val = parts[1].Trim().Trim('"').Trim('\'');
            Environment.SetEnvironmentVariable(key, val);
        }
    }
}

var builder = WebApplication.CreateBuilder(args);

// 1. Configure Database Connection (Neon PostgreSQL / Npgsql)
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString) || connectionString.Contains("PASTE_YOUR_ORIGINAL_CONNECTION_STRING_HERE"))
{
    connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
        ?? builder.Configuration["DATABASE_URL"]
        ?? Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Database=vaxoradb;Username=postgres;Password=postgres";
}

// Support postgresql:// URI format automatically
if (!string.IsNullOrWhiteSpace(connectionString) && 
    (connectionString.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) || 
     connectionString.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)))
{
    try
    {
        var uri = new Uri(connectionString);
        var userInfo = uri.UserInfo.Split(':');
        var username = userInfo.Length > 0 ? Uri.UnescapeDataString(userInfo[0]) : "";
        var password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "";
        var host = uri.Host;
        var port = uri.Port > 0 ? uri.Port : 5432;
        var database = uri.AbsolutePath.TrimStart('/');
        connectionString = $"Host={host};Port={port};Database={database};Username={username};Password={password};SSL Mode=Require;Trust Server Certificate=true";
    }
    catch (Exception exUri)
    {
        Console.WriteLine($"Failed to parse PostgreSQL URI: {exUri.Message}");
    }
}

builder.Services.AddDbContext<ApplicationDbContext>(options =>
{
    options.UseNpgsql(connectionString, npgsqlOptions =>
    {
        npgsqlOptions.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null);
    });
});

// 2. Register Application & Infrastructure Services
builder.Services.AddScoped<IPasswordHasher, PasswordHasher>();
builder.Services.AddScoped<ITokenService, TokenService>();
builder.Services.AddScoped<IR2StorageService, R2StorageService>();
builder.Services.AddScoped<IRegistrationNumberService, RegistrationNumberService>();
builder.Services.AddScoped<IVaccinationCardService, VaccinationCardService>();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IAdminService, AdminService>();
builder.Services.AddScoped<IInventoryService, InventoryService>();
builder.Services.AddScoped<IStaffManagementService, StaffManagementService>();
builder.Services.AddScoped<IScheduleService, ScheduleService>();
builder.Services.AddScoped<IAppointmentService, AppointmentService>();
builder.Services.AddScoped<IPayHereService, PayHereService>();
builder.Services.AddScoped<IPatientVaccinationService, PatientVaccinationService>();
builder.Services.AddScoped<IPatientMedicalHistoryService, PatientMedicalHistoryService>();
builder.Services.AddScoped<IPatientVisitService, PatientVisitService>();
builder.Services.AddScoped<IClinicalScopeService, ClinicalScopeService>();
builder.Services.AddScoped<IClinicalPatientService, ClinicalPatientService>();
builder.Services.AddScoped<IFeedbackService, FeedbackService>();

// Internal Agentic AI service gateway. Clients call this API, never the agent directly.
var envAgentUrl = Environment.GetEnvironmentVariable("AGENT_SERVICE_URL")
    ?? Environment.GetEnvironmentVariable("AgentService__BaseUrl");

var rawAgentServiceUrl = !string.IsNullOrWhiteSpace(envAgentUrl)
    ? envAgentUrl
    : (builder.Configuration["AgentService:BaseUrl"] ?? "http://localhost:8001");

if (string.IsNullOrWhiteSpace(rawAgentServiceUrl))
    rawAgentServiceUrl = "http://localhost:8001";

var agentServiceUrl = rawAgentServiceUrl.Trim().Trim('"', '\'').TrimEnd('/');
if (!agentServiceUrl.EndsWith("/")) agentServiceUrl += "/";


var agentTimeoutSeconds = builder.Configuration.GetValue<int?>("AgentService:TimeoutSeconds") ?? 120;

builder.Services.AddHttpClient(AgentGatewayService.HttpClientName, client =>
{
    client.BaseAddress = new Uri(agentServiceUrl);
    client.Timeout = TimeSpan.FromSeconds(agentTimeoutSeconds);
});

builder.Services.AddScoped<IAgentGatewayService, AgentGatewayService>();
builder.Services.AddScoped<IAgentWorkflowService, AgentWorkflowService>();
builder.Services.AddScoped<IShiftSwapService, ShiftSwapService>();

// 3. Configure JWT Authentication & Authorization
var jwtSecretKey = builder.Configuration["Jwt:SecretKey"];
if (string.IsNullOrWhiteSpace(jwtSecretKey))
{
    jwtSecretKey = Environment.GetEnvironmentVariable("Jwt__SecretKey")
        ?? "VaxoraSecureHealthPlatformJwtSecretKey2026!#DefaulteKeyMinimum32BytesLength";
}

var jwtIssuer = builder.Configuration["Jwt:Issuer"];
if (string.IsNullOrWhiteSpace(jwtIssuer)) jwtIssuer = "Vaxora.Api";

var jwtAudience = builder.Configuration["Jwt:Audience"];
if (string.IsNullOrWhiteSpace(jwtAudience)) jwtAudience = "Vaxora.Client";

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.RequireHttpsMetadata = false; // Set to true in strict production HTTPS
    options.SaveToken = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtIssuer,
        ValidAudience = jwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecretKey)),
        ClockSkew = TimeSpan.Zero
    };
});

builder.Services.AddAuthorization();

// 4. Configure Rate Limiting (Protects Forgot Password from spamming)
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("ForgotPasswordLimiter", opt =>
    {
        opt.PermitLimit = 5;
        opt.Window = TimeSpan.FromMinutes(1);
        opt.QueueLimit = 0;
    });
});

// 5. Configure CORS for Frontend Development & Vercel Production
var corsAllowedOrigins = builder.Configuration["Cors:AllowedOrigins"]
    ?? Environment.GetEnvironmentVariable("CORS_ALLOWED_ORIGINS");

var allowedOriginsList = corsAllowedOrigins?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    ?? Array.Empty<string>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrWhiteSpace(origin)) return false;

            // Allow local development ports
            if (origin.StartsWith("http://localhost:") || origin.StartsWith("http://127.0.0.1:") || origin.StartsWith("https://localhost:"))
                return true;

            // Allow all Vercel deployment URLs (*.vercel.app)
            if (origin.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase) || origin.Contains("vercel.app", StringComparison.OrdinalIgnoreCase))
                return true;

            // Allow custom domains defined in configuration
            if (allowedOriginsList.Contains(origin, StringComparer.OrdinalIgnoreCase))
                return true;

            return false;
        })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
    });
});

// 6. Add Controllers and JSON Serializer Configuration
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    });

// 7. Configure Swagger with JWT Bearer Support
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Vaxora National Immunization Platform API",
        Version = "v1",
        Description = "ASP.NET Core Web API with Neon PostgreSQL, Cloudflare R2, and Role-Based Authorization."
    });

    // JWT Bearer Definition in Swagger
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter 'Bearer' [space] followed by your valid JWT token.\r\n\r\nExample: \"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...\""
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();

// 8. Auto-Seed Initial Admin Account and Migration Setup
// Skip seeding in the "Testing" environment — WebApplicationFactory uses EF Core
// InMemory, which cannot execute raw SQL or migrations.
if (!app.Environment.IsEnvironment("Testing"))
{
    try
    {
        await DbInitializer.SeedAsync(app.Services, app.Configuration);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to execute database seeding.");
    }
}

// 9. Configure HTTP Request Pipeline
var enableSwagger = app.Environment.IsDevelopment() 
    || builder.Configuration.GetValue<bool>("EnableSwagger") 
    || Environment.GetEnvironmentVariable("ENABLE_SWAGGER") == "true";

if (enableSwagger || app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "Vaxora API v1");
        c.RoutePrefix = "swagger";
    });
}

// Render and cloud load balancers handle HTTPS termination
if (!app.Environment.IsProduction())
{
    app.UseHttpsRedirection();
}

app.UseStaticFiles();
app.UseRouting();

app.UseCors("AllowFrontend");
app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

// Render Health Check Endpoint
app.MapGet("/", () => Results.Ok(new { status = "healthy", service = "Vaxora.Api", timestamp = DateTime.UtcNow }));
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", service = "Vaxora.Api", timestamp = DateTime.UtcNow }));

app.MapControllers();

app.Run();

public partial class Program { }