using System.Globalization;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

/// <summary>
/// Soft schedule capacity vs inventory. Does not deduct vials — planning only.
/// Throughput matches the staff agent: floor(windowMinutes / 20) × patientsPerSlot.
/// </summary>
public static class ScheduleStockPlanner
{
    public const int SlotBandMinutes = 20;
    public const int PatientsPerSlot = 3;
    public const int EmergencyBufferDoses = 2;

    public static int CountTimeBands(string startTime, string endTime)
    {
        if (!TryParseTime(startTime, out var start) || !TryParseTime(endTime, out var end))
            return 0;

        if (end <= start)
            return 0;

        return (int)((end.ToTimeSpan() - start.ToTimeSpan()).TotalMinutes) / SlotBandMinutes;
    }

    public static int SeatsPerSession(string startTime, string endTime)
    {
        var bands = CountTimeBands(startTime, endTime);
        return bands <= 0 ? 0 : bands * PatientsPerSlot;
    }

    public static int SumPhysicalDoses(IEnumerable<Batch> batches, Vaccine vaccine)
    {
        var total = 0;
        foreach (var batch in batches)
        {
            if (batch.Status != BatchStatus.Active)
                continue;
            if (batch.ExpiryDate < DateTime.UtcNow)
                continue;
            if (!InventoryDoseHelper.HasUsableDose(batch))
                continue;
            total = checked(total + InventoryDoseHelper.AvailableDoseCount(batch, vaccine));
        }
        return total;
    }

    public static int FreePlanningDoses(int physicalDoses, int committedDoses, int emergencyBuffer = EmergencyBufferDoses)
    {
        var buffer = Math.Max(0, emergencyBuffer);
        return Math.Max(0, physicalDoses - Math.Max(0, committedDoses) - buffer);
    }

    public static int CountRemainingSessionDays(
        string scheduleType,
        DateOnly? specificDate,
        DateOnly? startDate,
        DateOnly? endDate,
        IReadOnlyList<string>? daysOfWeek,
        DateOnly today)
    {
        var isWeekly = string.Equals(scheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);
        if (!isWeekly)
        {
            if (!specificDate.HasValue || specificDate.Value < today)
                return 0;
            return 1;
        }

        if (!startDate.HasValue || !endDate.HasValue || endDate < startDate)
            return 0;

        var days = daysOfWeek ?? Array.Empty<string>();
        if (days.Count == 0)
            return 0;

        var cursor = startDate.Value < today ? today : startDate.Value;
        var last = endDate.Value;
        var count = 0;
        while (cursor <= last)
        {
            if (DayMatches(cursor, days))
                count++;
            cursor = cursor.AddDays(1);
        }
        return count;
    }

    public static int CommittedSeatsForSchedule(
        VaccineSchedule schedule,
        DateOnly today)
    {
        var seats = SeatsPerSession(schedule.StartTime, schedule.EndTime);
        if (seats <= 0)
            return 0;

        var days = SplitDays(schedule.DaysOfWeek);
        var sessions = CountRemainingSessionDays(
            schedule.ScheduleType,
            schedule.SpecificDate,
            schedule.StartDate,
            schedule.EndDate,
            days,
            today);
        return checked(sessions * seats);
    }

    /// <summary>
    /// Last weekly session day that still fits in freeDoses (inclusive).
    /// Null when even the first matching day cannot be funded.
    /// </summary>
    public static DateOnly? ComputeMaxEndDate(
        DateOnly startDate,
        IReadOnlyList<string> daysOfWeek,
        string startTime,
        string endTime,
        int freeDoses,
        DateOnly today)
    {
        var seats = SeatsPerSession(startTime, endTime);
        if (seats <= 0 || freeDoses < seats || daysOfWeek.Count == 0)
            return null;

        var cursor = startDate < today ? today : startDate;
        // Search window: enough days to exhaust free doses even at 1 session/day.
        var maxSessions = freeDoses / seats;
        var last = cursor.AddDays(Math.Max(maxSessions * 7 + 14, 60));

        DateOnly? lastAffordable = null;
        var remaining = freeDoses;
        while (cursor <= last)
        {
            if (DayMatches(cursor, daysOfWeek))
            {
                if (remaining < seats)
                    break;
                remaining -= seats;
                lastAffordable = cursor;
            }
            cursor = cursor.AddDays(1);
        }

        return lastAffordable;
    }

    public static bool CanCreateOneTime(int seatsPerSession, int freeDoses)
        => seatsPerSession > 0 && freeDoses >= seatsPerSession;

    public static bool CanCreateWeekly(
        DateOnly startDate,
        DateOnly endDate,
        IReadOnlyList<string> daysOfWeek,
        string startTime,
        string endTime,
        int freeDoses,
        DateOnly today,
        out DateOnly? maxEndDate)
    {
        maxEndDate = ComputeMaxEndDate(startDate, daysOfWeek, startTime, endTime, freeDoses, today);
        if (!maxEndDate.HasValue)
            return false;
        return endDate <= maxEndDate.Value;
    }

    public static bool DayMatches(DateOnly date, IReadOnlyList<string> daysOfWeek)
    {
        if (daysOfWeek.Count == 0)
            return false;

        var full = date.DayOfWeek.ToString(); // Monday
        var abbrev = full.Length >= 3 ? full[..3] : full;
        foreach (var raw in daysOfWeek)
        {
            var d = (raw ?? string.Empty).Trim();
            if (d.Length == 0)
                continue;
            if (string.Equals(d, full, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(d, abbrev, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    public static List<string> SplitDays(string? daysOfWeek)
    {
        if (string.IsNullOrWhiteSpace(daysOfWeek))
            return new List<string>();
        return daysOfWeek
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();
    }

    private static bool TryParseTime(string timeStr, out TimeOnly time)
    {
        time = default;
        if (string.IsNullOrWhiteSpace(timeStr))
            return false;

        var formats = new[] { "HH:mm", "H:mm", "hh:mm tt", "h:mm tt", "HH:mm:ss" };
        return TimeOnly.TryParseExact(timeStr.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out time) ||
               TimeOnly.TryParse(timeStr.Trim(), CultureInfo.InvariantCulture, out time);
    }
}
