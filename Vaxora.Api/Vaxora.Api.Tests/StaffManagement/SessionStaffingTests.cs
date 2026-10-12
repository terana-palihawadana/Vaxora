using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class SessionStaffingTests
{
    private static readonly TimeOnly SessionStart = new(17, 0);
    private static readonly TimeOnly SessionEnd = new(19, 0);

    [Fact]
    public async Task GetRosterSessionsAsync_lists_each_dated_run_of_a_weekly_session()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);

        var sessions = await service.GetRosterSessionsAsync(seed.Hospital.Id, seed.Date, seed.Date.AddDays(7));

        // The weekly session runs on its weekday twice in an eight-day range.
        Assert.Equal(2, sessions.Count);
        var first = sessions[0];
        Assert.Equal(seed.Date, first.Date);
        Assert.Equal(SessionStart, first.StartTime);
        Assert.Equal(seed.Booth.Id, first.BoothId);
        Assert.Equal("Influenza", first.VaccineName);
        Assert.Empty(first.Doctors);
        Assert.True(first.CanAssign);
    }

    [Fact]
    public async Task AssignSessionStaffAsync_creates_shifts_with_the_session_hours_and_booth()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);

        var session = await service.AssignSessionStaffAsync(seed.Hospital.Id, new AssignSessionStaffDto
        {
            ScheduleId = seed.Schedule.Id,
            Date = seed.Date,
            AffiliationIds = { seed.Doctor.Id, seed.Nurse.Id }
        });

        Assert.Single(session.Doctors);
        Assert.Single(session.Nurses);
        var shifts = await context.StaffShifts.ToListAsync();
        Assert.Equal(2, shifts.Count);
        Assert.All(shifts, shift =>
        {
            Assert.Equal(seed.Date, shift.ShiftDate);
            Assert.Equal(SessionStart, shift.StartTime);
            Assert.Equal(SessionEnd, shift.EndTime);
            Assert.Equal(seed.Booth.Id, shift.BoothId);
        });
    }

    [Fact]
    public async Task GetSessionCandidatesAsync_marks_staff_already_on_the_session()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);
        await service.AssignSessionStaffAsync(seed.Hospital.Id, new AssignSessionStaffDto
        {
            ScheduleId = seed.Schedule.Id,
            Date = seed.Date,
            AffiliationIds = { seed.Doctor.Id }
        });

        var candidates = await service.GetSessionCandidatesAsync(seed.Hospital.Id, seed.Schedule.Id, seed.Date);

        var doctor = candidates.Single(c => c.AffiliationId == seed.Doctor.Id);
        Assert.False(doctor.Available);
        Assert.Equal("Already on this session", doctor.Reason);
        Assert.False(doctor.CanOverride);
        Assert.True(candidates.Single(c => c.AffiliationId == seed.Nurse.Id).Available);
        // Free staff are listed first.
        Assert.Equal(seed.Nurse.Id, candidates[0].AffiliationId);
    }

    [Fact]
    public async Task GetSessionCandidatesAsync_flags_a_doctor_on_a_day_off()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(seed.Doctor.StaffUserId, seed.Doctor.Id, new UpdateStaffAvailabilityDto
        {
            UnavailableDates = { seed.Date }
        });

        var candidates = await service.GetSessionCandidatesAsync(seed.Hospital.Id, seed.Schedule.Id, seed.Date);

        var doctor = candidates.Single(c => c.AffiliationId == seed.Doctor.Id);
        Assert.False(doctor.Available);
        Assert.Contains("unavailable", doctor.Reason);
        Assert.True(doctor.CanOverride);
    }

    [Fact]
    public async Task AssignSessionStaffAsync_refuses_a_day_off_unless_the_hospital_overrides()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(seed.Doctor.StaffUserId, seed.Doctor.Id, new UpdateStaffAvailabilityDto
        {
            UnavailableDates = { seed.Date }
        });
        var dto = new AssignSessionStaffDto
        {
            ScheduleId = seed.Schedule.Id,
            Date = seed.Date,
            AffiliationIds = { seed.Doctor.Id, seed.Nurse.Id }
        };

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AssignSessionStaffAsync(seed.Hospital.Id, dto));
        Assert.StartsWith("Outside availability:", exception.Message);
        // Nobody is rostered when one pick fails.
        Assert.Empty(await context.StaffShifts.ToListAsync());

        dto.OverrideAvailability = true;
        var session = await service.AssignSessionStaffAsync(seed.Hospital.Id, dto);
        Assert.Single(session.Doctors);
    }

    [Fact]
    public async Task AssignSessionStaffAsync_refuses_a_doctor_working_at_another_hospital()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var other = TestDb.AddHospital(context, "other@example.com", "VAX-H-9002");
        var doctorUser = await context.Users.FirstAsync(u => u.Id == seed.Doctor.StaffUserId);
        var otherAffiliation = TestDb.AddActiveAffiliation(context, other, doctorUser);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        await service.CreateShiftAsync(other.Id, new CreateStaffShiftDto
        {
            AffiliationId = otherAffiliation.Id,
            ShiftDate = seed.Date,
            StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(16, 45)
        });

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AssignSessionStaffAsync(seed.Hospital.Id, new AssignSessionStaffDto
            {
                ScheduleId = seed.Schedule.Id,
                Date = seed.Date,
                AffiliationIds = { seed.Doctor.Id },
                OverrideAvailability = true
            }));

        Assert.Contains("another hospital", exception.Message);
    }

    [Fact]
    public async Task AssignSessionStaffAsync_rejects_a_date_the_session_does_not_run()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.AssignSessionStaffAsync(seed.Hospital.Id, new AssignSessionStaffDto
            {
                ScheduleId = seed.Schedule.Id,
                Date = seed.Date.AddDays(1),
                AffiliationIds = { seed.Doctor.Id }
            }));
    }

    [Fact]
    public async Task SuggestWeekCoverageAsync_proposes_staff_for_the_session_hours_and_booth()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);

        var result = await service.SuggestWeekCoverageAsync(seed.Hospital.Id, new SuggestWeekCoverageDto
        {
            From = seed.Date,
            To = seed.Date
        });

        // One doctor and one nurse, on the session's own hours and booth.
        Assert.Equal(2, result.Proposals.Count);
        Assert.All(result.Proposals, proposal =>
        {
            Assert.Equal(SessionStart, proposal.StartTime);
            Assert.Equal(SessionEnd, proposal.EndTime);
            Assert.Equal(seed.Booth.Id, proposal.BoothId);
        });
        Assert.Contains(result.Proposals, p => p.StaffRole == "DOCTOR");
        Assert.Contains(result.Proposals, p => p.StaffRole == "NURSE");
    }

    [Fact]
    public async Task SuggestWeekCoverageAsync_proposes_nothing_for_a_session_that_is_already_staffed()
    {
        await using var context = TestDb.CreateContext();
        var seed = await SeedAsync(context);
        var service = CreateService(context);
        await service.AssignSessionStaffAsync(seed.Hospital.Id, new AssignSessionStaffDto
        {
            ScheduleId = seed.Schedule.Id,
            Date = seed.Date,
            AffiliationIds = { seed.Doctor.Id, seed.Nurse.Id }
        });

        var result = await service.SuggestWeekCoverageAsync(seed.Hospital.Id, new SuggestWeekCoverageDto
        {
            From = seed.Date,
            To = seed.Date
        });

        Assert.Empty(result.Proposals);
        Assert.Contains("already staffed", result.Message);
    }

    private sealed record Seed(
        User Hospital,
        StaffAffiliation Doctor,
        StaffAffiliation Nurse,
        HospitalBooth Booth,
        VaccineSchedule Schedule,
        DateOnly Date);

    private static async Task<Seed> SeedAsync(ApplicationDbContext context)
    {
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddActiveAffiliation(context, hospital, TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001"));
        var nurse = TestDb.AddActiveAffiliation(context, hospital, TestDb.AddNurse(context, "nurse@example.com", "VAX-N-1001"));
        var booth = new HospitalBooth { HospitalUserId = hospital.Id, Code = "B01", Name = "Adult Immunization", IsActive = true };
        context.HospitalBooths.Add(booth);

        var date = StaffDutyHelper.HospitalToday().AddDays(3);
        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            BoothId = booth.Id,
            VaccineName = "Influenza",
            ScheduleType = "Weekly",
            DaysOfWeek = date.DayOfWeek.ToString(),
            StartDate = date.AddDays(-7),
            EndDate = date.AddDays(60),
            StartTime = "17:00",
            EndTime = "19:00",
            Status = "Active"
        };
        context.VaccineSchedules.Add(schedule);
        await context.SaveChangesAsync();
        return new Seed(hospital, doctor, nurse, booth, schedule, date);
    }

    private static StaffManagementService CreateService(ApplicationDbContext context) =>
        new(context, NullLogger<StaffManagementService>.Instance);
}
