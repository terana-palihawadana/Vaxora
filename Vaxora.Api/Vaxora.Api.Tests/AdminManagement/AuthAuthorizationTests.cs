using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Controllers;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.AdminManagement;

public class AuthAuthorizationTests
{
    private static (AuthController controller, AuthService service, ApplicationDbContext context) Create()
    {
        var context = TestDb.CreateContext();
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:SecretKey"] = "VaxoraTestPlatformSecretKeyLongEnoughForHmacSha256!2026",
                ["Jwt:Issuer"] = "Vaxora.Api",
                ["Jwt:Audience"] = "Vaxora.Client",
                ["Jwt:ExpiryInMinutes"] = "60"
            })
            .Build();

        var service = new AuthService(
            context,
            new FakePasswordHasher(),
            new TokenService(cfg),
            new FakeR2StorageService(),
            new FakeRegistrationNumberService(),
            new FakeVaccinationCardService(),
            new FakeEmailService(),
            cfg,
            NullLogger<AuthService>.Instance);

        var controller = new AuthController(service, NullLogger<AuthController>.Instance);
        return (controller, service, context);
    }

    private static void SetUser(ControllerBase controller, Guid userId, string role = "PATIENT")
    {
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Role, role)
        }, "TestAuth");
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
        };
    }

    private static void SetNoIdentity(ControllerBase controller)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity()) }
        };
    }

    private static User AddPatient(ApplicationDbContext ctx, string email = "p@example.com", string pwd = "Test123!")
    {
        var hasher = new FakePasswordHasher();
        var user = new User
        {
            Email = email,
            PasswordHash = hasher.HashPassword(pwd),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            RegistrationNumber = "VAX-P-9001",
            PatientProfile = new PatientProfile
            {
                FullName = "P",
                NicNumber = $"NIC-{Guid.NewGuid():N}"[..12]
            }
        };
        ctx.Users.Add(user);
        return user;
    }

    // ============================================================
    // Reflection — attribute-level
    // ============================================================

    [Fact]
    public void GetCurrentUser_requires_authorization()
    {
        var m = typeof(AuthController).GetMethod(nameof(AuthController.GetCurrentUser))!;
        Assert.NotNull(m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true).FirstOrDefault());
    }

    [Fact]
    public void UpdateProfile_requires_authorization()
    {
        var m = typeof(AuthController).GetMethod(nameof(AuthController.UpdateProfile))!;
        Assert.NotNull(m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true).FirstOrDefault());
    }

    [Fact]
    public void DeleteAccount_requires_authorization()
    {
        var m = typeof(AuthController).GetMethod(nameof(AuthController.DeleteAccount))!;
        Assert.NotNull(m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true).FirstOrDefault());
    }

    [Fact]
    public void Login_is_anonymous()
    {
        var m = typeof(AuthController).GetMethod(nameof(AuthController.Login))!;
        Assert.Null(m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true).FirstOrDefault());
    }

    // ============================================================
    // GetCurrentUser
    // ============================================================

    [Fact]
    public async Task GetCurrentUser_returns_401_without_identity()
    {
        var (controller, _, _) = Create();
        SetNoIdentity(controller);

        var result = await controller.GetCurrentUser();
        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task GetCurrentUser_returns_404_for_unknown_user()
    {
        var (controller, _, _) = Create();
        SetUser(controller, Guid.NewGuid());

        var result = await controller.GetCurrentUser();
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task GetCurrentUser_returns_200_for_known_user()
    {
        var (controller, _, ctx) = Create();
        var user = AddPatient(ctx);
        await ctx.SaveChangesAsync();
        SetUser(controller, user.Id);

        var result = await controller.GetCurrentUser();
        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.IsType<UserDto>(ok.Value);
    }

    // ============================================================
    // UpdateProfile
    // ============================================================

    [Fact]
    public async Task UpdateProfile_returns_401_without_identity()
    {
        var (controller, _, _) = Create();
        SetNoIdentity(controller);

        var result = await controller.UpdateProfile(new UpdateProfileDto { FullName = "X" });
        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task UpdateProfile_returns_404_when_user_unknown()
    {
        var (controller, _, _) = Create();
        SetUser(controller, Guid.NewGuid());

        var result = await controller.UpdateProfile(new UpdateProfileDto { FullName = "X" });
        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ============================================================
    // UpdateProfilePhoto
    // ============================================================

    [Fact]
    public async Task UpdateProfilePhoto_returns_400_when_no_file()
    {
        var (controller, _, _) = Create();
        SetUser(controller, Guid.NewGuid());

        var result = await controller.UpdateProfilePhoto(new ProfilePhotoUploadDto { Photo = null! });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task UpdateProfilePhoto_returns_401_without_identity()
    {
        var (controller, _, _) = Create();
        SetNoIdentity(controller);
        var fake = new Microsoft.AspNetCore.Http.FormFile(
            new MemoryStream(new byte[] { 1, 2, 3 }), 0, 3, "test.png", "test.png");

        var result = await controller.UpdateProfilePhoto(new ProfilePhotoUploadDto { Photo = fake });
        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    // ============================================================
    // ChangePassword
    // ============================================================

    [Fact]
    public async Task ChangePassword_returns_401_without_identity()
    {
        var (controller, _, _) = Create();
        SetNoIdentity(controller);

        var result = await controller.ChangePassword(new ChangePasswordDto
        {
            CurrentPassword = "x",
            NewPassword = "y"
        });
        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task ChangePassword_returns_400_when_current_password_wrong()
    {
        var (controller, _, ctx) = Create();
        var user = AddPatient(ctx, pwd: "CorrectPwd1!");
        await ctx.SaveChangesAsync();
        SetUser(controller, user.Id);

        var result = await controller.ChangePassword(new ChangePasswordDto
        {
            CurrentPassword = "WrongPwd1!",
            NewPassword = "NewPwd1!"
        });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ============================================================
    // DeleteAccount
    // ============================================================

    [Fact]
    public async Task DeleteAccount_returns_401_without_identity()
    {
        var (controller, _, _) = Create();
        SetNoIdentity(controller);

        var result = await controller.DeleteAccount();
        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    // ============================================================
    // Login — role-based status gates
    // ============================================================

    [Fact]
    public async Task Login_returns_401_on_wrong_password()
    {
        var (controller, _, ctx) = Create();
        AddPatient(ctx, pwd: "RightPwd1!");
        await ctx.SaveChangesAsync();

        var result = await controller.Login(new LoginDto
        {
            Email = "p@example.com",
            Password = "WrongPwd1!"
        });
        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Login_returns_403_for_pending_account()
    {
        var (controller, _, ctx) = Create();
        var user = AddPatient(ctx, pwd: "Pwd1!");
        user.Status = UserStatus.Pending;
        await ctx.SaveChangesAsync();

        var result = await controller.Login(new LoginDto
        {
            Email = "p@example.com",
            Password = "Pwd1!"
        });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, obj.StatusCode);
    }

    [Fact]
    public async Task Login_returns_403_for_suspended_account()
    {
        var (controller, _, ctx) = Create();
        var user = AddPatient(ctx, pwd: "Pwd1!");
        user.Status = UserStatus.Suspended;
        await ctx.SaveChangesAsync();

        var result = await controller.Login(new LoginDto
        {
            Email = "p@example.com",
            Password = "Pwd1!"
        });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, obj.StatusCode);
    }
}
