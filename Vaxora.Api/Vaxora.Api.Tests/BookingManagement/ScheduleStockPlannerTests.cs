using Xunit;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.BookingManagement;

public class ScheduleStockPlannerTests
{
    [Fact]
    public void SeatsPerSession_two_hour_window_is_eighteen()
    {
        // 09:00–11:00 → 6 bands × 3 patients = 18
        Assert.Equal(6, ScheduleStockPlanner.CountTimeBands("09:00", "11:00"));
        Assert.Equal(18, ScheduleStockPlanner.SeatsPerSession("09:00", "11:00"));
    }

    [Fact]
    public void FreePlanningDoses_subtracts_commit_and_emergency_buffer()
    {
        Assert.Equal(16, ScheduleStockPlanner.FreePlanningDoses(physicalDoses: 40, committedDoses: 22, emergencyBuffer: 2));
        Assert.Equal(0, ScheduleStockPlanner.FreePlanningDoses(physicalDoses: 5, committedDoses: 10, emergencyBuffer: 2));
    }

    [Fact]
    public void ComputeMaxEndDate_stops_when_free_doses_exhausted()
    {
        var today = new DateOnly(2026, 10, 5);
        var start = new DateOnly(2026, 10, 5);
        // Mon/Wed/Fri, 18 seats/session, 40 free → 2 sessions (36), max end = second session day
        var max = ScheduleStockPlanner.ComputeMaxEndDate(
            start,
            new[] { "Monday", "Wednesday", "Friday" },
            "09:00",
            "11:00",
            freeDoses: 40,
            today);

        Assert.Equal(new DateOnly(2026, 10, 7), max); // Mon 5th + Wed 7th
    }

    [Fact]
    public void CanCreateWeekly_rejects_end_past_max()
    {
        var today = new DateOnly(2026, 10, 5);
        var ok = ScheduleStockPlanner.CanCreateWeekly(
            new DateOnly(2026, 10, 5),
            new DateOnly(2026, 12, 31),
            new[] { "Monday", "Wednesday", "Friday" },
            "09:00",
            "11:00",
            freeDoses: 40,
            today,
            out var maxEnd);

        Assert.False(ok);
        Assert.Equal(new DateOnly(2026, 10, 7), maxEnd);
    }

    [Fact]
    public void SumPhysicalDoses_counts_only_active_non_expired_usable_batches()
    {
        var vaccine = new Vaccine { Name = "Rabies", DosesPerVial = 10, Manufacturer = "X", Category = VaccineCategory.Routine };
        var batches = new[]
        {
            new Batch
            {
                Status = BatchStatus.Active,
                ExpiryDate = DateTime.UtcNow.AddMonths(6),
                QuantityAvailable = 2,
                OpenVialDosesRemaining = null
            },
            new Batch
            {
                Status = BatchStatus.Depleted,
                ExpiryDate = DateTime.UtcNow.AddMonths(6),
                QuantityAvailable = 5
            },
            new Batch
            {
                Status = BatchStatus.Active,
                ExpiryDate = DateTime.UtcNow.AddDays(-1),
                QuantityAvailable = 9
            }
        };

        Assert.Equal(20, ScheduleStockPlanner.SumPhysicalDoses(batches, vaccine));
    }

    [Fact]
    public void CommittedSeatsForSchedule_counts_remaining_weekly_sessions()
    {
        var today = new DateOnly(2026, 10, 6); // Tuesday
        var schedule = new VaccineSchedule
        {
            ScheduleType = "Weekly",
            StartDate = new DateOnly(2026, 10, 5),
            EndDate = new DateOnly(2026, 10, 10),
            DaysOfWeek = "Monday,Wednesday,Friday",
            StartTime = "09:00",
            EndTime = "11:00"
        };

        // Remaining: Wed 7, Fri 9 → 2 × 18 = 36
        Assert.Equal(36, ScheduleStockPlanner.CommittedSeatsForSchedule(schedule, today));
    }
}
