using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class StaffAvailabilityTests
{
    private static readonly TimeOnly Evening = new(17, 0);
    private static readonly TimeOnly Night = new(21, 0);

    [Fact]
    public async Task CreateShiftAsync_allows_any_slot_when_no_hours_are_set()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, _, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);

        var shift = await service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, NextDay(DayOfWeek.Tuesday), 9, 12));

        Assert.Equal(affiliation.Id, shift.AffiliationId);
    }

    [Fact]
    public async Task CreateShiftAsync_rejects_a_day_the_doctor_did_not_offer()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, NextDay(DayOfWeek.Tuesday), 17, 20)));

        Assert.StartsWith("Outside availability:", exception.Message);
        Assert.Contains("Tuesday", exception.Message);
    }

    [Fact]
    public async Task CreateShiftAsync_rejects_hours_outside_the_offered_block()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, NextDay(DayOfWeek.Monday), 9, 12)));

        Assert.Contains("17:00-21:00", exception.Message);
    }

    [Fact]
    public async Task CreateShiftAsync_accepts_a_slot_inside_the_offered_block()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night));

        var shift = await service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, NextDay(DayOfWeek.Monday), 17, 20));

        Assert.Equal(new TimeOnly(17, 0), shift.StartTime);
    }

    [Fact]
    public async Task CreateShiftAsync_lets_the_hospital_override_for_a_one_off()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night));

        var dto = ShiftOn(affiliation, NextDay(DayOfWeek.Tuesday), 9, 12);
        dto.OverrideAvailability = true;
        var shift = await service.CreateShiftAsync(hospital.Id, dto);

        Assert.Equal(affiliation.Id, shift.AffiliationId);
    }

    [Fact]
    public async Task CreateShiftAsync_ignores_weekly_hours_at_the_primary_hospital()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        var offer = Offer(DayOfWeek.Monday, Evening, Night);
        offer.IsPrimary = true;
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, offer);

        var shift = await service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, NextDay(DayOfWeek.Tuesday), 9, 12));

        Assert.Equal(affiliation.Id, shift.AffiliationId);
    }

    [Fact]
    public async Task CreateShiftAsync_rejects_a_date_marked_unavailable()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        var date = NextDay(DayOfWeek.Monday);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, new UpdateStaffAvailabilityDto
        {
            UnavailableDates = { date }
        });

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, date, 9, 12)));

        Assert.Contains("marked unavailable", exception.Message);
    }

    [Fact]
    public async Task CreateShiftAsync_requires_travel_time_between_hospitals()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var other = TestDb.AddHospital(context, "other@example.com", "VAX-H-9002");
        var otherAffiliation = TestDb.AddActiveAffiliation(context, other, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var date = NextDay(DayOfWeek.Monday);
        await service.CreateShiftAsync(other.Id, ShiftOn(otherAffiliation, date, 8, 16));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, date, 16, 20)));
        Assert.Contains("travel time", exception.Message);

        var later = await service.CreateShiftAsync(hospital.Id, new CreateStaffShiftDto
        {
            AffiliationId = affiliation.Id,
            ShiftDate = date,
            StartTime = new TimeOnly(16, 30),
            EndTime = new TimeOnly(20, 0)
        });
        Assert.Equal(new TimeOnly(16, 30), later.StartTime);
    }

    [Fact]
    public async Task CreateShiftAsync_allows_back_to_back_shifts_at_the_same_hospital()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, _, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        var date = NextDay(DayOfWeek.Monday);
        await service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, date, 8, 12));

        var second = await service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, date, 12, 16));

        Assert.Equal(new TimeOnly(12, 0), second.StartTime);
    }

    [Fact]
    public async Task UpdateMyAvailabilityAsync_keeps_a_single_primary_hospital()
    {
        await using var context = TestDb.CreateContext();
        var (_, doctor, affiliation) = await SeedDoctorAsync(context);
        var other = TestDb.AddHospital(context, "other@example.com", "VAX-H-9002");
        var otherAffiliation = TestDb.AddActiveAffiliation(context, other, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, new UpdateStaffAvailabilityDto { IsPrimary = true });
        await service.UpdateMyAvailabilityAsync(doctor.Id, otherAffiliation.Id, new UpdateStaffAvailabilityDto { IsPrimary = true });

        var primaryIds = await context.StaffAffiliations.Where(a => a.IsPrimary).Select(a => a.Id).ToListAsync();
        Assert.Equal(new[] { otherAffiliation.Id }, primaryIds);
    }

    [Fact]
    public async Task UpdateMyAvailabilityAsync_rejects_hours_that_clash_with_another_hospital()
    {
        await using var context = TestDb.CreateContext();
        var (_, doctor, affiliation) = await SeedDoctorAsync(context);
        var other = TestDb.AddHospital(context, "other@example.com", "VAX-H-9002");
        var otherAffiliation = TestDb.AddActiveAffiliation(context, other, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateMyAvailabilityAsync(
                doctor.Id,
                otherAffiliation.Id,
                Offer(DayOfWeek.Monday, new TimeOnly(13, 0), new TimeOnly(16, 45))));

        Assert.Contains("clashes", exception.Message);
    }

    [Fact]
    public async Task UpdateMyAvailabilityAsync_rejects_overlapping_blocks_and_other_doctors()
    {
        await using var context = TestDb.CreateContext();
        var (_, doctor, affiliation) = await SeedDoctorAsync(context);
        var stranger = TestDb.AddDoctor(context, "stranger@example.com", "VAX-D-2002");
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var overlapping = Offer(DayOfWeek.Monday, Evening, Night);
        overlapping.Windows.Add(new AvailabilityWindowDto
        {
            DayOfWeek = (int)DayOfWeek.Monday,
            StartTime = new TimeOnly(20, 0),
            EndTime = new TimeOnly(22, 0)
        });
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, overlapping));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.UpdateMyAvailabilityAsync(stranger.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night)));
    }

    [Fact]
    public async Task UpdateMyAvailabilityAsync_is_not_offered_to_nurses()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "nurse@example.com", "VAX-N-1001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateMyAvailabilityAsync(nurse.Id, affiliation.Id, Offer(DayOfWeek.Monday, Evening, Night)));

        Assert.Contains("doctors only", exception.Message);
    }

    [Fact]
    public async Task GetMyAffiliationsAsync_returns_the_saved_availability()
    {
        await using var context = TestDb.CreateContext();
        var (_, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(DayOfWeek.Saturday, new TimeOnly(8, 0), new TimeOnly(14, 0)));

        var mine = Assert.Single(await service.GetMyAffiliationsAsync(doctor.Id));

        var window = Assert.Single(mine.AvailabilityWindows);
        Assert.Equal((int)DayOfWeek.Saturday, window.DayOfWeek);
        Assert.Equal(new TimeOnly(14, 0), window.EndTime);
        Assert.False(mine.IsPrimary);
    }

    [Fact]
    public async Task UpdateDutyStatusAsync_blocks_clock_in_while_on_duty_at_another_hospital()
    {
        await using var context = TestDb.CreateContext();
        var (_, doctor, affiliation) = await SeedDoctorAsync(context);
        var other = TestDb.AddHospital(context, "other@example.com", "VAX-H-9002");
        var otherAffiliation = TestDb.AddActiveAffiliation(context, other, doctor);
        TestDb.AddLiveShift(context, otherAffiliation, other);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateDutyStatusAsync(doctor.Id, affiliation.Id, new UpdateDutyStatusDto { DutyStatus = "OnDuty" }));

        Assert.Contains("another hospital", exception.Message);
    }

    [Fact]
    public async Task UpdateDutyStatusAsync_blocks_clock_in_on_a_day_not_offered()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        var notToday = (DayOfWeek)(((int)StaffDutyHelper.HospitalToday().DayOfWeek + 3) % 7);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, Offer(notToday, Evening, Night));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateDutyStatusAsync(doctor.Id, affiliation.Id, new UpdateDutyStatusDto { DutyStatus = "OnDuty" }));
        Assert.Contains("outside the hours", exception.Message);

        // The hospital desk can still clock the doctor in for a one-off.
        var byHospital = await service.UpdateDutyStatusAsync(
            hospital.Id,
            affiliation.Id,
            new UpdateDutyStatusDto { DutyStatus = "OnDuty" });
        Assert.Equal("OnDuty", byHospital.DutyStatus);
    }

    [Fact]
    public async Task SuggestWeekCoverageAsync_skips_doctors_outside_their_offered_hours()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        // Evening-only availability does not fit a morning session.
        var offer = new UpdateStaffAvailabilityDto();
        for (var day = 0; day < 7; day++)
        {
            offer.Windows.Add(new AvailabilityWindowDto { DayOfWeek = day, StartTime = Evening, EndTime = Night });
        }
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, offer);

        var from = StaffDutyHelper.HospitalToday().AddDays(1);
        context.VaccineSchedules.Add(new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Influenza",
            ScheduleType = "OneTime",
            SpecificDate = from,
            StartTime = "09:00",
            EndTime = "11:00",
            Status = "Active"
        });
        await context.SaveChangesAsync();
        var result = await service.SuggestWeekCoverageAsync(hospital.Id, new SuggestWeekCoverageDto
        {
            From = from,
            To = from.AddDays(6)
        });

        Assert.DoesNotContain(result.Proposals, p => p.AffiliationId == affiliation.Id);
    }

    [Fact]
    public async Task SuggestWeekCoverageAsync_uses_a_part_week_doctor_first_while_they_are_behind()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, _, seedAffiliation) = await SeedDoctorAsync(context);
        // Three always-free doctors would normally win the rotation.
        var flexible = new List<StaffAffiliation> { seedAffiliation };
        for (var i = 0; i < 2; i++)
        {
            flexible.Add(TestDb.AddActiveAffiliation(
                context, hospital, TestDb.AddDoctor(context, $"flex{i}@example.com", $"VAX-D-30{i}")));
        }
        var weekendDoctor = TestDb.AddDoctor(context, "weekend@example.com", "VAX-D-4001");
        var weekendAffiliation = TestDb.AddActiveAffiliation(context, hospital, weekendDoctor);
        var saturday = NextDay(DayOfWeek.Saturday);
        context.VaccineSchedules.Add(new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Influenza",
            ScheduleType = "OneTime",
            SpecificDate = saturday,
            StartTime = "08:00",
            EndTime = "17:00",
            Status = "Active"
        });
        await context.SaveChangesAsync();
        var service = CreateService(context);
        await service.UpdateMyAvailabilityAsync(
            weekendDoctor.Id,
            weekendAffiliation.Id,
            Offer(DayOfWeek.Saturday, new TimeOnly(7, 0), new TimeOnly(21, 0)));

        // With nobody rostered yet he has no head start: the first slot goes by rotation.
        var quiet = await service.SuggestWeekCoverageAsync(hospital.Id, new SuggestWeekCoverageDto
        {
            From = saturday,
            To = saturday
        });
        Assert.NotEqual(weekendAffiliation.Id, quiet.Proposals[0].AffiliationId);

        // Once the others already have a shift that week, he is behind and goes first.
        foreach (var affiliation in flexible)
        {
            await service.CreateShiftAsync(hospital.Id, ShiftOn(affiliation, saturday.AddDays(-1), 9, 12));
        }
        var result = await service.SuggestWeekCoverageAsync(hospital.Id, new SuggestWeekCoverageDto
        {
            From = saturday.AddDays(-1),
            To = saturday
        });

        var his = result.Proposals.Where(p => p.AffiliationId == weekendAffiliation.Id).ToList();
        // One session to draw level with the others, not every slot he fits.
        Assert.Single(his);
    }

    [Fact]
    public async Task GetAffiliatedStaffBusyBlocksAsync_reports_days_off_and_unoffered_hours_as_busy()
    {
        await using var context = TestDb.CreateContext();
        var (hospital, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        var monday = NextDay(DayOfWeek.Monday);
        var dayOff = monday.AddDays(2);
        var offer = Offer(DayOfWeek.Monday, Evening, Night);
        offer.UnavailableDates.Add(dayOff);
        await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, offer);

        var blocks = await service.GetAffiliatedStaffBusyBlocksAsync(hospital.Id, monday, monday.AddDays(2));

        Assert.All(blocks, b => Assert.True(b.IsUnavailable));
        // Monday is free only 17:00-21:00.
        var mondayBlocks = blocks.Where(b => b.ShiftDate == monday).OrderBy(b => b.StartTime).ToList();
        Assert.Equal(2, mondayBlocks.Count);
        Assert.Equal(Evening, mondayBlocks[0].EndTime);
        Assert.Equal(Night, mondayBlocks[1].StartTime);
        // Tuesday is not offered at all, and the day off is blocked whole.
        Assert.Single(blocks, b => b.ShiftDate == monday.AddDays(1) && b.StartTime == TimeOnly.MinValue);
        Assert.Single(blocks, b => b.ShiftDate == dayOff && b.StartTime == TimeOnly.MinValue);
    }

    [Fact]
    public async Task UpdateMyAvailabilityAsync_accepts_days_off_across_the_year()
    {
        await using var context = TestDb.CreateContext();
        var (_, doctor, affiliation) = await SeedDoctorAsync(context);
        var service = CreateService(context);
        var start = StaffDutyHelper.HospitalToday().AddDays(200);
        var dto = new UpdateStaffAvailabilityDto();
        for (var i = 0; i < 120; i++) dto.UnavailableDates.Add(start.AddDays(i));

        var saved = await service.UpdateMyAvailabilityAsync(doctor.Id, affiliation.Id, dto);

        Assert.Equal(120, saved.UnavailableDates.Count);
    }

    private static async Task<(User Hospital, User Doctor, StaffAffiliation Affiliation)> SeedDoctorAsync(
        ApplicationDbContext context)
    {
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        return (hospital, doctor, affiliation);
    }

    private static StaffManagementService CreateService(ApplicationDbContext context) =>
        new(context, NullLogger<StaffManagementService>.Instance);

    private static UpdateStaffAvailabilityDto Offer(DayOfWeek day, TimeOnly start, TimeOnly end) => new()
    {
        Windows = { new AvailabilityWindowDto { DayOfWeek = (int)day, StartTime = start, EndTime = end } }
    };

    private static CreateStaffShiftDto ShiftOn(StaffAffiliation affiliation, DateOnly date, int startHour, int endHour) => new()
    {
        AffiliationId = affiliation.Id,
        ShiftDate = date,
        StartTime = new TimeOnly(startHour, 0),
        EndTime = new TimeOnly(endHour, 0)
    };

    /// <summary>The next occurrence of the weekday, always at least one day ahead.</summary>
    private static DateOnly NextDay(DayOfWeek day)
    {
        var date = StaffDutyHelper.HospitalToday().AddDays(1);
        while (date.DayOfWeek != day) date = date.AddDays(1);
        return date;
    }
}
