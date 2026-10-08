using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Controllers;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.BookingManagement;

public class PatientMedicalHistoryAuthorizationTests
{
    [Fact]
    public async Task Patient_cannot_read_another_patients_timeline()
    {
        var (controller, _, otherProfile, _, _) = await CreateController("PATIENT");

        var result = await controller.GetTimeline(otherProfile.Id);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Patient_can_read_own_timeline()
    {
        var (controller, ownProfile, _, _, _) = await CreateController("PATIENT");

        var result = await controller.GetTimeline(ownProfile.Id);

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task Patient_can_read_own_record_by_id()
    {
        var (controller, _, _, _, ownRecord) = await CreateController("PATIENT");

        var result = await controller.GetById(ownRecord.Id);

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task Patient_cannot_read_another_patients_active_conditions()
    {
        var (controller, _, otherProfile, _, _) = await CreateController("PATIENT");

        var result = await controller.GetActiveConditions(otherProfile.Id);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Patient_cannot_read_another_patients_record_by_id()
    {
        var (controller, _, _, otherRecord, _) = await CreateController("PATIENT");

        var result = await controller.GetById(otherRecord.Id);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Clinical_staff_can_read_another_patients_timeline()
    {
        var (controller, _, otherProfile, _, _) = await CreateController("DOCTOR");

        var result = await controller.GetTimeline(otherProfile.Id);

        var timeline = Assert.IsType<PatientMedicalTimelineDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(otherProfile.FullName, timeline.PatientName);
        Assert.Equal(otherProfile.NicNumber, timeline.NicNumber);
        Assert.Equal(otherProfile.DateOfBirth, timeline.DateOfBirth);
        Assert.Equal(otherProfile.PhoneNumber, timeline.PhoneNumber);
    }

    private static async Task<(
        PatientMedicalHistoryController Controller,
        PatientProfile OwnProfile,
        PatientProfile OtherProfile,
        PatientMedicalHistory OtherRecord,
        PatientMedicalHistory OwnRecord)> CreateController(string role)
    {
        var context = TestDb.CreateContext();
        var callerUserId = Guid.NewGuid();
        var ownProfile = new PatientProfile
        {
            UserId = callerUserId,
            FullName = "Current Patient",
            NicNumber = "990000001V",
            DateOfBirth = new DateTime(1990, 1, 2),
            PhoneNumber = "0770000001"
        };
        var otherProfile = new PatientProfile
        {
            UserId = Guid.NewGuid(),
            FullName = "Other Patient",
            NicNumber = "990000002V",
            DateOfBirth = new DateTime(2000, 3, 4),
            PhoneNumber = "0770000002"
        };
        var otherRecord = new PatientMedicalHistory
        {
            PatientProfileId = otherProfile.Id,
            PatientProfile = otherProfile,
            Title = "Private condition"
        };
        var ownRecord = new PatientMedicalHistory
        {
            PatientProfileId = ownProfile.Id,
            PatientProfile = ownProfile,
            Title = "Own condition"
        };
        context.PatientProfiles.AddRange(ownProfile, otherProfile);
        context.PatientMedicalHistories.AddRange(otherRecord, ownRecord);
        await context.SaveChangesAsync();

        var controller = new PatientMedicalHistoryController(
            new PatientMedicalHistoryService(context, NullLogger<PatientMedicalHistoryService>.Instance),
            NullLogger<PatientMedicalHistoryController>.Instance);
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString()),
            new Claim(ClaimTypes.Role, role)
        }, "TestAuth");
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
        };

        return (controller, ownProfile, otherProfile, otherRecord, ownRecord);
    }
}
