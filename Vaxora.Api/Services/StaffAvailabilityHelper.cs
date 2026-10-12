using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

/// <summary>
/// When a hospital may use a doctor who works at several hospitals.
///
/// The primary hospital rosters freely. Every other hospital only gets the weekly
/// hours the doctor offered it; an affiliation with no hours set is unrestricted so
/// rosters created before availability existed keep working. An unavailable date
/// always blocks that day.
/// </summary>
public static class StaffAvailabilityHelper
{
    /// <summary>Minimum gap between shifts at two different hospitals.</summary>
    public static readonly TimeSpan TravelGap = TimeSpan.FromMinutes(30);

    /// <summary>How early or late a doctor may clock in around an offered window.</summary>
    public static readonly TimeSpan ClockInGrace = TimeSpan.FromMinutes(30);

    public sealed record Window(DayOfWeek Day, TimeOnly Start, TimeOnly End);

    public sealed record Rules(bool IsPrimary, List<Window> Windows, HashSet<DateOnly> UnavailableDates)
    {
        /// <summary>True when the weekly hours actually limit this affiliation.</summary>
        public bool HasWeeklyLimit => !IsPrimary && Windows.Count > 0;
    }

    public static async Task<Dictionary<Guid, Rules>> LoadAsync(
        ApplicationDbContext context,
        IReadOnlyCollection<Guid> affiliationIds,
        CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<Guid, Rules>();
        if (affiliationIds.Count == 0) return result;

        var affiliations = await context.StaffAffiliations
            .AsNoTracking()
            .Where(a => affiliationIds.Contains(a.Id))
            .Select(a => new { a.Id, a.IsPrimary })
            .ToListAsync(cancellationToken);

        var windows = await context.StaffAvailabilityWindows
            .AsNoTracking()
            .Where(w => affiliationIds.Contains(w.AffiliationId))
            .ToListAsync(cancellationToken);

        var dates = await context.StaffUnavailableDates
            .AsNoTracking()
            .Where(d => affiliationIds.Contains(d.AffiliationId))
            .ToListAsync(cancellationToken);

        foreach (var affiliation in affiliations)
        {
            result[affiliation.Id] = new Rules(
                affiliation.IsPrimary,
                windows
                    .Where(w => w.AffiliationId == affiliation.Id)
                    .OrderBy(w => w.DayOfWeek)
                    .ThenBy(w => w.StartTime)
                    .Select(w => new Window(w.DayOfWeek, w.StartTime, w.EndTime))
                    .ToList(),
                dates
                    .Where(d => d.AffiliationId == affiliation.Id)
                    .Select(d => d.Date)
                    .ToHashSet());
        }

        return result;
    }

    /// <summary>
    /// Why the slot is outside what the doctor offers this hospital, or null when it fits.
    /// </summary>
    public static string? Explain(Rules? rules, DateOnly date, TimeOnly start, TimeOnly end)
    {
        if (rules == null) return null;

        if (rules.UnavailableDates.Contains(date))
            return $"marked unavailable on {date:yyyy-MM-dd}";

        if (!rules.HasWeeklyLimit) return null;

        var day = date.DayOfWeek;
        var dayWindows = rules.Windows.Where(w => w.Day == day).ToList();
        if (dayWindows.Count == 0)
            return $"not available on {day}s";

        if (dayWindows.Any(w => w.Start <= start && w.End >= end))
            return null;

        var offered = string.Join(", ", dayWindows.Select(w => $"{w.Start:HH\\:mm}-{w.End:HH\\:mm}"));
        return $"only available {offered} on {day}s";
    }

    public static bool IsAvailable(Rules? rules, DateOnly date, TimeOnly start, TimeOnly end) =>
        Explain(rules, date, start, end) == null;

    /// <summary>True when the two same-day windows clash or leave less than the travel gap.</summary>
    public static bool WithinTravelGap(TimeOnly startA, TimeOnly endA, TimeOnly startB, TimeOnly endB) =>
        startA.ToTimeSpan() < endB.ToTimeSpan() + TravelGap &&
        startB.ToTimeSpan() < endA.ToTimeSpan() + TravelGap;
}
