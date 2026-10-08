using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IScheduleService
{
    Task<VaccineScheduleDto> CreateScheduleAsync(Guid hospitalUserId, CreateVaccineScheduleDto dto);
    Task<List<VaccineScheduleDto>> GetHospitalSchedulesAsync(Guid hospitalUserId);
    Task<bool> CancelScheduleAsync(Guid hospitalUserId, Guid scheduleId);
    Task<List<VaccineScheduleDto>> GetAvailableSchedulesAsync(Guid? hospitalUserId = null, string? vaccineName = null);
    Task<ScheduleStockHorizonDto> GetStockHorizonAsync(Guid hospitalUserId, ScheduleStockHorizonRequestDto dto);
}

public class ScheduleService : IScheduleService
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<ScheduleService> _logger;

    public ScheduleService(ApplicationDbContext context, ILogger<ScheduleService> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<VaccineScheduleDto> CreateScheduleAsync(Guid hospitalUserId, CreateVaccineScheduleDto dto)
    {
        var hospital = await _context.Users
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == hospitalUserId && u.Role == UserRole.HOSPITAL);

        if (hospital == null)
        {
            throw new UnauthorizedAccessException("Hospital account not found.");
        }

        var isWeekly = string.Equals(dto.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);

        if (isWeekly)
        {
            if (dto.DaysOfWeek == null || dto.DaysOfWeek.Count == 0)
            {
                throw new ArgumentException("Please select at least one day of the week for recurring schedules.");
            }
            if (!dto.StartDate.HasValue || !dto.EndDate.HasValue)
            {
                throw new ArgumentException("Start date and End date are required for weekly recurring schedules.");
            }
            if (dto.EndDate < dto.StartDate)
            {
                throw new ArgumentException("End date cannot be earlier than start date.");
            }
        }
        else
        {
            if (!dto.SpecificDate.HasValue)
            {
                throw new ArgumentException("Please specify a date for one-time schedules.");
            }
        }

        EnsureScheduleNotInPast(dto, isWeekly);

        var daysOfWeekJoined = (dto.DaysOfWeek != null && dto.DaysOfWeek.Count > 0)
            ? string.Join(",", dto.DaysOfWeek.Select(d => d.Trim()))
            : null;

        var booth = await _context.HospitalBooths
            .AsNoTracking()
            .Include(b => b.Vaccines)
                .ThenInclude(v => v.Vaccine)
            .FirstOrDefaultAsync(b =>
                b.Id == dto.BoothId &&
                b.HospitalUserId == hospitalUserId &&
                b.IsActive);

        if (booth == null)
        {
            throw new ArgumentException("Select an active booth that belongs to this hospital.");
        }

        var resolvedVaccineId = dto.VaccineId;
        var vaccineName = (dto.VaccineName ?? string.Empty).Trim();

        // Every booth states what it offers, so bookings and walk-in routing agree.
        if (booth.Vaccines.Count == 0)
        {
            throw new ArgumentException(
                $"Booth {booth.DisplayLabel} has no vaccines listed. Add the vaccines this booth offers in Booths first.");
        }

        var idMatch = resolvedVaccineId.HasValue
            && booth.Vaccines.Any(v => v.VaccineId == resolvedVaccineId.Value);

        if (!idMatch)
        {
            // Formulary sometimes sends the wrong GUID; recover by vaccine name on this booth.
            var nameMatch = booth.Vaccines.FirstOrDefault(v =>
                !string.IsNullOrWhiteSpace(v.Vaccine?.Name) &&
                string.Equals(v.Vaccine!.Name.Trim(), vaccineName, StringComparison.OrdinalIgnoreCase));

            if (nameMatch != null)
            {
                resolvedVaccineId = nameMatch.VaccineId;
            }
            else
            {
                throw new ArgumentException(
                    $"Booth {booth.DisplayLabel} does not offer this vaccine. " +
                    "Open Booths and add the vaccine to that booth, or pick a booth that already lists it."
                );
            }
        }

        await EnsureNoBoothSessionOverlapAsync(booth, dto, isWeekly);

        var horizon = await BuildStockHorizonAsync(
            hospitalUserId,
            hospital.HospitalProfile?.Id,
            new ScheduleStockHorizonRequestDto
            {
                VaccineId = resolvedVaccineId,
                VaccineName = vaccineName,
                ScheduleType = isWeekly ? "Weekly" : "OneTime",
                SpecificDate = isWeekly ? null : dto.SpecificDate,
                DaysOfWeek = isWeekly ? dto.DaysOfWeek : new List<string>(),
                StartDate = isWeekly ? dto.StartDate : null,
                EndDate = isWeekly ? dto.EndDate : null,
                StartTime = dto.StartTime,
                EndTime = dto.EndTime
            });

        if (!horizon.CanCreate)
        {
            throw new ArgumentException(horizon.Message);
        }

        // Fee comes from hospital formulary (one Free/Paid tag per vaccine) — not per schedule.
        var formularyPrice = 0.00m;
        if (hospital.HospitalProfile != null && resolvedVaccineId.HasValue)
        {
            var formulary = await _context.HospitalFormularies.AsNoTracking()
                .FirstOrDefaultAsync(f =>
                    f.HospitalProfileId == hospital.HospitalProfile.Id &&
                    f.VaccineId == resolvedVaccineId.Value);
            if (formulary == null)
            {
                throw new ArgumentException(
                    "This vaccine is not on your formulary with a Free/Paid fee. " +
                    "Open Inventory → Formulary, set the fee (0 = Free), then post the schedule.");
            }
            formularyPrice = Math.Max(0.00m, formulary.Price);
        }
        else if (!string.IsNullOrWhiteSpace(vaccineName) && hospital.HospitalProfile != null)
        {
            var formulary = await _context.HospitalFormularies.AsNoTracking()
                .Include(f => f.Vaccine)
                .Where(f => f.HospitalProfileId == hospital.HospitalProfile.Id)
                .ToListAsync();
            var match = formulary.FirstOrDefault(f =>
                f.Vaccine != null &&
                string.Equals(f.Vaccine.Name.Trim(), vaccineName, StringComparison.OrdinalIgnoreCase));
            if (match == null)
            {
                throw new ArgumentException(
                    "This vaccine is not on your formulary with a Free/Paid fee. " +
                    "Open Inventory → Formulary, set the fee (0 = Free), then post the schedule.");
            }
            formularyPrice = Math.Max(0.00m, match.Price);
            resolvedVaccineId ??= match.VaccineId;
        }

        var schedule = new VaccineSchedule
        {
            Id = Guid.NewGuid(),
            HospitalUserId = hospitalUserId,
            HospitalProfileId = hospital.HospitalProfile?.Id,
            BoothId = booth.Id,
            BoothLabel = booth.DisplayLabel,
            VaccineId = resolvedVaccineId,
            VaccineName = string.IsNullOrWhiteSpace(vaccineName)
                ? (dto.VaccineName ?? string.Empty).Trim()
                : vaccineName,
            ScheduleType = isWeekly ? "Weekly" : "OneTime",
            SpecificDate = isWeekly ? null : dto.SpecificDate,
            DaysOfWeek = isWeekly ? daysOfWeekJoined : null,
            StartDate = isWeekly ? dto.StartDate : null,
            EndDate = isWeekly ? dto.EndDate : null,
            StartTime = dto.StartTime.Trim(),
            EndTime = dto.EndTime.Trim(),
            Price = formularyPrice,
            Status = "Active",
            CreatedAt = DateTime.UtcNow
        };

        _context.VaccineSchedules.Add(schedule);
        await _context.SaveChangesAsync();

        _logger.LogInformation("Created {Type} schedule {ScheduleId} for hospital {HospitalName}", schedule.ScheduleType, schedule.Id, hospital.HospitalProfile?.HospitalName ?? hospital.Email);

        return MapToDto(schedule, hospital.HospitalProfile?.HospitalName ?? "Hospital");
    }

    public async Task<ScheduleStockHorizonDto> GetStockHorizonAsync(Guid hospitalUserId, ScheduleStockHorizonRequestDto dto)
    {
        var hospital = await _context.Users
            .Include(u => u.HospitalProfile)
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == hospitalUserId && u.Role == UserRole.HOSPITAL)
            ?? throw new UnauthorizedAccessException("Hospital account not found.");

        return await BuildStockHorizonAsync(
            hospitalUserId,
            hospital.HospitalProfile?.Id,
            dto);
    }

    public async Task<List<VaccineScheduleDto>> GetHospitalSchedulesAsync(Guid hospitalUserId)
    {
        var hospital = await _context.Users
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == hospitalUserId);

        var hospitalName = hospital?.HospitalProfile?.HospitalName ?? "Hospital";

        var schedules = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s => s.HospitalUserId == hospitalUserId && s.Status == "Active")
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();

        return schedules
            .Where(IsScheduleWindowStillOpen)
            .Select(s => MapToDto(s, hospitalName))
            .ToList();
    }

    public async Task<bool> CancelScheduleAsync(Guid hospitalUserId, Guid scheduleId)
    {
        var schedule = await _context.VaccineSchedules
            .FirstOrDefaultAsync(s => s.Id == scheduleId && s.HospitalUserId == hospitalUserId);

        if (schedule == null)
        {
            throw new KeyNotFoundException("Schedule slot not found.");
        }

        var today = StaffDutyHelper.HospitalToday();
        var blockingStatuses = new[] { "Cancelled", "Rejected" };

        var openAppointments = await _context.Appointments
            .AsNoTracking()
            .Where(a =>
                a.VaccineScheduleId == scheduleId &&
                a.AppointmentDate >= today &&
                !blockingStatuses.Contains(a.Status))
            .CountAsync();

        if (openAppointments > 0)
        {
            throw new InvalidOperationException(
                $"Cannot cancel this schedule: {openAppointments} upcoming appointment" +
                $"{(openAppointments == 1 ? "" : "s")} still linked to it. " +
                "Cancel or complete those appointments first.");
        }

        schedule.Status = "Cancelled";
        await _context.SaveChangesAsync();

        _logger.LogInformation("Cancelled schedule {ScheduleId} by hospital {HospitalUserId}", scheduleId, hospitalUserId);
        return true;
    }

    public async Task<List<VaccineScheduleDto>> GetAvailableSchedulesAsync(Guid? hospitalUserId = null, string? vaccineName = null)
    {
        var query = _context.VaccineSchedules
            .Include(s => s.HospitalUser!)
            .ThenInclude(h => h.HospitalProfile)
            .AsNoTracking()
            .Where(s => s.Status == "Active");

        if (hospitalUserId.HasValue)
        {
            var hId = hospitalUserId.Value;
            var hp = await _context.HospitalProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == hId || p.UserId == hId);
            var resUserId = hp?.UserId ?? hId;
            var resProfId = hp?.Id;

            query = query.Where(s => s.HospitalUserId == resUserId || (resProfId.HasValue && s.HospitalProfileId == resProfId.Value));
        }

        if (!string.IsNullOrWhiteSpace(vaccineName))
        {
            var vName = vaccineName.Trim().ToLowerInvariant();
            query = query.Where(s => s.VaccineName.ToLower().Contains(vName));
        }

        var schedules = await query.OrderByDescending(s => s.CreatedAt).ToListAsync();

        return schedules
            .Where(IsScheduleWindowStillOpen)
            .Select(s => MapToDto(s, s.HospitalUser?.HospitalProfile?.HospitalName ?? "Hospital"))
            .ToList();
    }

    private async Task<ScheduleStockHorizonDto> BuildStockHorizonAsync(
        Guid hospitalUserId,
        Guid? hospitalProfileId,
        ScheduleStockHorizonRequestDto dto)
    {
        var today = StaffDutyHelper.HospitalToday();
        var isWeekly = string.Equals(dto.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);
        var startTime = (dto.StartTime ?? string.Empty).Trim();
        var endTime = (dto.EndTime ?? string.Empty).Trim();
        var seats = ScheduleStockPlanner.SeatsPerSession(startTime, endTime);
        var bands = ScheduleStockPlanner.CountTimeBands(startTime, endTime);
        var days = dto.DaysOfWeek?.Where(d => !string.IsNullOrWhiteSpace(d)).Select(d => d.Trim()).ToList()
            ?? new List<string>();

        var profileId = hospitalProfileId;
        if (!profileId.HasValue)
        {
            profileId = await _context.HospitalProfiles.AsNoTracking()
                .Where(p => p.UserId == hospitalUserId)
                .Select(p => (Guid?)p.Id)
                .FirstOrDefaultAsync();
        }

        var vaccine = await ResolveVaccineForHospitalAsync(
            hospitalUserId, profileId, dto.VaccineId, dto.VaccineName);
        if (vaccine == null)
        {
            return new ScheduleStockHorizonDto
            {
                PhysicalDoses = 0,
                CommittedDoses = 0,
                EmergencyBufferDoses = ScheduleStockPlanner.EmergencyBufferDoses,
                FreeDoses = 0,
                TimeBandsPerSession = bands,
                PatientsPerSlot = ScheduleStockPlanner.PatientsPerSlot,
                SeatsPerSession = seats,
                ProposedDemandDoses = 0,
                MaxEndDate = null,
                CanCreate = false,
                Message = "Select a vaccine that exists in inventory before posting a schedule."
            };
        }

        if (seats <= 0)
        {
            return new ScheduleStockHorizonDto
            {
                PhysicalDoses = 0,
                CommittedDoses = 0,
                EmergencyBufferDoses = ScheduleStockPlanner.EmergencyBufferDoses,
                FreeDoses = 0,
                TimeBandsPerSession = bands,
                PatientsPerSlot = ScheduleStockPlanner.PatientsPerSlot,
                SeatsPerSession = 0,
                ProposedDemandDoses = 0,
                MaxEndDate = null,
                CanCreate = false,
                Message = "Clinic window must be at least 20 minutes (end time after start time)."
            };
        }

        var physical = 0;
        if (profileId.HasValue)
        {
            var vaccineNameKey = NormalizeVaccineName(vaccine.Name).ToLowerInvariant();
            var batches = await _context.Batches
                .AsNoTracking()
                .Include(b => b.Vaccine)
                .Where(b =>
                    b.HospitalProfileId == profileId.Value &&
                    b.Status == BatchStatus.Active)
                .ToListAsync();

            // Match by VaccineId OR normalized name so duplicate catalog rows still count stock.
            batches = batches
                .Where(b =>
                    b.VaccineId == vaccine.Id ||
                    (b.Vaccine != null &&
                     NormalizeVaccineName(b.Vaccine.Name).ToLowerInvariant() == vaccineNameKey))
                .ToList();

            physical = ScheduleStockPlanner.SumPhysicalDoses(batches, vaccine);
        }

        var siblingSchedules = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s =>
                s.Status == "Active" &&
                (s.HospitalUserId == hospitalUserId ||
                 (profileId.HasValue && s.HospitalProfileId == profileId.Value)))
            .ToListAsync();

        var committed = siblingSchedules
            .Where(s =>
                (s.VaccineId.HasValue && s.VaccineId == vaccine.Id) ||
                NamesLooselyMatch(s.VaccineName, vaccine.Name))
            .Sum(s => ScheduleStockPlanner.CommittedSeatsForSchedule(s, today));

        var free = ScheduleStockPlanner.FreePlanningDoses(physical, committed);
        var proposedSessions = ScheduleStockPlanner.CountRemainingSessionDays(
            isWeekly ? "Weekly" : "OneTime",
            isWeekly ? null : dto.SpecificDate,
            isWeekly ? dto.StartDate : null,
            isWeekly ? dto.EndDate : null,
            days,
            today);
        var proposedDemand = checked(proposedSessions * seats);

        DateOnly? maxEndDate = null;
        var canCreate = false;
        string message;
        var stockBreakdown =
            $"physical {physical} · reserved by other schedules {committed} · buffer {ScheduleStockPlanner.EmergencyBufferDoses} · free {free}";

        if (free < seats)
        {
            message = physical <= 0
                ? $"No usable {vaccine.Name} stock at this hospital ({stockBreakdown}). Restock before posting this clinic window."
                : $"Not enough free {vaccine.Name} for this window (needs {seats}/session). {stockBreakdown}. Restock, cancel overlapping schedules, or shorten the hours.";
        }
        else if (isWeekly)
        {
            if (!dto.StartDate.HasValue || !dto.EndDate.HasValue || days.Count == 0)
            {
                message = "Pick start/end dates and at least one weekday to estimate stock coverage.";
            }
            else
            {
                maxEndDate = ScheduleStockPlanner.ComputeMaxEndDate(
                    dto.StartDate.Value, days, startTime, endTime, free, today);
                canCreate = ScheduleStockPlanner.CanCreateWeekly(
                    dto.StartDate.Value, dto.EndDate.Value, days, startTime, endTime, free, today, out maxEndDate);
                message = canCreate
                    ? $"{stockBreakdown} · {seats}/session · stock covers until {maxEndDate:yyyy-MM-dd}."
                    : maxEndDate.HasValue
                        ? $"Stock only covers until {maxEndDate:yyyy-MM-dd} ({stockBreakdown}, {seats}/session). Pick an end date on or before that day."
                        : $"Not enough free {vaccine.Name} stock for even one session ({stockBreakdown}).";
            }
        }
        else
        {
            canCreate = ScheduleStockPlanner.CanCreateOneTime(seats, free) &&
                        dto.SpecificDate.HasValue &&
                        dto.SpecificDate.Value >= today;
            if (!dto.SpecificDate.HasValue)
            {
                message = "Pick a date for the one-time schedule.";
            }
            else if (dto.SpecificDate.Value < today)
            {
                message = "One-time schedule date cannot be in the past.";
                canCreate = false;
            }
            else if (!canCreate)
            {
                message = $"This day needs {seats} doses. {stockBreakdown}.";
            }
            else
            {
                maxEndDate = dto.SpecificDate;
                message = $"{stockBreakdown} · this day uses {seats}.";
            }
        }

        return new ScheduleStockHorizonDto
        {
            PhysicalDoses = physical,
            CommittedDoses = committed,
            EmergencyBufferDoses = ScheduleStockPlanner.EmergencyBufferDoses,
            FreeDoses = free,
            TimeBandsPerSession = bands,
            PatientsPerSlot = ScheduleStockPlanner.PatientsPerSlot,
            SeatsPerSession = seats,
            ProposedDemandDoses = proposedDemand,
            MaxEndDate = maxEndDate,
            CanCreate = canCreate,
            Message = message
        };
    }

    private async Task<Vaccine?> ResolveVaccineForHospitalAsync(
        Guid hospitalUserId,
        Guid? hospitalProfileId,
        Guid? vaccineId,
        string? vaccineName)
    {
        var profileId = hospitalProfileId;
        if (!profileId.HasValue)
        {
            profileId = await _context.HospitalProfiles.AsNoTracking()
                .Where(p => p.UserId == hospitalUserId)
                .Select(p => (Guid?)p.Id)
                .FirstOrDefaultAsync();
        }

        Vaccine? byId = null;
        if (vaccineId.HasValue)
        {
            byId = await _context.Vaccines.AsNoTracking()
                .FirstOrDefaultAsync(v => v.Id == vaccineId.Value);
        }

        var name = NormalizeVaccineName(vaccineName);
        Vaccine? byName = null;
        if (!string.IsNullOrWhiteSpace(name))
        {
            var candidates = await _context.Vaccines.AsNoTracking().ToListAsync();
            byName = candidates.FirstOrDefault(v =>
                         string.Equals(NormalizeVaccineName(v.Name), name, StringComparison.OrdinalIgnoreCase))
                     ?? candidates.FirstOrDefault(v => NamesLooselyMatch(v.Name, name));
        }

        if (profileId.HasValue)
        {
            var stockedIds = await _context.Batches.AsNoTracking()
                .Where(b =>
                    b.HospitalProfileId == profileId.Value &&
                    b.Status == BatchStatus.Active &&
                    (b.QuantityAvailable > 0 || (b.OpenVialDosesRemaining ?? 0) > 0) &&
                    b.ExpiryDate >= DateTime.UtcNow)
                .Select(b => b.VaccineId)
                .Distinct()
                .ToListAsync();

            if (byId != null && stockedIds.Contains(byId.Id))
                return byId;
            if (byName != null && stockedIds.Contains(byName.Id))
                return byName;

            if (!string.IsNullOrWhiteSpace(name))
            {
                var stockedVaccines = await _context.Vaccines.AsNoTracking()
                    .Where(v => stockedIds.Contains(v.Id))
                    .ToListAsync();
                var stockedMatch = stockedVaccines.FirstOrDefault(v => NamesLooselyMatch(v.Name, name));
                if (stockedMatch != null)
                    return stockedMatch;
            }
        }

        return byId ?? byName;
    }

    private static string NormalizeVaccineName(string? raw)
    {
        var name = (raw ?? string.Empty).Trim();
        if (name.Length == 0)
            return string.Empty;
        var open = name.LastIndexOf(" (", StringComparison.Ordinal);
        if (open > 0 && name.EndsWith(')'))
            name = name[..open].Trim();
        return name;
    }

    private static bool NamesLooselyMatch(string? a, string? b)
    {
        var left = NormalizeVaccineName(a).ToLowerInvariant();
        var right = NormalizeVaccineName(b).ToLowerInvariant();
        if (left.Length == 0 || right.Length == 0)
            return false;
        return left == right || left.Contains(right) || right.Contains(left);
    }

    private static VaccineScheduleDto MapToDto(VaccineSchedule s, string hospitalName)
    {
        var daysList = !string.IsNullOrWhiteSpace(s.DaysOfWeek)
            ? s.DaysOfWeek.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList()
            : new List<string>();

        var formattedTime = $"{FormatTime12h(s.StartTime)} - {FormatTime12h(s.EndTime)}";

        string displayRecurrence;
        if (s.ScheduleType == "Weekly")
        {
            var daysStr = daysList.Count > 0 ? string.Join(", ", daysList) : "Weekly";
            var rangeStr = (s.StartDate.HasValue && s.EndDate.HasValue)
                ? $" ({s.StartDate:MMM dd} - {s.EndDate:MMM dd, yyyy})"
                : "";
            displayRecurrence = $"Repeats {daysStr}{rangeStr}";
        }
        else
        {
            displayRecurrence = s.SpecificDate.HasValue
                ? s.SpecificDate.Value.ToString("yyyy-MM-dd")
                : "One-Time";
        }

        return new VaccineScheduleDto
        {
            Id = s.Id,
            HospitalUserId = s.HospitalUserId,
            HospitalName = hospitalName,
            BoothId = s.BoothId,
            BoothLabel = s.BoothLabel,
            VaccineId = s.VaccineId,
            VaccineName = s.VaccineName,
            ScheduleType = s.ScheduleType,
            SpecificDate = s.SpecificDate,
            DaysOfWeek = daysList,
            StartDate = s.StartDate,
            EndDate = s.EndDate,
            StartTime = s.StartTime,
            EndTime = s.EndTime,
            FormattedTime = formattedTime,
            DisplayRecurrence = displayRecurrence,
            Price = s.Price,
            FormattedPrice = s.Price <= 0 ? "Free (0 LKR)" : $"LKR {s.Price:N2}",
            Status = s.Status,
            CreatedAt = s.CreatedAt
        };
    }

    private static string FormatTime12h(string time24)
    {
        if (string.IsNullOrWhiteSpace(time24)) return string.Empty;
        if (DateTime.TryParseExact(time24, new[] { "HH:mm", "H:mm", "h:mm tt", "hh:mm tt" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
        {
            return dt.ToString("hh:mm tt");
        }
        return time24;
    }

    /// <summary>
    /// One booth runs one session at a time; otherwise its per-slot capacity silently doubles.
    /// </summary>
    private async Task EnsureNoBoothSessionOverlapAsync(HospitalBooth booth, CreateVaccineScheduleDto dto, bool isWeekly)
    {
        if (!TimeOnly.TryParse(dto.StartTime, out var newStart) || !TimeOnly.TryParse(dto.EndTime, out var newEnd))
            return;

        var newFrom = isWeekly ? dto.StartDate : dto.SpecificDate;
        var newTo = isWeekly ? dto.EndDate : dto.SpecificDate;
        if (newFrom == null || newTo == null)
            return;
        var newDays = isWeekly ? (dto.DaysOfWeek ?? new List<string>()) : new List<string>();

        var existing = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s => s.BoothId == booth.Id && s.Status == "Active")
            .ToListAsync();

        foreach (var other in existing)
        {
            if (!TimeOnly.TryParse(other.StartTime, out var otherStart) ||
                !TimeOnly.TryParse(other.EndTime, out var otherEnd) ||
                !(newStart < otherEnd && otherStart < newEnd))
            {
                continue;
            }

            var otherWeekly = string.Equals(other.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);
            var otherFrom = otherWeekly ? other.StartDate : other.SpecificDate;
            var otherTo = otherWeekly ? other.EndDate : other.SpecificDate;
            var otherDays = (other.DaysOfWeek ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            var from = otherFrom.HasValue && otherFrom.Value > newFrom.Value ? otherFrom.Value : newFrom.Value;
            var to = otherTo.HasValue && otherTo.Value < newTo.Value ? otherTo.Value : newTo.Value;
            for (var date = from; date <= to && date <= from.AddDays(370); date = date.AddDays(1))
            {
                if (RunsOnDay(isWeekly, newDays, date) && RunsOnDay(otherWeekly, otherDays, date))
                {
                    throw new ArgumentException(
                        $"Booth {booth.DisplayLabel} already runs {other.VaccineName} " +
                        $"{FormatTime12h(other.StartTime)} - {FormatTime12h(other.EndTime)} on {date:yyyy-MM-dd}. " +
                        "Pick another time or booth.");
                }
            }
        }
    }

    private static bool RunsOnDay(bool weekly, IEnumerable<string> days, DateOnly date)
    {
        if (!weekly) return true;
        var name = date.DayOfWeek.ToString();
        return days.Any(d =>
            string.Equals(d.Trim(), name, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(d.Trim(), name[..3], StringComparison.OrdinalIgnoreCase));
    }

    private static void EnsureScheduleNotInPast(CreateVaccineScheduleDto dto, bool isWeekly)
    {
        var today = StaffDutyHelper.HospitalToday();
        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());

        if (!TryParseScheduleTime(dto.StartTime, out var startTime) ||
            !TryParseScheduleTime(dto.EndTime, out var endTime))
        {
            throw new ArgumentException("Start time and end time must be valid times.");
        }

        if (endTime <= startTime)
        {
            throw new ArgumentException("End time must be after start time.");
        }

        if (isWeekly)
        {
            if (dto.EndDate.HasValue && dto.EndDate.Value < today)
            {
                throw new ArgumentException("Weekly schedule end date cannot be in the past.");
            }

            if (dto.StartDate.HasValue && dto.StartDate.Value < today)
            {
                throw new ArgumentException("Weekly schedule start date cannot be in the past. Use today or a future date.");
            }

            // Same-day weekly start: window must still be bookable for today's remaining hours.
            if (dto.StartDate.HasValue && dto.StartDate.Value == today && startTime < now)
            {
                throw new ArgumentException("Schedule start time cannot be in the past for today.");
            }
        }
        else
        {
            var date = dto.SpecificDate!.Value;
            if (date < today)
            {
                throw new ArgumentException("One-time schedule date cannot be in the past.");
            }

            if (date == today && startTime < now)
            {
                throw new ArgumentException("Schedule start time cannot be in the past for today.");
            }
        }
    }

    /// <summary>
    /// Active schedules whose clinic window has fully ended should not appear in lists.
    /// </summary>
    private static bool IsScheduleWindowStillOpen(VaccineSchedule s)
    {
        var today = StaffDutyHelper.HospitalToday();
        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());
        var isWeekly = string.Equals(s.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);
        _ = TryParseScheduleTime(s.EndTime, out var endTime);

        if (isWeekly)
        {
            if (!s.EndDate.HasValue) return true;
            if (s.EndDate.Value < today) return false;
            if (s.EndDate.Value == today && endTime != default && endTime <= now) return false;
            return true;
        }

        if (!s.SpecificDate.HasValue) return false;
        if (s.SpecificDate.Value < today) return false;
        if (s.SpecificDate.Value == today && endTime != default && endTime <= now) return false;
        return true;
    }

    private static bool TryParseScheduleTime(string? timeStr, out TimeOnly time)
    {
        time = default;
        if (string.IsNullOrWhiteSpace(timeStr)) return false;
        var formats = new[] { "HH:mm", "H:mm", "hh:mm tt", "h:mm tt", "HH:mm:ss" };
        return TimeOnly.TryParseExact(timeStr.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out time)
               || TimeOnly.TryParse(timeStr.Trim(), CultureInfo.InvariantCulture, out time);
    }
}
