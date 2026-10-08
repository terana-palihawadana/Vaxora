using Microsoft.EntityFrameworkCore;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class StaffDutyHelperTests
{
    [Fact]
    public void HospitalNow_and_HospitalToday_apply_correct_utc_offset_plus_five_point_five()
    {
        var utcNow = DateTime.UtcNow;
        var hospitalNow = StaffDutyHelper.HospitalNow();

        var diff = hospitalNow - utcNow;
        // Should be approximately +05:30 (allow ±5 seconds for execution latency)
        Assert.True(Math.Abs((diff - TimeSpan.FromHours(5.5)).TotalSeconds) < 5);

        var expectedDate = DateOnly.FromDateTime(hospitalNow);
        Assert.Equal(expectedDate, StaffDutyHelper.HospitalToday());
    }

    [Fact]
    public async Task IsStaffOnDutyAsync_returns_true_when_staff_has_active_affiliation_and_live_shift()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "duty.doc@example.com", "VAX-D-7001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddLiveShift(context, affiliation, hospital); // Covers 00:00 to 23:59 today
        await context.SaveChangesAsync();

        var onDuty = await StaffDutyHelper.IsStaffOnDutyAsync(context, doctor.Id, hospital.Id);
        Assert.True(onDuty);

        // EnsureStaffOnDutyAsync should complete without throwing
        await StaffDutyHelper.EnsureStaffOnDutyAsync(context, doctor.Id, hospital.Id);
    }

    [Fact]
    public async Task IsStaffOnDutyAsync_returns_false_when_affiliation_is_not_active()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "pending.nurse@example.com", "VAX-N-7002");

        var pendingAffiliation = new StaffAffiliation
        {
            HospitalUserId = hospital.Id,
            StaffUserId = nurse.Id,
            StaffRole = UserRole.NURSE,
            Status = AffiliationStatus.Pending,
            InvitedByUserId = hospital.Id
        };
        context.StaffAffiliations.Add(pendingAffiliation);
        TestDb.AddLiveShift(context, pendingAffiliation, hospital);
        await context.SaveChangesAsync();

        var onDuty = await StaffDutyHelper.IsStaffOnDutyAsync(context, nurse.Id, hospital.Id);
        Assert.False(onDuty);
    }

    [Fact]
    public async Task IsStaffOnDutyAsync_returns_false_when_shift_is_on_future_date()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "future.doc@example.com", "VAX-D-7003");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddFutureShift(context, affiliation, hospital, daysAhead: 3);
        await context.SaveChangesAsync();

        var onDuty = await StaffDutyHelper.IsStaffOnDutyAsync(context, doctor.Id, hospital.Id);
        Assert.False(onDuty);
    }

    [Fact]
    public async Task EnsureStaffOnDutyAsync_throws_InvalidOperationException_when_not_on_duty()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "offduty.doc@example.com", "VAX-D-7004");
        TestDb.AddActiveAffiliation(context, hospital, doctor);
        // No shift added
        await context.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            StaffDutyHelper.EnsureStaffOnDutyAsync(context, doctor.Id, hospital.Id));

        Assert.Contains("not on duty at this hospital", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task IsStaffOnDutyAsync_returns_true_for_clock_in_without_shift()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "walkin.nurse@example.com", "VAX-N-7010");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        affiliation.DutyStatus = DutyStatus.OnDuty;
        affiliation.DutyUpdatedAt = DateTime.UtcNow.AddMinutes(-10);
        await context.SaveChangesAsync();

        Assert.True(await StaffDutyHelper.IsStaffOnDutyAsync(context, nurse.Id, hospital.Id));
    }

    [Fact]
    public async Task IsStaffOnDutyAsync_returns_false_for_expired_clock_in()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "stale.nurse@example.com", "VAX-N-7011");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        affiliation.DutyStatus = DutyStatus.OnDuty;
        affiliation.DutyUpdatedAt = DateTime.UtcNow - StaffDutyHelper.ClockInValidity - TimeSpan.FromMinutes(1);
        await context.SaveChangesAsync();

        Assert.False(await StaffDutyHelper.IsStaffOnDutyAsync(context, nurse.Id, hospital.Id));
    }

    [Fact]
    public async Task IsStaffOnDutyAsync_returns_false_on_break_even_with_live_shift()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "break.doc@example.com", "VAX-D-7012");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        affiliation.DutyStatus = DutyStatus.OnBreak;
        affiliation.DutyUpdatedAt = DateTime.UtcNow;
        TestDb.AddLiveShift(context, affiliation, hospital);
        await context.SaveChangesAsync();

        Assert.False(await StaffDutyHelper.IsStaffOnDutyAsync(context, doctor.Id, hospital.Id));
    }

    [Fact]
    public async Task HasAnyStaffOnDutyAsync_and_EnsureHospitalHasOnDutyStaffAsync_detect_active_floor_staff()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();

        // Initially no staff on duty
        var anyOnDutyInitially = await StaffDutyHelper.HasAnyStaffOnDutyAsync(context, hospital.Id);
        Assert.False(anyOnDutyInitially);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            StaffDutyHelper.EnsureHospitalHasOnDutyStaffAsync(context, hospital.Id));
        Assert.Contains("At least one affiliated doctor or nurse must be on duty", ex.Message);

        // Add an on-duty nurse
        var nurse = TestDb.AddNurse(context, "live.nurse@example.com", "VAX-N-7005");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        TestDb.AddLiveShift(context, affiliation, hospital);
        await context.SaveChangesAsync();

        var anyOnDutyNow = await StaffDutyHelper.HasAnyStaffOnDutyAsync(context, hospital.Id);
        Assert.True(anyOnDutyNow);

        // Should complete without throwing
        await StaffDutyHelper.EnsureHospitalHasOnDutyStaffAsync(context, hospital.Id);
    }
}
