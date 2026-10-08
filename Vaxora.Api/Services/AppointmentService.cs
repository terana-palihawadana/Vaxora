using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IAppointmentService
{
    Task<List<AvailableDateDto>> GetAvailableDatesAsync(Guid hospitalUserId, string vaccineName);
    Task<List<TimeSlotDto>> GetAvailableTimeSlotsAsync(Guid hospitalUserId, string vaccineName, DateOnly date);
    Task<AppointmentResponseDto> BookAppointmentAsync(Guid patientUserId, BookAppointmentRequestDto dto);
    Task<AppointmentResponseDto> CreateWalkInAppointmentAsync(Guid hospitalUserId, CreateWalkInAppointmentDto dto);
    Task<List<AppointmentResponseDto>> GetPatientAppointmentsAsync(Guid patientUserId);
    Task<List<AppointmentResponseDto>> GetHospitalAppointmentsAsync(Guid hospitalUserId, DateOnly? date = null, string? status = null);
    Task<List<AppointmentResponseDto>> GetStaffHospitalAppointmentsAsync(
        Guid staffUserId,
        Guid hospitalUserId,
        DateOnly? date = null);
    Task<StaffAppointmentPatientContactDto> GetStaffAppointmentPatientContactAsync(
        Guid staffUserId,
        Guid appointmentId);
    /// <summary>
    /// Update appointment status. Actor may be the owning hospital, or an active
    /// doctor/nurse affiliated with that hospital.
    /// </summary>
    Task<AppointmentResponseDto> UpdateAppointmentStatusAsync(Guid actorUserId, Guid appointmentId, UpdateAppointmentStatusDto dto);
    /// <summary>Marks a patient as arrived (hospital desk or affiliated staff), today only.</summary>
    Task<AppointmentResponseDto> CheckInAsync(Guid actorUserId, Guid appointmentId);
    Task<bool> CancelAppointmentAsync(Guid userId, string idOrRef, bool isHospital = false);
    Task<bool> CancelAppointmentAsync(Guid userId, Guid appointmentId, bool isHospital = false);
    Task<AppointmentResponseDto> ConfirmPayHerePaymentAsync(Guid appointmentId, string transactionId, string? orderId = null);
    Task<AefiReportResponseDto> ReportAefiAsync(Guid actorUserId, Guid appointmentId, ReportAefiDto dto);
}

public class AppointmentService : IAppointmentService
{
    /// <summary>
    /// Statuses a client may set through the status endpoint, mapped to their canonical
    /// casing. Status is stored as free text, so callers are matched case-insensitively
    /// and the stored value is normalised to keep equality checks elsewhere reliable.
    /// </summary>
    private static readonly Dictionary<string, string> AllowedStatusTransitions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["Confirmed"] = "Confirmed",
            ["Administering"] = "Administering",
            ["Observation"] = "Observation",
            ["Completed"] = "Completed",
            ["Cancelled"] = "Cancelled",
            ["Rejected"] = "Rejected",
        };

    /// <summary>
    /// Clinical session transitions that only doctors/nurses may perform (not hospital desk).
    /// Also used for payment-settled checks before administration.
    /// </summary>
    /// <summary>Minimum post-vaccination observation before discharge.</summary>
    private const int ObservationMinutes = 15;

    private static readonly HashSet<string> ClinicalSessionStatuses =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "Administering",
            "Observation",
            "Completed",
        };

    private readonly ApplicationDbContext _context;
    private readonly IEmailService _emailService;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IRegistrationNumberService _registrationNumberService;
    private readonly ILogger<AppointmentService> _logger;

    public AppointmentService(
        ApplicationDbContext context,
        IEmailService emailService,
        IPasswordHasher passwordHasher,
        IRegistrationNumberService registrationNumberService,
        ILogger<AppointmentService> logger)
    {
        _context = context;
        _emailService = emailService;
        _passwordHasher = passwordHasher;
        _registrationNumberService = registrationNumberService;
        _logger = logger;
    }

    public async Task<List<AvailableDateDto>> GetAvailableDatesAsync(Guid hospitalUserId, string vaccineName)
    {
        var vName = vaccineName.Trim().ToLowerInvariant();

        // Resolve hospital User ID (in case HospitalProfile.Id was passed instead of User.Id)
        var hospitalProfile = await _context.HospitalProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(hp => hp.Id == hospitalUserId || hp.UserId == hospitalUserId);

        var resolvedHospitalUserId = hospitalProfile?.UserId ?? hospitalUserId;
        var resolvedProfileId = hospitalProfile?.Id;

        var schedules = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s => (s.HospitalUserId == resolvedHospitalUserId || (resolvedProfileId != null && s.HospitalProfileId == resolvedProfileId)) &&
                        s.Status == "Active" &&
                        s.VaccineName.ToLower().Contains(vName))
            .ToListAsync();

        if (schedules.Count == 0)
        {
            // Fallback: check all active schedules for this hospital if vaccine matching is broad
            schedules = await _context.VaccineSchedules
                .AsNoTracking()
                .Where(s => (s.HospitalUserId == resolvedHospitalUserId || (resolvedProfileId != null && s.HospitalProfileId == resolvedProfileId)) && s.Status == "Active")
                .ToListAsync();
        }

        var today = StaffDutyHelper.HospitalToday();
        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());
        var maxLookahead = today.AddDays(60);
        var availableDates = new List<AvailableDateDto>();

        foreach (var schedule in schedules)
        {
            var isWeekly = string.Equals(schedule.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);

            if (!isWeekly)
            {
                // One-time schedule — skip fully elapsed windows
                if (schedule.SpecificDate.HasValue &&
                    schedule.SpecificDate.Value >= today &&
                    HasBookableRemainder(schedule.SpecificDate.Value, schedule.EndTime, today, now))
                {
                    var date = schedule.SpecificDate.Value;
                    var dayName = date.DayOfWeek.ToString();
                    var formattedTime = $"{FormatTime12h(schedule.StartTime)} - {FormatTime12h(schedule.EndTime)}";

                    availableDates.Add(new AvailableDateDto
                    {
                        Date = date.ToString("yyyy-MM-dd"),
                        DayOfWeek = dayName,
                        DisplayText = $"{date:yyyy-MM-dd} ({dayName}) - {formattedTime}",
                        BoothId = schedule.BoothId,
                        BoothLabel = schedule.BoothLabel,
                        StartTime = schedule.StartTime,
                        EndTime = schedule.EndTime,
                        ScheduleId = schedule.Id,
                        Price = schedule.Price,
                        FormattedPrice = schedule.Price <= 0 ? "Free" : $"LKR {schedule.Price:N2}"
                    });
                }
            }
            else
            {
                // Weekly recurring schedule
                var daysList = !string.IsNullOrWhiteSpace(schedule.DaysOfWeek)
                    ? schedule.DaysOfWeek.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    : Array.Empty<string>();

                var startDate = schedule.StartDate.HasValue && schedule.StartDate.Value > today
                    ? schedule.StartDate.Value
                    : today;

                var endDate = schedule.EndDate.HasValue && schedule.EndDate.Value < maxLookahead
                    ? schedule.EndDate.Value
                    : maxLookahead;

                if (endDate < startDate) continue;

                var formattedTime = $"{FormatTime12h(schedule.StartTime)} - {FormatTime12h(schedule.EndTime)}";

                for (var cur = startDate; cur <= endDate; cur = cur.AddDays(1))
                {
                    if (!HasBookableRemainder(cur, schedule.EndTime, today, now))
                        continue;

                    var dayName = cur.DayOfWeek.ToString();
                    var dayShort = dayName[..Math.Min(3, dayName.Length)];

                    var matchesDay = daysList.Any(d =>
                        string.Equals(d, dayName, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(d, dayShort, StringComparison.OrdinalIgnoreCase));

                    if (matchesDay)
                    {
                        availableDates.Add(new AvailableDateDto
                        {
                            Date = cur.ToString("yyyy-MM-dd"),
                            DayOfWeek = dayName,
                            DisplayText = $"{cur:yyyy-MM-dd} ({dayName}) - {formattedTime}",
                            BoothId = schedule.BoothId,
                            BoothLabel = schedule.BoothLabel,
                            StartTime = schedule.StartTime,
                            EndTime = schedule.EndTime,
                            ScheduleId = schedule.Id,
                            Price = schedule.Price,
                            FormattedPrice = schedule.Price <= 0 ? "Free" : $"LKR {schedule.Price:N2}"
                        });
                    }
                }
            }
        }

        // Return distinct dates ordered chronologically
        return availableDates
            .GroupBy(d => d.Date)
            .Select(g => g.First())
            .OrderBy(d => d.Date)
            .ToList();
    }

    /// <summary>False when the clinic window for this date has already ended.</summary>
    private static bool HasBookableRemainder(DateOnly date, string? endTimeStr, DateOnly today, TimeOnly now)
    {
        if (date < today) return false;
        if (date > today) return true;
        if (!TryParseTime(endTimeStr ?? string.Empty, out var endTime)) return true;
        // Need at least one 20-min band still available → last slot starts at end-20.
        var lastSlotStart = endTime.AddMinutes(-20);
        return lastSlotStart >= now;
    }

    public async Task<List<TimeSlotDto>> GetAvailableTimeSlotsAsync(Guid hospitalUserId, string vaccineName, DateOnly date)
    {
        var dayName = date.DayOfWeek.ToString();
        var dayShort = dayName[..Math.Min(3, dayName.Length)];

        // Resolve hospital User ID (in case HospitalProfile.Id was passed instead of User.Id)
        var hospitalProfile = await _context.HospitalProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(hp => hp.Id == hospitalUserId || hp.UserId == hospitalUserId);

        var resolvedHospitalUserId = hospitalProfile?.UserId ?? hospitalUserId;
        var resolvedProfileId = hospitalProfile?.Id;

        var vName = vaccineName.Trim().ToLowerInvariant();
        var schedules = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s => (s.HospitalUserId == resolvedHospitalUserId || (resolvedProfileId != null && s.HospitalProfileId == resolvedProfileId)) &&
                        s.Status == "Active" &&
                        (string.IsNullOrWhiteSpace(vName) || s.VaccineName.ToLower().Contains(vName)))
            .ToListAsync();

        // Filter schedules matching this date
        var matchingSchedules = schedules.Where(s =>
        {
            var isWeekly = string.Equals(s.ScheduleType, "Weekly", StringComparison.OrdinalIgnoreCase);
            if (!isWeekly)
            {
                return s.SpecificDate == date;
            }
            else
            {
                if (s.StartDate.HasValue && date < s.StartDate.Value) return false;
                if (s.EndDate.HasValue && date > s.EndDate.Value) return false;

                var daysList = !string.IsNullOrWhiteSpace(s.DaysOfWeek)
                    ? s.DaysOfWeek.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    : Array.Empty<string>();

                return daysList.Any(d =>
                    string.Equals(d, dayName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(d, dayShort, StringComparison.OrdinalIgnoreCase));
            }
        }).ToList();

        if (matchingSchedules.Count == 0)
        {
            return new List<TimeSlotDto>();
        }

        // Fetch already booked appointments for this hospital and date (not cancelled)
        var bookedAppointments = await _context.Appointments
            .AsNoTracking()
            .Where(a => (a.HospitalUserId == resolvedHospitalUserId || (resolvedProfileId != null && a.HospitalProfileId == resolvedProfileId)) &&
                        a.AppointmentDate == date &&
                        a.Status != "Cancelled" &&
                        a.Status != "Rejected")
            .ToListAsync();

        var capacity = ScheduleStockPlanner.PatientsPerSlot;
        var slots = new List<TimeSlotDto>();
        var today = StaffDutyHelper.HospitalToday();
        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());

        if (date < today)
        {
            return new List<TimeSlotDto>();
        }

        foreach (var sch in matchingSchedules)
        {
            var scheduleSlots = Generate20MinSlots(sch.StartTime, sch.EndTime);
            var scheduleBookedCounts = bookedAppointments
                .Where(a => a.VaccineScheduleId == sch.Id || (a.VaccineScheduleId == null && string.Equals(a.VaccineName, sch.VaccineName, StringComparison.OrdinalIgnoreCase)))
                .GroupBy(a => a.TimeSlot.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

            foreach (var slot in scheduleSlots)
            {
                // Hide slots that already started (or finished starting) for today.
                if (date == today &&
                    TryParseTime(slot.StartTime, out var slotStart) &&
                    slotStart < now)
                {
                    continue;
                }

                scheduleBookedCounts.TryGetValue(slot.Slot, out var count);
                slot.Capacity = capacity;
                slot.BookedCount = count;
                slot.IsBooked = count >= capacity;
                slots.Add(slot);
            }
        }

        return slots
            .GroupBy(s => s.Slot)
            .Select(g => g.FirstOrDefault(slot => !slot.IsBooked) ?? g.First())
            .OrderBy(s => s.StartTime)
            .ToList();
    }

    private async Task InsertWithinSlotCapacityAsync(Appointment appointment, int slotCapacity)
    {
        if (!_context.Database.IsNpgsql())
        {
            _context.Appointments.Add(appointment);
            await _context.SaveChangesAsync();
            return;
        }

        var targetScheduleId = appointment.VaccineScheduleId;
        var lockKey = targetScheduleId.HasValue
            ? $"slot:{appointment.HospitalUserId}:{targetScheduleId.Value}:{appointment.AppointmentDate:yyyyMMdd}:{appointment.TimeSlot}"
            : $"slot:{appointment.HospitalUserId}:{appointment.AppointmentDate:yyyyMMdd}:{appointment.TimeSlot}";

        var strategy = _context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            await _context.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))");

            var booked = await _context.Appointments
                .CountAsync(a => a.HospitalUserId == appointment.HospitalUserId &&
                                 (targetScheduleId != null ? a.VaccineScheduleId == targetScheduleId : true) &&
                                 a.AppointmentDate == appointment.AppointmentDate &&
                                 a.TimeSlot == appointment.TimeSlot &&
                                 a.Status != "Cancelled" &&
                                 a.Status != "Rejected");
            if (booked >= slotCapacity)
            {
                throw new InvalidOperationException(
                    $"The slot '{appointment.TimeSlot}' on {appointment.AppointmentDate:yyyy-MM-dd} is full " +
                    $"({slotCapacity} patients). Please select a different time slot.");
            }

            if (_context.Entry(appointment).State == EntityState.Detached)
            {
                _context.Appointments.Add(appointment);
            }
            await _context.SaveChangesAsync();
            await tx.CommitAsync();
        });
    }

    public async Task<AppointmentResponseDto> BookAppointmentAsync(Guid patientUserId, BookAppointmentRequestDto dto)
    {
        var patient = await _context.Users
            .Include(u => u.PatientProfile)
            .FirstOrDefaultAsync(u => u.Id == patientUserId);

        if (patient == null)
        {
            throw new UnauthorizedAccessException("Patient account not found.");
        }

        var hospital = await _context.Users
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => (u.Id == dto.HospitalUserId || (u.HospitalProfile != null && u.HospitalProfile.Id == dto.HospitalUserId)) && u.Role == UserRole.HOSPITAL);

        if (hospital == null)
        {
            throw new KeyNotFoundException("Selected hospital not found.");
        }

        var resolvedHospitalUserId = hospital.Id;

        EnsureAppointmentNotInPast(dto.AppointmentDate, dto.TimeSlot);

        // Find matching active schedule for doctor/nurse attribution, window validation, and fee calculation
        VaccineSchedule? schedule = null;
        var vName = dto.VaccineName.Trim().ToLowerInvariant();

        // 1. First priority: match exact schedule ID if provided
        if (dto.VaccineScheduleId.HasValue && dto.VaccineScheduleId.Value != Guid.Empty)
        {
            schedule = await _context.VaccineSchedules
                .FirstOrDefaultAsync(s => s.Id == dto.VaccineScheduleId.Value && s.Status == "Active");

            if (schedule == null || (schedule.HospitalUserId != resolvedHospitalUserId &&
                (hospital.HospitalProfile == null || schedule.HospitalProfileId != hospital.HospitalProfile.Id)))
            {
                throw new InvalidOperationException("The specified vaccine schedule does not belong to the selected hospital or is not active.");
            }
        }

        // 2. Second priority: match schedule by hospital, matching vaccine name, and date/recurrence
        if (schedule == null)
        {
            var dayName = dto.AppointmentDate.DayOfWeek.ToString();
            var dayShort = dayName[..Math.Min(3, dayName.Length)];

            schedule = await _context.VaccineSchedules
                .FirstOrDefaultAsync(s => (s.HospitalUserId == resolvedHospitalUserId || (hospital.HospitalProfile != null && s.HospitalProfileId == hospital.HospitalProfile.Id)) &&
                                          s.Status == "Active" &&
                                          (s.VaccineName.ToLower() == vName || s.VaccineName.ToLower().Contains(vName)) &&
                                          (s.SpecificDate == dto.AppointmentDate ||
                                           (s.ScheduleType == "Weekly" && s.DaysOfWeek != null &&
                                            (s.DaysOfWeek.Contains(dayName) || s.DaysOfWeek.Contains(dayShort)))));
        }

        // 3. Fallback: match any active schedule for this hospital and vaccine name
        if (schedule == null)
        {
            schedule = await _context.VaccineSchedules
                .FirstOrDefaultAsync(s => (s.HospitalUserId == resolvedHospitalUserId || (hospital.HospitalProfile != null && s.HospitalProfileId == hospital.HospitalProfile.Id)) &&
                                          s.Status == "Active" &&
                                          (s.VaccineName.ToLower() == vName || s.VaccineName.ToLower().Contains(vName)));
        }

        // Validate that requested time slot falls inside the clinic session window if schedule exists
        if (schedule != null && !string.IsNullOrWhiteSpace(schedule.StartTime) && !string.IsNullOrWhiteSpace(schedule.EndTime))
        {
            var validSlots = Generate20MinSlots(schedule.StartTime, schedule.EndTime);
            if (!validSlots.Any(s => string.Equals(s.Slot, dto.TimeSlot.Trim(), StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException(
                    $"The selected time slot '{dto.TimeSlot}' is outside the scheduled clinic window ({schedule.StartTime} - {schedule.EndTime}) or invalid.");
            }
        }

        // Capacity: up to PatientsPerSlot concurrent patients per 20-minute band per session
        var targetScheduleId = schedule?.Id ?? (dto.VaccineScheduleId.HasValue && dto.VaccineScheduleId.Value != Guid.Empty ? dto.VaccineScheduleId.Value : (Guid?)null);
        var slotCapacity = ScheduleStockPlanner.PatientsPerSlot;
        var existingInSlot = await _context.Appointments
            .CountAsync(a => a.HospitalUserId == resolvedHospitalUserId &&
                             (targetScheduleId != null ? a.VaccineScheduleId == targetScheduleId : true) &&
                             a.AppointmentDate == dto.AppointmentDate &&
                             a.TimeSlot == dto.TimeSlot.Trim() &&
                             a.Status != "Cancelled" &&
                             a.Status != "Rejected");

        if (existingInSlot >= slotCapacity)
        {
            throw new InvalidOperationException(
                $"The slot '{dto.TimeSlot}' on {dto.AppointmentDate:yyyy-MM-dd} is full " +
                $"({slotCapacity} patients). Please select a different time slot.");
        }

        var patientName = patient.PatientProfile?.FullName;
        if (string.IsNullOrWhiteSpace(patientName))
        {
            patientName = patient.Email;
        }

        var hospitalName = hospital.HospitalProfile?.HospitalName ?? "Hospital Center";

        var scheduleFee = schedule?.Price ?? 0.00m;
        var isFree = scheduleFee <= 0;

        string appointmentStatus;
        string paymentMethod;
        string paymentStatus;

        if (isFree)
        {
            appointmentStatus = "Confirmed";
            paymentMethod = "Free";
            paymentStatus = "Paid";
        }
        else
        {
            // Paid appointments require portal card payment (PayHere)
            appointmentStatus = "PendingPayment";
            paymentMethod = "PayHere";
            paymentStatus = "PendingOnline";
        }

        var appointment = new Appointment
        {
            Id = Guid.NewGuid(),
            PatientUserId = patientUserId,
            PatientProfileId = patient.PatientProfile?.Id,
            PatientName = patientName,
            PatientNic = patient.PatientProfile?.NicNumber,
            PatientPhone = patient.PatientProfile?.PhoneNumber ?? patient.PhoneNumber,
            PatientEmail = patient.Email,
            HospitalUserId = resolvedHospitalUserId,
            HospitalProfileId = hospital.HospitalProfile?.Id,
            HospitalName = hospitalName,
            VaccineScheduleId = schedule?.Id ?? dto.VaccineScheduleId,
            VaccineId = schedule?.VaccineId ?? dto.VaccineId,
            VaccineName = dto.VaccineName.Trim(),
            AppointmentDate = dto.AppointmentDate,
            TimeSlot = dto.TimeSlot.Trim(),
            Status = appointmentStatus,
            Fee = isFree ? 0.00m : scheduleFee,
            PaymentMethod = paymentMethod,
            PaymentStatus = paymentStatus,
            Notes = BuildBookingNotes(dto.Notes, schedule?.BoothLabel),
            CreatedAt = DateTime.UtcNow
        };

        await InsertWithinSlotCapacityAsync(appointment, slotCapacity);

        _logger.LogInformation("Appointment {AppId} created for Patient {Patient} at {Hospital} on {Date} ({Slot}) - Status: {Status}, Fee: {Fee}, PaymentMethod: {PaymentMethod}",
            appointment.Id, appointment.PatientName, appointment.HospitalName, appointment.AppointmentDate, appointment.TimeSlot, appointment.Status, appointment.Fee, appointment.PaymentMethod);

        // Send booking confirmation email immediately ONLY if appointment is Confirmed (Free)
        // If PayHere, confirmation email is sent ONLY upon successful payment!
        if (appointment.Status == "Confirmed" && !string.IsNullOrWhiteSpace(patient.Email))
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendAppointmentBookingConfirmationEmailAsync(
                        patient.Email,
                        appointment.PatientName,
                        appointment.VaccineName,
                        appointment.HospitalName,
                        appointment.AppointmentDate.ToString("dddd, dd MMMM yyyy"),
                        appointment.TimeSlot,
                        appointment.DoctorName,
                        appointment.NurseName,
                        appointment.Notes,
                        appointment.Fee,
                        appointment.PaymentMethod,
                        appointment.PaymentStatus);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send booking confirmation email to {Email} for appointment {AppId}", patient.Email, appointment.Id);
                }
            });
        }

        return MapToDto(appointment);
    }

    public async Task<AppointmentResponseDto> CreateWalkInAppointmentAsync(Guid hospitalUserId, CreateWalkInAppointmentDto dto)
    {
        var hospital = await _context.Users
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == hospitalUserId && u.Role == UserRole.HOSPITAL)
            ?? throw new UnauthorizedAccessException("Hospital account not found.");

        var nic = dto.PatientNic.Trim();
        if (string.IsNullOrWhiteSpace(nic))
            throw new InvalidOperationException("Patient NIC is required.");

        var vaccineName = dto.VaccineName.Trim();
        if (string.IsNullOrWhiteSpace(vaccineName))
            throw new InvalidOperationException("Vaccine name is required.");

        var presentedName = (dto.PatientName ?? string.Empty).Trim();

        // Link existing patient by NIC, or auto-provision a patient account for history/records.
        var patient = await _context.Users
            .Include(u => u.PatientProfile)
            .FirstOrDefaultAsync(u =>
                u.Role == UserRole.PATIENT &&
                u.PatientProfile != null &&
                u.PatientProfile.NicNumber == nic);

        var createdAccount = false;
        if (patient?.PatientProfile == null)
        {
            if (string.IsNullOrWhiteSpace(presentedName))
                throw new InvalidOperationException("Patient full name is required to create a walk-in account.");

            var email = (dto.PatientEmail ?? string.Empty).Trim().ToLowerInvariant();
            var phone = (dto.PatientPhone ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(email))
                throw new InvalidOperationException("Patient email is required to create a walk-in account.");
            if (string.IsNullOrWhiteSpace(phone))
                throw new InvalidOperationException("Patient phone is required to create a walk-in account.");

            (patient, _) = await CreateWalkInPatientAccountAsync(nic, presentedName, dto.Age, email, phone);
            createdAccount = true;
        }
        else
        {
            // Refresh contact details on the linked profile when the desk captures newer data.
            var phone = (dto.PatientPhone ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(phone))
            {
                patient.PhoneNumber = phone;
                patient.PatientProfile!.PhoneNumber = phone;
            }

            var email = (dto.PatientEmail ?? string.Empty).Trim().ToLowerInvariant();
            if (!string.IsNullOrWhiteSpace(email) &&
                !string.Equals(patient.Email, email, StringComparison.OrdinalIgnoreCase) &&
                !await _context.Users.AnyAsync(u => u.Email == email && u.Id != patient.Id))
            {
                patient.Email = email;
            }
        }

        var resolvedName = string.IsNullOrWhiteSpace(presentedName)
            ? patient.PatientProfile!.FullName
            : presentedName;

        // Already booked today for this vaccine: check in that booking instead of
        // queueing the patient twice. A different vaccine still gets its own walk-in.
        if (!createdAccount)
        {
            var hospitalDay = StaffDutyHelper.HospitalToday();
            var wantedVaccine = vaccineName.ToLowerInvariant();
            var todaysBookings = await _context.Appointments
                .Include(a => a.VaccineSchedule)
                .Where(a =>
                    a.HospitalUserId == hospital.Id &&
                    a.PatientUserId == patient.Id &&
                    a.AppointmentDate == hospitalDay &&
                    (a.Status == "Confirmed" || a.Status == "PendingPayment"))
                .ToListAsync();
            var existing = todaysBookings.FirstOrDefault(a =>
            {
                var booked = (a.VaccineName ?? string.Empty).Trim().ToLowerInvariant();
                return booked.Length > 0 && (booked == wantedVaccine || booked.Contains(wantedVaccine) || wantedVaccine.Contains(booked));
            });
            if (existing != null)
            {
                if (existing.CheckedInAt == null)
                {
                    existing.CheckedInAt = DateTime.UtcNow;
                    existing.CheckedInByUserId = hospital.Id;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
                await _context.SaveChangesAsync();
                var matched = MapToDto(existing);
                matched.MatchedExistingBooking = true;
                return matched;
            }
        }

        var hospitalNow = DateTime.UtcNow.AddHours(5.5);
        var today = DateOnly.FromDateTime(hospitalNow);
        var start = new TimeOnly(hospitalNow.Hour, hospitalNow.Minute);
        var end = start.AddMinutes(20);
        var timeSlot = $"{FormatTime12h(start)} - {FormatTime12h(end)}";

        // Avoid exact slot collisions for concurrent walk-ins.
        while (await _context.Appointments.AnyAsync(a =>
                   a.HospitalUserId == hospital.Id &&
                   a.AppointmentDate == today &&
                   a.TimeSlot == timeSlot &&
                   a.Status != "Cancelled" &&
                   a.Status != "Rejected"))
        {
            start = start.AddMinutes(1);
            end = start.AddMinutes(20);
            timeSlot = $"{FormatTime12h(start)} - {FormatTime12h(end)}";
        }

        var (boothId, boothLabel) = await ResolveWalkInBoothAsync(hospital.Id, vaccineName, dto.BoothLabel);

        var vName = vaccineName.ToLowerInvariant();
        var hospitalProfileId = hospital.HospitalProfile?.Id;
        var scheduleQuery = _context.VaccineSchedules
            .Where(s =>
                s.Status == "Active" &&
                (s.HospitalUserId == hospital.Id ||
                 (hospitalProfileId != null && s.HospitalProfileId == hospitalProfileId)) &&
                (s.VaccineName.ToLower() == vName || s.VaccineName.ToLower().Contains(vName)));
        // Prefer the session running at the assigned booth so vaccine and booth agree.
        var schedule = (boothId.HasValue
                ? await scheduleQuery.FirstOrDefaultAsync(s => s.BoothId == boothId)
                : null)
            ?? await scheduleQuery.FirstOrDefaultAsync();

        // Walk-ins pay the same hospital price as booked patients (formulary price,
        // falling back to the session price). Priced walk-ins wait for desk payment.
        var walkInFee = await ResolveWalkInFeeAsync(hospital, vaccineName, schedule);
        var walkInIsFree = walkInFee <= 0;

        var noteParts = new List<string>
        {
            createdAccount
                ? "Walk-in registration (patient account auto-created)"
                : "Walk-in registration"
        };
        // The desk records which dose in the series this is; the dosage itself must be
        // prescribed by a doctor, so the walk-in waits in the queue as "awaiting prescription".
        if (!string.IsNullOrWhiteSpace(dto.Dose)) noteParts.Add($"Dose sequence: {dto.Dose.Trim()}");
        if (dto.Age.HasValue) noteParts.Add($"Age: {dto.Age.Value}");
        if (!string.IsNullOrWhiteSpace(dto.Gender)) noteParts.Add($"Gender: {dto.Gender.Trim()}");
        if (!createdAccount &&
            !string.IsNullOrWhiteSpace(presentedName) &&
            !string.Equals(presentedName, patient.PatientProfile!.FullName, StringComparison.OrdinalIgnoreCase))
        {
            noteParts.Add($"Presented as: {presentedName}");
        }
        // Keep Booth last: booth labels contain " · ", and ExtractBoothFromNotes reads to end of line.
        if (!string.IsNullOrWhiteSpace(boothLabel)) noteParts.Add($"Booth: {boothLabel}");

        var appointment = new Appointment
        {
            Id = Guid.NewGuid(),
            PatientUserId = patient.Id,
            PatientProfileId = patient.PatientProfile!.Id,
            PatientName = resolvedName,
            PatientNic = patient.PatientProfile.NicNumber,
            PatientPhone = patient.PatientProfile.PhoneNumber ?? patient.PhoneNumber ?? (dto.PatientPhone ?? string.Empty).Trim(),
            PatientEmail = patient.Email,
            HospitalUserId = hospital.Id,
            HospitalProfileId = hospital.HospitalProfile?.Id,
            HospitalName = hospital.HospitalProfile?.HospitalName ?? "Hospital Center",
            VaccineScheduleId = schedule?.Id,
            VaccineId = schedule?.VaccineId,
            VaccineName = vaccineName,
            AppointmentDate = today,
            TimeSlot = timeSlot,
            StartTime = start.ToString("HH:mm"),
            EndTime = end.ToString("HH:mm"),
            Status = walkInIsFree ? "Confirmed" : "PendingPayment",
            Fee = walkInIsFree ? 0.00m : walkInFee,
            PaymentMethod = "WalkIn",
            PaymentStatus = walkInIsFree ? "Paid" : "Pending",
            CheckedInAt = DateTime.UtcNow,
            CheckedInByUserId = hospital.Id,
            Notes = string.Join(" · ", noteParts),
            CreatedAt = DateTime.UtcNow
        };

        _context.Appointments.Add(appointment);
        await _context.SaveChangesAsync();

        _logger.LogInformation(
            "Walk-in appointment {AppId} created for {Patient} (NIC {Nic}, newAccount={Created}) at hospital {Hospital}",
            appointment.Id, appointment.PatientName, nic, createdAccount, appointment.HospitalName);

        return MapToDto(appointment);
    }

    /// <summary>
    /// Provisions a PATIENT user + profile for desk walk-ins using the real email/phone
    /// collected at the counter so vaccination history and contact data stay accurate.
    /// </summary>
    private async Task<(User user, PatientProfile profile)> CreateWalkInPatientAccountAsync(
        string nic,
        string fullName,
        int? age,
        string email,
        string phone)
    {
        if (await _context.Users.AnyAsync(u => u.Email == email))
        {
            throw new InvalidOperationException(
                $"An account with email '{email}' already exists. Use that patient's NIC, or a different email.");
        }

        if (await _context.PatientProfiles.AnyAsync(p => p.NicNumber == nic.Trim()))
        {
            throw new InvalidOperationException(
                "A patient profile with this NIC already exists but could not be linked. Check the NIC and try again.");
        }

        var regNumber = await _registrationNumberService.GenerateRegistrationNumberAsync(UserRole.PATIENT);
        // Desk walk-in default password = NIC / national ID (patient is reminded on login).
        var defaultPassword = nic.Trim();

        DateTime? dateOfBirth = null;
        if (age is >= 0 and <= 120)
        {
            dateOfBirth = DateTime.SpecifyKind(
                DateTime.UtcNow.Date.AddYears(-age.Value),
                DateTimeKind.Utc);
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            PasswordHash = _passwordHasher.HashPassword(defaultPassword),
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            PhoneNumber = phone,
            RegistrationNumber = regNumber,
            CreatedAt = DateTime.UtcNow
        };

        var profile = new PatientProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FullName = fullName.Trim(),
            NicNumber = nic.Trim(),
            DateOfBirth = dateOfBirth,
            PhoneNumber = phone,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        _context.PatientProfiles.Add(profile);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = user.Id,
            UserEmail = user.Email,
            Role = "PATIENT",
            Action = "PATIENT_WALKIN_PROVISION",
            Details =
                $"Auto-created patient account from hospital walk-in (NIC {profile.NicNumber}, email {email}, Reg #{regNumber}). Default password set to NIC.",
            Timestamp = DateTime.UtcNow
        });

        user.PatientProfile = profile;
        return (user, profile);
    }

    public async Task<List<AppointmentResponseDto>> GetPatientAppointmentsAsync(Guid patientUserId)
    {
        var appointments = await _context.Appointments
            .AsNoTracking()
            .Include(a => a.VaccineSchedule)
            .Include(a => a.PatientUser)
                .ThenInclude(u => u!.PatientProfile)
            .Where(a => a.PatientUserId == patientUserId)
            .OrderByDescending(a => a.AppointmentDate)
            .ThenByDescending(a => a.CreatedAt)
            .ToListAsync();

        return appointments.Select(MapToDto).ToList();
    }

    public async Task<List<AppointmentResponseDto>> GetHospitalAppointmentsAsync(Guid hospitalUserId, DateOnly? date = null, string? status = null)
    {
        var hospitalProfileId = await _context.HospitalProfiles
            .AsNoTracking()
            .Where(h => h.UserId == hospitalUserId)
            .Select(h => (Guid?)h.Id)
            .FirstOrDefaultAsync();

        var query = _context.Appointments
            .AsNoTracking()
            .Include(a => a.VaccineSchedule)
            .Include(a => a.PatientUser)
                .ThenInclude(u => u!.PatientProfile)
            .Where(a =>
                a.HospitalUserId == hospitalUserId ||
                (hospitalProfileId.HasValue && a.HospitalProfileId == hospitalProfileId.Value));

        if (date.HasValue)
        {
            query = query.Where(a => a.AppointmentDate == date.Value);
        }

        if (!string.IsNullOrWhiteSpace(status) && !string.Equals(status, "All", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(a => a.Status.ToLower() == status.ToLower());
        }

        var appointments = await query
            .OrderBy(a => a.AppointmentDate)
            .ThenBy(a => a.TimeSlot)
            .ToListAsync();

        return appointments.Select(MapToDto).ToList();
    }

    public async Task<List<AppointmentResponseDto>> GetStaffHospitalAppointmentsAsync(
        Guid staffUserId,
        Guid hospitalUserId,
        DateOnly? date = null)
    {
        var staff = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == staffUserId);
        if (staff == null || staff.Role is not (UserRole.DOCTOR or UserRole.NURSE))
            throw new UnauthorizedAccessException("Only doctors or nurses can view staff hospital appointments.");

        if (staff.Status != UserStatus.Active)
            throw new InvalidOperationException("Staff account must be Active.");

        var isAffiliated = await _context.StaffAffiliations.AsNoTracking().AnyAsync(a =>
            a.StaffUserId == staffUserId &&
            a.HospitalUserId == hospitalUserId &&
            a.Status == AffiliationStatus.Active);

        if (!isAffiliated)
            throw new UnauthorizedAccessException("You are not affiliated with this hospital.");

        // Clinical floor list is session-scoped: hospital-local today only (±1 day).
        // Broader history remains on hospital/admin appointment screens.
        var hospitalToday = StaffDutyHelper.HospitalToday();
        var sessionDate = date ?? hospitalToday;
        var earliest = hospitalToday.AddDays(-1);
        var latest = hospitalToday.AddDays(1);
        if (sessionDate < earliest || sessionDate > latest)
        {
            throw new InvalidOperationException(
                $"Clinical queue is limited to today's hospital session ({hospitalToday:yyyy-MM-dd}) ± 1 day. Use hospital appointments for wider history.");
        }

        var appointments = await _context.Appointments
            .AsNoTracking()
            .Include(a => a.VaccineSchedule)
            .Include(a => a.PatientUser)
                .ThenInclude(u => u!.PatientProfile)
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.Status != "Cancelled" &&
                a.Status != "Rejected" &&
                a.AppointmentDate == sessionDate)
            .OrderBy(a => a.AppointmentDate)
            .ThenBy(a => a.StartTime)
            .ThenBy(a => a.CreatedAt)
            .ToListAsync();

        var dateLabel = sessionDate.ToString("yyyy-MM-dd");
        var auditDetails =
            $"Staff viewed clinical appointment list hospital={hospitalUserId} date={dateLabel} recordCount={appointments.Count}";

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = staffUserId,
            UserEmail = staff.Email,
            Role = staff.Role.ToString(),
            Action = "STAFF_CLINICAL_QUEUE_VIEW",
            Details = auditDetails.Length > 1000 ? auditDetails[..1000] : auditDetails,
            Timestamp = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        return appointments.Select(MapToStaffListDto).ToList();
    }

    public async Task<StaffAppointmentPatientContactDto> GetStaffAppointmentPatientContactAsync(
        Guid staffUserId,
        Guid appointmentId)
    {
        var staff = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == staffUserId);
        if (staff == null || staff.Role is not (UserRole.DOCTOR or UserRole.NURSE))
            throw new UnauthorizedAccessException("Only doctors or nurses can view patient contact details.");

        if (staff.Status != UserStatus.Active)
            throw new InvalidOperationException("Staff account must be Active.");

        var appointment = await _context.Appointments.AsNoTracking()
            .Include(a => a.PatientUser)
                .ThenInclude(u => u!.PatientProfile)
            .FirstOrDefaultAsync(a => a.Id == appointmentId)
            ?? throw new KeyNotFoundException("Appointment record not found.");

        if (string.Equals(appointment.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Contact details are not available for cancelled or rejected appointments.");
        }

        var isAffiliated = await _context.StaffAffiliations.AsNoTracking().AnyAsync(a =>
            a.StaffUserId == staffUserId &&
            a.HospitalUserId == appointment.HospitalUserId &&
            a.Status == AffiliationStatus.Active);

        if (!isAffiliated)
            throw new UnauthorizedAccessException("You are not affiliated with this hospital.");

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = staffUserId,
            UserEmail = staff.Email,
            Role = staff.Role.ToString(),
            Action = "STAFF_PATIENT_CONTACT_VIEW",
            Details = $"Revealed patient contact for appointment {appointment.Id}",
            Timestamp = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        var profile = appointment.PatientUser?.PatientProfile;
        return new StaffAppointmentPatientContactDto
        {
            AppointmentId = appointment.Id,
            PatientNic = profile?.NicNumber ?? appointment.PatientNic,
            PatientPhone = profile?.PhoneNumber ?? appointment.PatientUser?.PhoneNumber ?? appointment.PatientPhone,
            PatientEmail = appointment.PatientUser?.Email ?? appointment.PatientEmail
        };
    }

    public async Task<AppointmentResponseDto> CheckInAsync(Guid actorUserId, Guid appointmentId)
    {
        var appointment = await _context.Appointments
            .Include(a => a.VaccineSchedule)
            .FirstOrDefaultAsync(a => a.Id == appointmentId)
            ?? throw new KeyNotFoundException("Appointment record not found.");

        var actor = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == actorUserId)
            ?? throw new UnauthorizedAccessException("Invalid user.");

        var isHospitalOwner = appointment.HospitalUserId == actorUserId;
        if (!isHospitalOwner)
        {
            if (actor.Role is not (UserRole.DOCTOR or UserRole.NURSE))
                throw new UnauthorizedAccessException("Only the hospital desk or affiliated clinical staff can check patients in.");
            var isAffiliated = await _context.StaffAffiliations.AsNoTracking().AnyAsync(a =>
                a.StaffUserId == actorUserId &&
                a.HospitalUserId == appointment.HospitalUserId &&
                a.Status == AffiliationStatus.Active);
            if (!isAffiliated)
                throw new UnauthorizedAccessException("You are not affiliated with this hospital.");
        }

        if (appointment.AppointmentDate != StaffDutyHelper.HospitalToday())
            throw new InvalidOperationException("Patients can only be checked in on the day of their appointment.");

        if (!string.Equals(appointment.Status, "Confirmed", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(appointment.Status, "PendingPayment", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Cannot check in an appointment that is {appointment.Status}.");
        }

        if (appointment.CheckedInAt == null)
        {
            appointment.CheckedInAt = DateTime.UtcNow;
            appointment.CheckedInByUserId = actorUserId;
            appointment.UpdatedAt = DateTime.UtcNow;
            _context.AuditLogs.Add(new AuditLog
            {
                UserId = actorUserId,
                UserEmail = actor.Email,
                Role = actor.Role.ToString(),
                Action = "PATIENT_CHECKED_IN",
                Details = $"Patient {appointment.PatientName} checked in for appointment {appointment.Id}",
                Timestamp = DateTime.UtcNow
            });
            await _context.SaveChangesAsync();
        }

        return MapToDto(appointment);
    }

    public async Task<AppointmentResponseDto> UpdateAppointmentStatusAsync(Guid actorUserId, Guid appointmentId, UpdateAppointmentStatusDto dto)
    {
        var appointment = await _context.Appointments
            .FirstOrDefaultAsync(a => a.Id == appointmentId);

        if (appointment == null)
            throw new KeyNotFoundException("Appointment record not found.");

        var isHospitalOwner = appointment.HospitalUserId == actorUserId;
        if (!isHospitalOwner)
        {
            var actor = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == actorUserId);
            if (actor == null || actor.Role is not (UserRole.DOCTOR or UserRole.NURSE))
                throw new UnauthorizedAccessException("Only the hospital or affiliated clinical staff can update this appointment.");

            if (actor.Status != UserStatus.Active)
                throw new InvalidOperationException("Staff account must be Active.");

            var isAffiliated = await _context.StaffAffiliations.AsNoTracking().AnyAsync(a =>
                a.StaffUserId == actorUserId &&
                a.HospitalUserId == appointment.HospitalUserId &&
                a.Status == AffiliationStatus.Active);

            if (!isAffiliated)
                throw new UnauthorizedAccessException("You are not affiliated with this hospital.");
        }

        var requestedStatus = (dto.Status ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(requestedStatus))
            throw new InvalidOperationException("Status is required.");

        if (!AllowedStatusTransitions.TryGetValue(requestedStatus, out var nextStatus))
        {
            throw new InvalidOperationException(
                $"Unsupported status '{requestedStatus}'. Allowed values: {string.Join(", ", AllowedStatusTransitions.Values.Distinct())}.");
        }

        if (string.Equals(appointment.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Cannot update status for cancelled or rejected appointments.");
        }

        // Clinical session transitions are doctor/nurse only — hospital can monitor, not administer.
        if (ClinicalSessionStatuses.Contains(nextStatus))
        {
            if (isHospitalOwner)
            {
                throw new UnauthorizedAccessException(
                    "Clinical status changes (Administering, Observation, Completed) must be performed by clinical staff.");
            }
        }

        // Returning a patient from an active clinical session to the waiting queue is also a clinical action.
        var returningToQueue =
            string.Equals(nextStatus, "Confirmed", StringComparison.OrdinalIgnoreCase) &&
            (string.Equals(appointment.Status, "Administering", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(appointment.Status, "Observation", StringComparison.OrdinalIgnoreCase));

        if (returningToQueue)
        {
            if (isHospitalOwner)
            {
                throw new UnauthorizedAccessException(
                    "Returning a patient to the waiting queue must be performed by clinical staff.");
            }
        }

        // Clinical session work needs the staff member to be on duty here
        // (live rostered shift or clock-in, which also covers walk-ins).
        if (!isHospitalOwner && (ClinicalSessionStatuses.Contains(nextStatus) || returningToQueue))
        {
            await StaffDutyHelper.EnsureStaffOnDutyAsync(_context, actorUserId, appointment.HospitalUserId);
        }

        // Dose/session transitions require settled payment (free bookings are Paid at create).
        if (ClinicalSessionStatuses.Contains(nextStatus) &&
            !string.Equals(appointment.PaymentStatus, "Paid", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Payment must be settled before clinical administration.");
        }

        var previousStatus = appointment.Status;

        // A doctor must prescribe the dose before the nurse starts or records administration.
        var startingOrGivingDose =
            (string.Equals(nextStatus, "Administering", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(nextStatus, "Observation", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(nextStatus, "Completed", StringComparison.OrdinalIgnoreCase)) &&
            string.Equals(previousStatus, "Confirmed", StringComparison.OrdinalIgnoreCase) ||
            (string.Equals(nextStatus, "Observation", StringComparison.OrdinalIgnoreCase) &&
             string.Equals(previousStatus, "Administering", StringComparison.OrdinalIgnoreCase));
        if (startingOrGivingDose && string.IsNullOrWhiteSpace(appointment.PrescribedDosage))
        {
            throw new InvalidOperationException(
                "A doctor must prescribe the dose before administration. Ask the doctor to prescribe it first.");
        }

        // Post-vaccination observation: at least 15 minutes before discharge.
        if (!isHospitalOwner &&
            string.Equals(nextStatus, "Completed", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(previousStatus, "Observation", StringComparison.OrdinalIgnoreCase))
        {
            var observedFor = DateTime.UtcNow - (appointment.UpdatedAt ?? DateTime.UtcNow);
            var remaining = TimeSpan.FromMinutes(ObservationMinutes) - observedFor;
            if (remaining > TimeSpan.Zero)
            {
                var minutes = (int)Math.Ceiling(remaining.TotalMinutes);
                throw new InvalidOperationException(
                    $"Observation is not complete — {minutes} more minute{(minutes == 1 ? "" : "s")} before discharge.");
            }
        }

        // Real clinics only call patients who have arrived.
        if (!isHospitalOwner &&
            string.Equals(nextStatus, "Administering", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(previousStatus, "Confirmed", StringComparison.OrdinalIgnoreCase) &&
            appointment.CheckedInAt == null)
        {
            throw new InvalidOperationException("This patient has not checked in yet. Check them in when they arrive.");
        }

        // Two-person check: the doctor prescribes, the administering staff member signs off
        // the order, consent and vitals before the dose is recorded as given.
        var recordingAdministration =
            !isHospitalOwner &&
            string.Equals(nextStatus, "Observation", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(previousStatus, "Administering", StringComparison.OrdinalIgnoreCase);
        if (recordingAdministration &&
            (dto.DoseConfirmed != true || dto.ConsentConfirmed != true || dto.VitalsConfirmed != true))
        {
            throw new InvalidOperationException(
                "Confirm the prescribed dose, patient consent and pre-vaccination vitals before recording administration.");
        }

        // Enforce clinical transition graph for non-hospital actors.
        // Hospital desk may still Confirm/Cancel/Reject bookings; clinical staff
        // may only move within the live session path (plus closing missed visits).
        if (!isHospitalOwner)
        {
            var from = previousStatus ?? string.Empty;
            var to = nextStatus;
            var allowedClinical =
                (string.Equals(from, "Confirmed", StringComparison.OrdinalIgnoreCase) &&
                 (string.Equals(to, "Administering", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(to, "Cancelled", StringComparison.OrdinalIgnoreCase))) ||
                (string.Equals(from, "PendingPayment", StringComparison.OrdinalIgnoreCase) &&
                 string.Equals(to, "Cancelled", StringComparison.OrdinalIgnoreCase)) ||
                (string.Equals(from, "Administering", StringComparison.OrdinalIgnoreCase) &&
                 (string.Equals(to, "Observation", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(to, "Confirmed", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(to, "Cancelled", StringComparison.OrdinalIgnoreCase))) ||
                (string.Equals(from, "Observation", StringComparison.OrdinalIgnoreCase) &&
                 (string.Equals(to, "Completed", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(to, "Confirmed", StringComparison.OrdinalIgnoreCase))) ||
                (string.Equals(from, to, StringComparison.OrdinalIgnoreCase));

            if (!allowedClinical)
            {
                throw new InvalidOperationException(
                    $"Cannot change appointment status from '{from}' to '{to}'.");
            }

            // Staff must never "Confirm" an unpaid PendingPayment booking (that would skip desk settlement).
            if (string.Equals(to, "Confirmed", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(from, "PendingPayment", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "Unpaid bookings must be marked paid by the hospital desk before clinical confirmation.");
            }
        }

        appointment.Status = nextStatus;
        appointment.UpdatedAt = DateTime.UtcNow;

        if (string.Equals(nextStatus, "Cancelled", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(dto.Remarks))
        {
            var cancelNote = dto.Remarks.Trim();
            appointment.Notes = string.IsNullOrWhiteSpace(appointment.Notes)
                ? cancelNote
                : $"{appointment.Notes.Trim()}\n{cancelNote}";
            if (appointment.Notes.Length > 1000)
                appointment.Notes = appointment.Notes[^1000..];
        }

        // Hospital desk: confirming a PendingPayment booking records payment as settled.
        if (isHospitalOwner &&
            string.Equals(nextStatus, "Confirmed", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(previousStatus, "PendingPayment", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(appointment.PaymentStatus, "Paid", StringComparison.OrdinalIgnoreCase))
        {
            appointment.PaymentStatus = "Paid";
            if (string.IsNullOrWhiteSpace(appointment.PaymentMethod) ||
                string.Equals(appointment.PaymentMethod, "PayHere", StringComparison.OrdinalIgnoreCase))
            {
                appointment.PaymentMethod = "Hospital";
            }
        }

        var doseIsBeingGiven =
            (nextStatus is "Observation" or "Completed") &&
            !string.Equals(previousStatus, "Observation", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(previousStatus, "Completed", StringComparison.OrdinalIgnoreCase);

        if (doseIsBeingGiven)
        {
            await ConsumeVialForAppointmentAsync(actorUserId, appointment, dto);
        }

        await _context.SaveChangesAsync();

        _logger.LogInformation(
            "User {ActorId} updated appointment {AppId} status to {Status}",
            actorUserId, appointmentId, appointment.Status);

        return MapToDto(appointment);
    }

    public async Task<AefiReportResponseDto> ReportAefiAsync(Guid actorUserId, Guid appointmentId, ReportAefiDto dto)
    {
        var appointment = await _context.Appointments
            .FirstOrDefaultAsync(a => a.Id == appointmentId)
            ?? throw new KeyNotFoundException("Appointment record not found.");

        var actor = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == actorUserId)
            ?? throw new UnauthorizedAccessException("Invalid user.");

        if (actor.Role is not (UserRole.DOCTOR or UserRole.NURSE))
            throw new UnauthorizedAccessException("Only clinical staff can report AEFI.");

        if (actor.Status != UserStatus.Active)
            throw new InvalidOperationException("Staff account must be Active.");

        var isAffiliated = await _context.StaffAffiliations.AsNoTracking().AnyAsync(a =>
            a.StaffUserId == actorUserId &&
            a.HospitalUserId == appointment.HospitalUserId &&
            a.Status == AffiliationStatus.Active);

        if (!isAffiliated)
            throw new UnauthorizedAccessException("You are not affiliated with this hospital.");

        if (string.Equals(appointment.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Cannot report AEFI for cancelled or rejected appointments.");
        }

        var severityRaw = (dto.Severity ?? string.Empty).Trim();
        var severity = severityRaw.Equals("Severe", StringComparison.OrdinalIgnoreCase) ? "Severe"
            : severityRaw.Equals("Moderate", StringComparison.OrdinalIgnoreCase) ? "Moderate"
            : "Mild";

        var description = (dto.Description ?? string.Empty).Trim();
        var treatment = (dto.TreatmentGiven ?? string.Empty).Trim();
        var followUpPlan = (dto.FollowUpPlan ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(description))
            throw new InvalidOperationException("Symptoms / clinical signs are required.");
        if (string.IsNullOrWhiteSpace(treatment))
            throw new InvalidOperationException("Immediate care / treatment given is required.");
        if (string.IsNullOrWhiteSpace(followUpPlan))
            throw new InvalidOperationException("Follow-up plan is required.");

        var actorName = await ResolveActorDisplayNameAsync(actorUserId, actor);
        var reportedAt = DateTime.UtcNow;

        var followUpAt = dto.FollowUpAt;
        if (followUpAt == default)
            throw new InvalidOperationException("Follow-up date is required.");
        if (followUpAt.Kind == DateTimeKind.Unspecified)
            followUpAt = DateTime.SpecifyKind(followUpAt, DateTimeKind.Utc);
        else
            followUpAt = followUpAt.ToUniversalTime();
        if (followUpAt.Date < reportedAt.Date)
            throw new InvalidOperationException("Follow-up date must be today or in the future.");

        var notifyDoctor = dto.NotifyDoctor;

        var aefiSummary =
            $"AEFI {severity}: {description}. Treatment: {treatment}. " +
            $"Follow-up {followUpAt:yyyy-MM-dd}: {followUpPlan}. " +
            $"Reported by {actorName} at {reportedAt:yyyy-MM-dd HH:mm} UTC" +
            (notifyDoctor ? ". Attending physician alerted." : ".");

        // Cap for PatientVaccinationRecord.AdverseEventNotes (max 1000).
        var doseNotes = aefiSummary.Length <= 1000 ? aefiSummary : aefiSummary[..997] + "...";

        PatientVaccinationRecord? doseRecord = null;
        if (appointment.PatientProfileId is Guid profileId)
        {
            var appointmentKey = appointment.Id.ToString();
            doseRecord = await _context.PatientVaccinationRecords
                .Where(r => r.PatientProfileId == profileId)
                .Where(r => r.Notes != null && r.Notes.Contains(appointmentKey))
                .OrderByDescending(r => r.AdministeredAt)
                .FirstOrDefaultAsync();

            if (doseRecord == null && appointment.VaccineId.HasValue)
            {
                var dayStart = reportedAt.Date;
                doseRecord = await _context.PatientVaccinationRecords
                    .Where(r =>
                        r.PatientProfileId == profileId &&
                        r.VaccineId == appointment.VaccineId.Value &&
                        r.AdministeredAt >= dayStart)
                    .OrderByDescending(r => r.AdministeredAt)
                    .FirstOrDefaultAsync();
            }
        }

        var documentedOnDose = false;
        if (doseRecord != null)
        {
            doseRecord.AdverseEventReported = true;
            doseRecord.AdverseEventNotes = doseNotes;
            documentedOnDose = true;
        }

        appointment.Notes = string.IsNullOrWhiteSpace(appointment.Notes)
            ? aefiSummary
            : $"{appointment.Notes.Trim()}\n{aefiSummary}";
        if (appointment.Notes.Length > 1000)
            appointment.Notes = appointment.Notes[^1000..];
        // Do not bump UpdatedAt — the clinical dashboard uses it as the
        // observation-window start time after Administering → Observation.

        Guid? followUpVisitId = null;
        var followUpScheduled = false;
        if (appointment.PatientProfileId is Guid patientProfileId)
        {
            Guid? hospitalProfileId = appointment.HospitalProfileId;
            if (hospitalProfileId == null)
            {
                hospitalProfileId = await _context.HospitalProfiles.AsNoTracking()
                    .Where(h => h.UserId == appointment.HospitalUserId)
                    .Select(h => (Guid?)h.Id)
                    .FirstOrDefaultAsync();
            }

            var visit = new PatientVisit
            {
                PatientProfileId = patientProfileId,
                AppointmentId = appointment.Id,
                HospitalProfileId = hospitalProfileId,
                VisitDate = reportedAt,
                VisitType = VisitType.FollowUp,
                Status = VisitStatus.Scheduled,
                ChiefComplaint = $"AEFI follow-up ({severity}) — {appointment.VaccineName}",
                DiagnosisSummary = description.Length <= 2000 ? description : description[..2000],
                TreatmentPlan = treatment.Length <= 2000 ? treatment : treatment[..2000],
                Notes = followUpPlan.Length <= 1000 ? followUpPlan : followUpPlan[..1000],
                FollowUpDate = followUpAt,
                DoctorUserId = actor.Role == UserRole.DOCTOR
                    ? actorUserId
                    : appointment.PrescribedByDoctorUserId,
                DoctorName = actor.Role == UserRole.DOCTOR
                    ? actorName
                    : appointment.PrescribedByDoctorName ?? appointment.DoctorName,
                NurseUserId = actor.Role == UserRole.NURSE ? actorUserId : null,
                NurseName = actor.Role == UserRole.NURSE ? actorName : appointment.NurseName
            };
            _context.PatientVisits.Add(visit);
            followUpVisitId = visit.Id;
            followUpScheduled = true;
        }

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actor.Email,
            Role = actor.Role.ToString(),
            Action = "AEFI_REPORTED",
            Details =
                $"AEFI ({severity}) for appointment {appointment.Id}, patient {appointment.PatientName}, " +
                $"vaccine {appointment.VaccineName}. Treatment + follow-up ({followUpAt:yyyy-MM-dd}) captured. " +
                $"DocumentedOnDose={documentedOnDose}. FollowUpScheduled={followUpScheduled}. NotifyDoctor={notifyDoctor}. " +
                $"Signs: {description}",
            Timestamp = reportedAt
        });

        await _context.SaveChangesAsync();

        var notifiedDoctor = false;

        if (notifyDoctor)
        {
            string? doctorEmail = null;
            string doctorName = appointment.PrescribedByDoctorName
                ?? appointment.DoctorName
                ?? "Attending Physician";

            if (appointment.PrescribedByDoctorUserId is Guid doctorId)
            {
                var doctor = await _context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == doctorId);
                if (doctor != null && !string.IsNullOrWhiteSpace(doctor.Email))
                {
                    doctorEmail = doctor.Email;
                    doctorName = appointment.PrescribedByDoctorName ?? doctorName;
                }
            }

            if (string.IsNullOrWhiteSpace(doctorEmail))
            {
                var affiliatedDoctor = await (
                    from aff in _context.StaffAffiliations.AsNoTracking()
                    join u in _context.Users.AsNoTracking() on aff.StaffUserId equals u.Id
                    where aff.HospitalUserId == appointment.HospitalUserId
                          && aff.Status == AffiliationStatus.Active
                          && u.Role == UserRole.DOCTOR
                          && u.Status == UserStatus.Active
                          && u.Id != actorUserId
                    select u
                ).FirstOrDefaultAsync();

                if (affiliatedDoctor != null)
                {
                    doctorEmail = affiliatedDoctor.Email;
                    doctorName = affiliatedDoctor.Email.Split('@')[0];
                }
            }

            if (!string.IsNullOrWhiteSpace(doctorEmail))
            {
                try
                {
                    notifiedDoctor = await _emailService.SendAefiSurveillanceAlertAsync(
                        doctorEmail,
                        doctorName,
                        appointment.PatientName,
                        appointment.VaccineName ?? "Unknown vaccine",
                        appointment.HospitalName ?? "Hospital",
                        appointment.AppointmentDate.ToString("yyyy-MM-dd"),
                        appointment.TimeSlot ?? "",
                        severity,
                        description,
                        treatment,
                        actorName,
                        appointment.Id.ToString());
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send AEFI doctor alert for appointment {AppId}", appointment.Id);
                }
            }
        }

        _logger.LogInformation(
            "AEFI reported by {ActorId} for appointment {AppId}: severity={Severity}, onDose={OnDose}, followUp={FollowUp}, doctor={Doctor}",
            actorUserId, appointmentId, severity, documentedOnDose, followUpScheduled, notifiedDoctor);

        var message = documentedOnDose
            ? "AEFI documented on the vaccination dose; care and follow-up recorded."
            : "AEFI, treatment, and follow-up recorded on the appointment.";
        if (!followUpScheduled)
            message += " Link a patient profile to schedule a clinical follow-up visit.";
        if (notifyDoctor && !notifiedDoctor)
            message += " Physician alert intent recorded (no deliverable doctor email).";

        return new AefiReportResponseDto
        {
            AppointmentId = appointment.Id,
            VaccinationRecordId = doseRecord?.Id,
            FollowUpVisitId = followUpVisitId,
            Severity = severity,
            DocumentedOnDose = documentedOnDose,
            FollowUpScheduled = followUpScheduled,
            FollowUpAt = followUpAt,
            NotifiedDoctor = notifiedDoctor,
            Message = message
        };
    }

    private async Task<string> ResolveActorDisplayNameAsync(Guid actorUserId, User actor)
    {
        if (actor.Role == UserRole.DOCTOR)
        {
            var doc = await _context.DoctorProfiles.AsNoTracking()
                .FirstOrDefaultAsync(d => d.UserId == actorUserId);
            if (!string.IsNullOrWhiteSpace(doc?.FullName))
                return doc.FullName.Trim();
        }
        else if (actor.Role == UserRole.NURSE)
        {
            var nurse = await _context.NurseProfiles.AsNoTracking()
                .FirstOrDefaultAsync(n => n.UserId == actorUserId);
            if (!string.IsNullOrWhiteSpace(nurse?.FullName))
                return nurse.FullName.Trim();
        }

        return actor.Email;
    }

    public Task<bool> CancelAppointmentAsync(Guid userId, Guid appointmentId, bool isHospital = false)
        => CancelAppointmentAsync(userId, appointmentId.ToString(), isHospital);

    public async Task<bool> CancelAppointmentAsync(Guid userId, string idOrRef, bool isHospital = false)
    {
        Guid.TryParse(idOrRef, out var parsedGuid);

        Appointment? appointment = null;
        if (parsedGuid != Guid.Empty)
        {
            appointment = await _context.Appointments
                .FirstOrDefaultAsync(a => a.Id == parsedGuid &&
                                          (isHospital ? a.HospitalUserId == userId : a.PatientUserId == userId));
        }

        // If not found by Guid directly, search user's appointments matching prefix or short id
        if (appointment == null && !string.IsNullOrWhiteSpace(idOrRef))
        {
            var userAppointments = await _context.Appointments
                .Where(a => isHospital ? a.HospitalUserId == userId : a.PatientUserId == userId)
                .ToListAsync();

            var cleanRef = idOrRef.Trim();
            appointment = userAppointments.FirstOrDefault(a =>
            {
                var idStr = a.Id.ToString();
                var shortId = idStr.Length >= 8 ? idStr.Substring(0, 8) : idStr;
                var vaxRef = $"VAX-{shortId}";
                return idStr.Equals(cleanRef, StringComparison.OrdinalIgnoreCase) ||
                       idStr.StartsWith(cleanRef, StringComparison.OrdinalIgnoreCase) ||
                       vaxRef.Equals(cleanRef, StringComparison.OrdinalIgnoreCase) ||
                       cleanRef.Contains(shortId, StringComparison.OrdinalIgnoreCase) ||
                       (!string.IsNullOrEmpty(a.VaccineName) && cleanRef.Contains(a.VaccineName, StringComparison.OrdinalIgnoreCase)) ||
                       (!string.IsNullOrEmpty(cleanRef) && cleanRef.Length >= 4 && idStr.StartsWith(cleanRef[^4..], StringComparison.OrdinalIgnoreCase));
            });
        }

        if (appointment == null)
        {
            throw new KeyNotFoundException("Appointment not found or unauthorized to cancel.");
        }

        if (appointment.Status == "Cancelled")
        {
            return true; // Already cancelled
        }

        // Patient self-service cancellation requires at least 24 hours' notice.
        if (!isHospital)
        {
            if (appointment.Status == "Completed")
            {
                throw new InvalidOperationException("Completed vaccination appointments cannot be cancelled.");
            }

            var startTimeValue = string.IsNullOrWhiteSpace(appointment.StartTime)
                ? appointment.TimeSlot
                : appointment.StartTime;
            if (!TryParseSlotStart(startTimeValue, out var slotStart))
            {
                throw new InvalidOperationException("Appointment has an invalid time slot and cannot be cancelled online.");
            }

            var appointmentStart = appointment.AppointmentDate.ToDateTime(slotStart);
            var hospitalNow = DateTime.SpecifyKind(StaffDutyHelper.HospitalNow(), DateTimeKind.Unspecified);
            if (appointmentStart - hospitalNow < TimeSpan.FromHours(24))
            {
                throw new InvalidOperationException(
                    "Appointments can only be cancelled at least 24 hours before the scheduled start time.");
            }
        }

        appointment.Status = "Cancelled";
        appointment.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        _logger.LogInformation("Cancelled appointment {AppId} by {Actor} {UserId}. Slot {Slot} on {Date} is now released.",
            appointment.Id, isHospital ? "Hospital" : "Patient", userId, appointment.TimeSlot, appointment.AppointmentDate);

        // Asynchronously send cancellation email to patient
        if (!string.IsNullOrWhiteSpace(appointment.PatientEmail))
        {
            var cancelledByText = isHospital ? $"Hospital ({appointment.HospitalName})" : "Patient (Self-Service)";
            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendAppointmentCancellationEmailAsync(
                        appointment.PatientEmail,
                        appointment.PatientName,
                        appointment.VaccineName,
                        appointment.HospitalName,
                        appointment.AppointmentDate.ToString("dddd, dd MMMM yyyy"),
                        appointment.TimeSlot,
                        cancelledByText);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send cancellation email to {Email} for appointment {AppId}", appointment.PatientEmail, appointment.Id);
                }
            });
        }

        return true;
    }

    public async Task<AppointmentResponseDto> ConfirmPayHerePaymentAsync(Guid appointmentId, string transactionId, string? orderId = null)
    {
        var appointment = await _context.Appointments
            .FirstOrDefaultAsync(a => a.Id == appointmentId);

        if (appointment == null)
        {
            throw new KeyNotFoundException($"Appointment {appointmentId} not found.");
        }

        if (appointment.PaymentStatus == "Paid" && appointment.Status == "Confirmed")
        {
            _logger.LogInformation("Appointment {AppId} is already paid and confirmed.", appointmentId);
            return MapToDto(appointment);
        }

        if (string.Equals(appointment.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Cannot confirm payment for a cancelled or rejected appointment.");
        }

        if (appointment.Fee <= 0)
        {
            throw new InvalidOperationException("This appointment does not require PayHere payment.");
        }

        if (string.IsNullOrWhiteSpace(transactionId))
        {
            throw new InvalidOperationException("PayHere payment id is required.");
        }

        appointment.Status = "Confirmed";
        appointment.PaymentStatus = "Paid";
        appointment.PaymentMethod = "PayHere";
        appointment.PaymentTransactionId = transactionId.Trim();
        appointment.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        _logger.LogInformation("Confirmed PayHere payment for Appointment {AppId} (Tx: {TxId}, Order: {OrderId})",
            appointment.Id, transactionId, orderId ?? "N/A");

        var resolvedOrderId = !string.IsNullOrWhiteSpace(orderId)
            ? orderId
            : $"APT-{appointment.Id.ToString("N")[..12].ToUpperInvariant()}";

        // Asynchronously dispatch BOTH emails:
        // 1. Booking Confirmation Email
        // 2. Transaction Payment Receipt Email
        if (!string.IsNullOrWhiteSpace(appointment.PatientEmail))
        {
            var patientEmail = appointment.PatientEmail;
            var patientName = appointment.PatientName;
            var vaccineName = appointment.VaccineName;
            var hospitalName = appointment.HospitalName;
            var appointmentDate = appointment.AppointmentDate.ToString("dddd, dd MMMM yyyy");
            var timeSlot = appointment.TimeSlot;
            var doctorName = appointment.DoctorName;
            var nurseName = appointment.NurseName;
            var notes = appointment.Notes;
            var fee = appointment.Fee;
            var payMethod = appointment.PaymentMethod;
            var payStatus = appointment.PaymentStatus;
            var txId = transactionId;
            var ordId = resolvedOrderId;
            var paymentTime = DateTime.UtcNow;

            _ = Task.Run(async () =>
            {
                try
                {
                    // Email 1: Booking Confirmation Email
                    await _emailService.SendAppointmentBookingConfirmationEmailAsync(
                        patientEmail,
                        patientName,
                        vaccineName,
                        hospitalName,
                        appointmentDate,
                        timeSlot,
                        doctorName,
                        nurseName,
                        notes,
                        fee,
                        payMethod,
                        payStatus);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send booking confirmation email after payment to {Email} for appointment {AppId}", patientEmail, appointmentId);
                }

                try
                {
                    // Email 2: Payment Receipt Email
                    await _emailService.SendPaymentReceiptEmailAsync(
                        patientEmail,
                        patientName,
                        vaccineName,
                        hospitalName,
                        appointmentDate,
                        timeSlot,
                        fee,
                        "LKR",
                        txId,
                        ordId,
                        paymentTime);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send payment receipt email to {Email} for appointment {AppId}", patientEmail, appointmentId);
                }
            });
        }

        return MapToDto(appointment);
    }

    private static List<TimeSlotDto> Generate20MinSlots(string startTimeStr, string endTimeStr)
    {
        var result = new List<TimeSlotDto>();

        if (!TryParseTime(startTimeStr, out var startTime) || !TryParseTime(endTimeStr, out var endTime))
        {
            // Default 09:00 - 10:00 (3 slots) if time parsing fails
            startTime = new TimeOnly(9, 0);
            endTime = new TimeOnly(10, 0);
        }

        if (endTime <= startTime)
        {
            endTime = startTime.AddHours(1);
        }

        var current = startTime;
        while (current.AddMinutes(20) <= endTime)
        {
            var next = current.AddMinutes(20);
            var slotStr = $"{FormatTime12h(current)} - {FormatTime12h(next)}";

            result.Add(new TimeSlotDto
            {
                Slot = slotStr,
                StartTime = current.ToString("HH:mm"),
                EndTime = next.ToString("HH:mm"),
                IsBooked = false
            });

            current = next;
        }

        return result;
    }

    private static void EnsureAppointmentNotInPast(DateOnly appointmentDate, string? timeSlot)
    {
        var today = StaffDutyHelper.HospitalToday();
        if (appointmentDate < today)
        {
            throw new InvalidOperationException("Cannot book an appointment on a past date.");
        }

        if (appointmentDate > today)
        {
            return;
        }

        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());
        if (!TryParseSlotStart(timeSlot, out var slotStart))
        {
            throw new InvalidOperationException("Selected time slot is invalid.");
        }

        if (slotStart < now)
        {
            throw new InvalidOperationException("Cannot book a time slot that has already started. Please choose a later slot.");
        }
    }

    private static bool TryParseSlotStart(string? timeSlot, out TimeOnly start)
    {
        start = default;
        if (string.IsNullOrWhiteSpace(timeSlot)) return false;

        // Formats: "09:00 AM - 09:20 AM" or "09:00-09:20" or single start time
        var raw = timeSlot.Trim();
        var dash = raw.IndexOf('-');
        var startPart = dash >= 0 ? raw[..dash].Trim() : raw;
        return TryParseTime(startPart, out start);
    }

    private static bool TryParseTime(string timeStr, out TimeOnly time)
    {
        time = default;
        if (string.IsNullOrWhiteSpace(timeStr)) return false;

        var formats = new[] { "HH:mm", "H:mm", "hh:mm tt", "h:mm tt", "HH:mm:ss" };
        return TimeOnly.TryParseExact(timeStr.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out time) ||
               TimeOnly.TryParse(timeStr.Trim(), CultureInfo.InvariantCulture, out time);
    }

    private static string FormatTime12h(TimeOnly time)
    {
        return DateTime.Today.Add(time.ToTimeSpan()).ToString("hh:mm tt");
    }

    private static string FormatTime12h(string timeStr)
    {
        if (TryParseTime(timeStr, out var t))
        {
            return FormatTime12h(t);
        }
        return timeStr;
    }

    private static string? BuildBookingNotes(string? notes, string? boothLabel)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(notes))
            parts.Add(notes.Trim());
        if (!string.IsNullOrWhiteSpace(boothLabel))
            parts.Add($"Booth: {boothLabel.Trim()}");
        return parts.Count == 0 ? null : string.Join("\n", parts);
    }

    private async Task<decimal> ResolveWalkInFeeAsync(User hospital, string vaccineName, VaccineSchedule? schedule)
    {
        if (hospital.HospitalProfile != null)
        {
            var wanted = vaccineName.Trim().ToLowerInvariant();
            var formulary = await _context.HospitalFormularies
                .AsNoTracking()
                .Include(f => f.Vaccine)
                .Where(f => f.HospitalProfileId == hospital.HospitalProfile.Id)
                .ToListAsync();
            var match = formulary.FirstOrDefault(f =>
                (schedule?.VaccineId != null && f.VaccineId == schedule.VaccineId) ||
                (f.Vaccine != null && string.Equals(f.Vaccine.Name.Trim(), wanted, StringComparison.OrdinalIgnoreCase)));
            if (match != null)
                return Math.Max(0.00m, match.Price);
        }

        return Math.Max(0.00m, schedule?.Price ?? 0.00m);
    }

    /// <summary>
    /// Picks the walk-in booth. A desk-chosen booth must offer the vaccine (when any
    /// booth lists it). Otherwise auto-assign: an offering booth with on-duty staff
    /// first, then the shortest open queue today, then booth order.
    /// </summary>
    private async Task<(Guid? Id, string? Label)> ResolveWalkInBoothAsync(
        Guid hospitalUserId,
        string vaccineName,
        string? requestedLabel)
    {
        var requested = requestedLabel?.Trim();
        var booths = await _context.HospitalBooths
            .AsNoTracking()
            .Include(b => b.Vaccines).ThenInclude(v => v.Vaccine)
            .Where(b => b.HospitalUserId == hospitalUserId && b.IsActive)
            .OrderBy(b => b.SortOrder).ThenBy(b => b.Code)
            .ToListAsync();

        if (booths.Count == 0)
            return (null, string.IsNullOrWhiteSpace(requested) ? null : requested);

        var wanted = vaccineName.Trim().ToLowerInvariant();
        var offering = booths
            .Where(b => b.Vaccines.Any(v =>
            {
                var name = v.Vaccine?.Name?.Trim().ToLowerInvariant();
                return !string.IsNullOrEmpty(name) && (name == wanted || name.Contains(wanted) || wanted.Contains(name));
            }))
            .ToList();

        if (!string.IsNullOrWhiteSpace(requested))
        {
            var chosen = booths.FirstOrDefault(b =>
                string.Equals(b.DisplayLabel, requested, StringComparison.OrdinalIgnoreCase));
            if (chosen == null)
                return (null, requested);
            if (offering.Count > 0 && !offering.Contains(chosen))
            {
                throw new InvalidOperationException(
                    $"{chosen.DisplayLabel} does not offer {vaccineName}. Choose " +
                    $"{string.Join(", ", offering.Select(b => b.DisplayLabel))} or leave the booth on Auto.");
            }
            return (chosen.Id, chosen.DisplayLabel);
        }

        if (offering.Count == 0)
            return (null, null);

        var today = StaffDutyHelper.HospitalToday();
        var now = TimeOnly.FromDateTime(StaffDutyHelper.HospitalNow());
        var offeringIds = offering.Select(b => b.Id).ToList();
        var liveShifts = await _context.StaffShifts
            .AsNoTracking()
            .Where(s =>
                s.BoothId != null &&
                offeringIds.Contains(s.BoothId.Value) &&
                s.ShiftDate == today &&
                s.StartTime <= now &&
                s.EndTime > now)
            .Select(s => new { BoothId = s.BoothId!.Value, s.AffiliationId })
            .ToListAsync();
        var onDuty = await StaffDutyHelper.GetOnDutyAffiliationIdsAsync(
            _context,
            liveShifts.Select(s => s.AffiliationId).Distinct().ToList());
        var staffedBoothIds = liveShifts
            .Where(s => onDuty.Contains(s.AffiliationId))
            .Select(s => s.BoothId)
            .ToHashSet();

        var openToday = await _context.Appointments
            .AsNoTracking()
            .Where(a =>
                a.HospitalUserId == hospitalUserId &&
                a.AppointmentDate == today &&
                (a.Status == "Confirmed" || a.Status == "PendingPayment" || a.Status == "Administering"))
            .Select(a => new { a.Notes, a.VaccineScheduleId })
            .ToListAsync();
        var scheduleIds = openToday
            .Where(a => a.VaccineScheduleId.HasValue)
            .Select(a => a.VaccineScheduleId!.Value)
            .Distinct()
            .ToList();
        var boothBySchedule = await _context.VaccineSchedules
            .AsNoTracking()
            .Where(s => scheduleIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, s => s.BoothId);

        int QueueLoad(HospitalBooth booth) => openToday.Count(a =>
        {
            var notesBooth = ExtractBoothFromNotes(a.Notes);
            if (notesBooth != null)
                return string.Equals(notesBooth, booth.DisplayLabel, StringComparison.OrdinalIgnoreCase);
            return a.VaccineScheduleId.HasValue &&
                   boothBySchedule.TryGetValue(a.VaccineScheduleId.Value, out var scheduleBooth) &&
                   scheduleBooth == booth.Id;
        });

        var pick = offering
            .OrderByDescending(b => staffedBoothIds.Contains(b.Id))
            .ThenBy(QueueLoad)
            .First();
        return (pick.Id, pick.DisplayLabel);
    }

    private static string? ExtractBoothFromNotes(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes)) return null;
        const string marker = "Booth:";
        var idx = notes.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        var rest = notes[(idx + marker.Length)..].Trim();
        var endLine = rest.IndexOfAny(['\r', '\n']);
        if (endLine >= 0) rest = rest[..endLine].Trim();
        return rest;
    }

    private async Task ConsumeVialForAppointmentAsync(
        Guid actorUserId,
        Appointment appointment,
        UpdateAppointmentStatusDto dto)
    {
        var appointmentKey = appointment.Id.ToString();
        var alreadyIssued = await _context.InventoryTransactions.AnyAsync(t =>
            t.Type == TransactionType.Issue &&
            t.Reason != null &&
            t.Reason.Contains(appointmentKey));

        if (alreadyIssued)
            return;

        var hospital = await _context.HospitalProfiles
            .FirstOrDefaultAsync(h =>
                h.UserId == appointment.HospitalUserId ||
                (appointment.HospitalProfileId.HasValue && h.Id == appointment.HospitalProfileId.Value));

        if (hospital == null)
        {
            throw new InvalidOperationException(
                "Cannot record this dose: the hospital inventory profile was not found.");
        }

        Vaccine? vaccine = null;
        if (appointment.VaccineId.HasValue)
        {
            vaccine = await _context.Vaccines.FirstOrDefaultAsync(v => v.Id == appointment.VaccineId.Value);
        }

        if (vaccine == null && !string.IsNullOrWhiteSpace(appointment.VaccineName))
        {
            var name = appointment.VaccineName.Trim().ToLower();
            vaccine = await _context.Vaccines.FirstOrDefaultAsync(v => v.Name.ToLower() == name)
                ?? await _context.Vaccines.FirstOrDefaultAsync(v => v.Name.ToLower().Contains(name));
        }

        if (vaccine == null)
        {
            throw new InvalidOperationException(
                $"Cannot record this dose: no inventory product matches '{appointment.VaccineName}'.");
        }

        var now = DateTime.UtcNow;
        IQueryable<Batch> usableBatches = _context.Batches
            .Include(b => b.Vaccine)
            .Where(b =>
                b.HospitalProfileId == hospital.Id &&
                b.VaccineId == vaccine.Id &&
                b.Status == BatchStatus.Active &&
                b.ExpiryDate >= now &&
                ((b.OpenVialDosesRemaining ?? 0) > 0 || b.QuantityAvailable > 0));

        Batch? batch = null;

        if (dto.BatchId.HasValue)
        {
            batch = await usableBatches.FirstOrDefaultAsync(b => b.Id == dto.BatchId.Value);
            if (batch == null)
            {
                throw new InvalidOperationException(
                    "Selected lot is not usable for this vaccine at this hospital (expired, empty, or wrong product).");
            }
        }
        else if (!string.IsNullOrWhiteSpace(dto.LotNumber))
        {
            var lot = dto.LotNumber.Trim();
            batch = await usableBatches.FirstOrDefaultAsync(b => b.BatchNumber == lot);
            if (batch == null)
            {
                throw new InvalidOperationException(
                    $"Lot '{lot}' is not usable for this vaccine at this hospital.");
            }
        }
        else
        {
            // Fallback FEFO when clinician did not pick a lot (e.g. older clients).
            batch = await usableBatches
                .OrderByDescending(b => (b.OpenVialDosesRemaining ?? 0) > 0)
                .ThenBy(b => b.ExpiryDate)
                .ThenBy(b => b.CreatedAt)
                .FirstOrDefaultAsync();
        }

        if (batch == null)
        {
            throw new InvalidOperationException(
                $"No usable {vaccine.Name} stock at this hospital. Restock a batch before completing the dose.");
        }

        var actor = await _context.Users
            .AsNoTracking()
            .Include(u => u.DoctorProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.HospitalProfile)
            .FirstOrDefaultAsync(u => u.Id == actorUserId);

        var actorName = actor?.DoctorProfile?.FullName is { Length: > 0 } docName ? StaffNameFormatter.WithRolePrefix(docName, "Dr.")
            : actor?.NurseProfile?.FullName is { Length: > 0 } nurseName ? StaffNameFormatter.WithRolePrefix(nurseName, "Nurse")
            : actor?.HospitalProfile?.HospitalName
            ?? actor?.Email
            ?? "Clinical staff";

        InventoryDoseHelper.ConsumeOneDose(batch, vaccine);

        _context.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id,
            Type = TransactionType.Issue,
            Quantity = 1,
            Reason = $"Administered 1 dose of {vaccine.Name} for appointment {appointment.Id}",
            PerformedByUserId = actorUserId,
            PerformedByName = actorName
        });

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId,
            UserEmail = actor?.Email,
            Role = actor?.Role.ToString() ?? "STAFF",
            Action = "INVENTORY_ISSUE",
            Details =
                $"Issued 1 dose of {vaccine.Name} (Lot {batch.BatchNumber}, {InventoryDoseHelper.ResolveDosesPerVial(vaccine)} doses/vial) for appointment {appointment.Id}",
            Timestamp = DateTime.UtcNow
        });

        var route = ParseVaccineRoute(dto.Route);
        var site = ParseInjectionSite(dto.InjectionSite);
        var noteParts = new List<string> { $"Linked to appointment {appointment.Id}" };
        if (dto.DoseConfirmed == true)
        {
            noteParts.Add(
                $"Prescribed dose {appointment.PrescribedDosage} " +
                $"({appointment.PrescribedByDoctorName ?? "doctor"}) confirmed and given by {actorName}");
        }
        if (dto.ConsentConfirmed == true)
            noteParts.Add("Informed consent confirmed");
        if (dto.VitalsConfirmed == true)
            noteParts.Add("Pre-administration vitals verified");
        if (!string.IsNullOrWhiteSpace(dto.AdministrationNotes))
            noteParts.Add(dto.AdministrationNotes.Trim());
        else if (!string.IsNullOrWhiteSpace(dto.Remarks))
            noteParts.Add(dto.Remarks.Trim());

        // Keep a short administration trail on the appointment (useful for legacy guest rows).
        var adminSummary =
            $"Administered lot {batch.BatchNumber}; route {route}; site {(site?.ToString() ?? "n/a")}";
        if (!string.IsNullOrWhiteSpace(dto.AdministrationNotes))
            adminSummary += $"; {dto.AdministrationNotes.Trim()}";
        appointment.Notes = string.IsNullOrWhiteSpace(appointment.Notes)
            ? adminSummary
            : $"{appointment.Notes.Trim()}\n{adminSummary}";

        if (appointment.PatientProfileId is Guid patientProfileId)
        {
            var patientExists = await _context.PatientProfiles.AnyAsync(p => p.Id == patientProfileId);
            if (patientExists)
            {
                var priorDoses = await _context.PatientVaccinationRecords.CountAsync(r =>
                    r.PatientProfileId == patientProfileId && r.VaccineId == vaccine.Id);

                _context.PatientVaccinationRecords.Add(new PatientVaccinationRecord
                {
                    PatientProfileId = patientProfileId,
                    VaccineId = vaccine.Id,
                    BatchId = batch.Id,
                    AdministeredByUserId = actorUserId,
                    AdministeredByName = actorName,
                    AdministeredAt = DateTime.UtcNow,
                    DoseNumber = priorDoses + 1,
                    Route = route,
                    Site = site,
                    LotNumber = batch.BatchNumber,
                    Notes = string.Join(". ", noteParts)
                });
            }
        }
    }

    private static VaccineRoute ParseVaccineRoute(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return VaccineRoute.Intramuscular;

        var value = raw.Trim().ToLowerInvariant();
        if (value.Contains("subcut") || value is "sc" or "subcutaneous (sc)")
            return VaccineRoute.Subcutaneous;
        if (value.Contains("intraderm") || value is "id" or "intradermal (id)")
            return VaccineRoute.Intradermal;
        if (value.Contains("oral") || value is "po" or "oral (po)")
            return VaccineRoute.Oral;
        if (value.Contains("nasal"))
            return VaccineRoute.Nasal;
        if (Enum.TryParse<VaccineRoute>(raw.Trim(), true, out var parsed))
            return parsed;
        return VaccineRoute.Intramuscular;
    }

    private static InjectionSite? ParseInjectionSite(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var value = raw.Trim().ToLowerInvariant();
        if (value.Contains("left") && value.Contains("deltoid"))
            return InjectionSite.LeftDeltoid;
        if (value.Contains("right") && value.Contains("deltoid"))
            return InjectionSite.RightDeltoid;
        if (value.Contains("left") && (value.Contains("thigh") || value.Contains("anterolateral")))
            return InjectionSite.LeftThigh;
        if (value.Contains("right") && (value.Contains("thigh") || value.Contains("anterolateral")))
            return InjectionSite.RightThigh;
        if (value.Contains("oral"))
            return InjectionSite.Oral;
        if (value.Contains("nasal"))
            return InjectionSite.Nasal;
        if (Enum.TryParse<InjectionSite>(raw.Replace(" ", string.Empty), true, out var parsed))
            return parsed;
        return null;
    }

    private static AppointmentResponseDto MapToStaffListDto(Appointment a)
    {
        var dto = MapToDto(a);
        dto.PatientNic = null;
        dto.PatientPhone = null;
        dto.PatientEmail = null;
        return dto;
    }

    private static AppointmentResponseDto MapToDto(Appointment a)
    {
        var notesBooth = ExtractBoothFromNotes(a.Notes);
        var profile = a.PatientUser?.PatientProfile;
        var liveName = profile?.FullName?.Trim();
        var livePhone = profile?.PhoneNumber?.Trim() ?? a.PatientUser?.PhoneNumber?.Trim();
        var liveEmail = a.PatientUser?.Email?.Trim();
        var liveNic = profile?.NicNumber?.Trim();

        return new AppointmentResponseDto
        {
            Id = a.Id,
            PatientUserId = a.PatientUserId,
            PatientProfileId = a.PatientProfileId ?? profile?.Id,
            // Prefer live profile fields so hospital/staff queues reflect profile edits.
            PatientName = !string.IsNullOrWhiteSpace(liveName) ? liveName : a.PatientName,
            PatientNic = !string.IsNullOrWhiteSpace(liveNic) ? liveNic : a.PatientNic,
            PatientPhone = !string.IsNullOrWhiteSpace(livePhone) ? livePhone : a.PatientPhone,
            PatientEmail = !string.IsNullOrWhiteSpace(liveEmail) ? liveEmail : a.PatientEmail,
            HospitalUserId = a.HospitalUserId,
            HospitalName = a.HospitalName,
            VaccineScheduleId = a.VaccineScheduleId,
            VaccineId = a.VaccineId,
            VaccineName = a.VaccineName,
            DoctorName = a.DoctorName,
            NurseName = a.NurseName,
            AppointmentDate = a.AppointmentDate.ToString("yyyy-MM-dd"),
            TimeSlot = a.TimeSlot,
            StartTime = a.StartTime,
            EndTime = a.EndTime,
            Status = a.Status,
            Fee = a.Fee,
            PaymentMethod = a.PaymentMethod,
            PaymentStatus = a.PaymentStatus,
            PaymentTransactionId = a.PaymentTransactionId,
            Notes = a.Notes,
            // Walk-ins record their assigned booth in notes; it wins over a linked session's booth.
            BoothId = notesBooth == null ||
                      string.Equals(notesBooth, a.VaccineSchedule?.BoothLabel, StringComparison.OrdinalIgnoreCase)
                ? a.VaccineSchedule?.BoothId
                : null,
            BoothLabel = notesBooth ?? a.VaccineSchedule?.BoothLabel,
            PrescribedDosage = a.PrescribedDosage,
            PrescribedByDoctorUserId = a.PrescribedByDoctorUserId,
            PrescribedByDoctorName = a.PrescribedByDoctorName,
            DosageUpdatedAt = a.DosageUpdatedAt,
            CheckedInAt = a.CheckedInAt,
            CreatedAt = a.CreatedAt,
            UpdatedAt = a.UpdatedAt
        };
    }
}
