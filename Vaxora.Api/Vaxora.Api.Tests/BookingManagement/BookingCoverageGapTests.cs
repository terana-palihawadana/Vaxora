using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.BookingManagement;

/// <summary>
/// Booking-management paths not covered by <see cref="VaccinationBookingTests"/> or the
/// clinical workflow tests. The "Defect_" tests assert the intended business rule and
/// currently FAIL — each one documents a bug in AppointmentService.
/// </summary>
public class BookingCoverageGapTests
{
    // ── Available dates ──────────────────────────────────────────────────

    [Fact]
    public async Task GetAvailableDatesAsync_returns_active_one_time_session_and_skips_cancelled_schedule()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var activeDate = StaffDutyHelper.HospitalToday().AddDays(5);
        var cancelledDate = StaffDutyHelper.HospitalToday().AddDays(6);
        var active = AddSchedule(context, hospital, "Moderna", activeDate, price: 1500m);
        AddSchedule(context, hospital, "Moderna", cancelledDate, status: "Cancelled");
        await context.SaveChangesAsync();

        var dates = await CreateService(context).GetAvailableDatesAsync(hospital.Id, "Moderna");

        var only = Assert.Single(dates);
        Assert.Equal(activeDate.ToString("yyyy-MM-dd"), only.Date);
        Assert.Equal(active.Id, only.ScheduleId);
        Assert.Equal(1500m, only.Price);
        Assert.Equal("LKR 1,500.00", only.FormattedPrice);
    }

    [Fact]
    public async Task GetAvailableDatesAsync_weekly_schedule_only_returns_matching_weekdays_inside_range()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var start = StaffDutyHelper.HospitalToday().AddDays(1);
        var end = start.AddDays(20);
        context.VaccineSchedules.Add(new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Pfizer-BioNTech",
            ScheduleType = "Weekly",
            DaysOfWeek = "Monday,Thu",
            StartDate = start,
            EndDate = end,
            StartTime = "09:00",
            EndTime = "11:00",
            Status = "Active"
        });
        await context.SaveChangesAsync();

        var dates = await CreateService(context).GetAvailableDatesAsync(hospital.Id, "Pfizer-BioNTech");

        Assert.NotEmpty(dates);
        Assert.All(dates, d =>
        {
            Assert.Contains(d.DayOfWeek, new[] { "Monday", "Thursday" });
            var parsed = DateOnly.Parse(d.Date);
            Assert.InRange(parsed, start, end);
        });
        Assert.Equal(dates.Select(d => d.Date).OrderBy(d => d), dates.Select(d => d.Date));
    }

    // ── Booking guards ───────────────────────────────────────────────────

    [Fact]
    public async Task BookAppointmentAsync_rejects_a_past_date()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "past@example.com", "VAX-P-7001");
        await context.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
            {
                HospitalUserId = hospital.Id,
                VaccineName = "Moderna",
                AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(-1),
                TimeSlot = "09:00 AM - 09:20 AM"
            }));

        Assert.Contains("past date", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(context.Appointments);
    }

    [Fact]
    public async Task BookAppointmentAsync_rejects_a_slot_that_already_started_today()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "started@example.com", "VAX-P-7002");
        await context.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
            {
                HospitalUserId = hospital.Id,
                VaccineName = "Moderna",
                AppointmentDate = StaffDutyHelper.HospitalToday(),
                TimeSlot = "12:00 AM - 12:20 AM"
            }));

        Assert.Contains("already started", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ── Hospital desk status rules ───────────────────────────────────────

    [Fact]
    public async Task UpdateAppointmentStatusAsync_hospital_desk_cannot_set_clinical_status()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(context).UpdateAppointmentStatusAsync(
                hospital.Id, appointment.Id, new UpdateAppointmentStatusDto { Status = "Administering" }));

        Assert.Equal("Confirmed", (await context.Appointments.SingleAsync()).Status);
    }

    [Fact]
    public async Task UpdateAppointmentStatusAsync_hospital_confirming_PendingPayment_records_desk_payment()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital, status: "PendingPayment", paymentStatus: "PendingOnline");
        appointment.PaymentMethod = "PayHere";
        appointment.Fee = 2500m;
        await context.SaveChangesAsync();

        var result = await CreateService(context).UpdateAppointmentStatusAsync(
            hospital.Id, appointment.Id, new UpdateAppointmentStatusDto { Status = "confirmed" });

        Assert.Equal("Confirmed", result.Status);
        Assert.Equal("Paid", result.PaymentStatus);
        Assert.Equal("Hospital", result.PaymentMethod);
    }

    [Fact]
    public async Task UpdateAppointmentStatusAsync_rejects_unaffiliated_doctor()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "stranger-doc@example.com", "VAX-D-7001");
        var appointment = TestDb.AddAppointment(context, hospital);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(context).UpdateAppointmentStatusAsync(
                doctor.Id, appointment.Id, new UpdateAppointmentStatusDto { Status = "Administering" }));
    }

    [Fact]
    public async Task UpdateAppointmentStatusAsync_rejects_unknown_status_value()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital);
        await context.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).UpdateAppointmentStatusAsync(
                hospital.Id, appointment.Id, new UpdateAppointmentStatusDto { Status = "Teleported" }));

        Assert.Contains("Unsupported status", ex.Message);
    }

    [Fact]
    public async Task UpdateAppointmentStatusAsync_cannot_reopen_a_cancelled_appointment()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Cancelled");
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).UpdateAppointmentStatusAsync(
                hospital.Id, appointment.Id, new UpdateAppointmentStatusDto { Status = "Confirmed" }));
    }

    // ── Cancellation ─────────────────────────────────────────────────────

    [Fact]
    public async Task CancelAppointmentAsync_hospital_can_cancel_inside_24_hour_window()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital, date: StaffDutyHelper.HospitalToday());
        await context.SaveChangesAsync();

        var ok = await CreateService(context).CancelAppointmentAsync(hospital.Id, appointment.Id, isHospital: true);

        Assert.True(ok);
        Assert.Equal("Cancelled", (await context.Appointments.SingleAsync()).Status);
    }

    [Fact]
    public async Task CancelAppointmentAsync_other_hospital_cannot_cancel()
    {
        await using var context = TestDb.CreateContext();
        var owner = TestDb.AddHospital(context);
        var other = TestDb.AddHospital(context, "other-hospital@example.com", "VAX-H-9002");
        var appointment = TestDb.AddAppointment(context, owner);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            CreateService(context).CancelAppointmentAsync(other.Id, appointment.Id, isHospital: true));

        Assert.Equal("Confirmed", (await context.Appointments.SingleAsync()).Status);
    }

    [Fact]
    public async Task CancelAppointmentAsync_is_idempotent_for_already_cancelled_appointment()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Cancelled");
        var originalUpdatedAt = appointment.UpdatedAt;
        await context.SaveChangesAsync();

        var ok = await CreateService(context).CancelAppointmentAsync(hospital.Id, appointment.Id, isHospital: true);

        Assert.True(ok);
        Assert.Equal(originalUpdatedAt, (await context.Appointments.SingleAsync()).UpdatedAt);
    }

    // ── PayHere confirmation edge cases ──────────────────────────────────

    [Fact]
    public async Task ConfirmPayHerePaymentAsync_rejects_cancelled_appointment()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Cancelled", paymentStatus: "PendingOnline");
        appointment.Fee = 2500m;
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).ConfirmPayHerePaymentAsync(appointment.Id, "PH-123"));

        Assert.Equal("PendingOnline", (await context.Appointments.SingleAsync()).PaymentStatus);
    }

    [Fact]
    public async Task ConfirmPayHerePaymentAsync_repeat_notification_keeps_original_transaction_id()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var appointment = TestDb.AddAppointment(context, hospital);
        appointment.Fee = 2500m;
        appointment.PaymentMethod = "PayHere";
        appointment.PaymentTransactionId = "PH-ORIGINAL";
        await context.SaveChangesAsync();

        var result = await CreateService(context).ConfirmPayHerePaymentAsync(appointment.Id, "PH-REPLAY");

        Assert.Equal("PH-ORIGINAL", result.PaymentTransactionId);
    }

    [Fact]
    public async Task ConfirmPayHerePaymentAsync_throws_for_unknown_appointment()
    {
        await using var context = TestDb.CreateContext();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            CreateService(context).ConfirmPayHerePaymentAsync(Guid.NewGuid(), "PH-1"));
    }

    // ── List scoping ─────────────────────────────────────────────────────

    [Fact]
    public async Task GetPatientAppointmentsAsync_returns_only_the_callers_bookings()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var me = AddPatient(context, "me@example.com", "VAX-P-7003");
        var someoneElse = AddPatient(context, "else@example.com", "VAX-P-7004");
        var mine = TestDb.AddAppointment(context, hospital);
        mine.PatientUserId = me.Id;
        var theirs = TestDb.AddAppointment(context, hospital);
        theirs.PatientUserId = someoneElse.Id;
        await context.SaveChangesAsync();

        var list = await CreateService(context).GetPatientAppointmentsAsync(me.Id);

        Assert.Equal(mine.Id, Assert.Single(list).Id);
    }

    [Fact]
    public async Task GetHospitalAppointmentsAsync_filters_by_status_and_excludes_other_hospitals()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var other = TestDb.AddHospital(context, "other-h@example.com", "VAX-H-9003");
        TestDb.AddAppointment(context, hospital, status: "Confirmed");
        var cancelled = TestDb.AddAppointment(context, hospital, status: "Cancelled");
        TestDb.AddAppointment(context, other, status: "Cancelled");
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var filtered = await service.GetHospitalAppointmentsAsync(hospital.Id, status: "cancelled");
        var all = await service.GetHospitalAppointmentsAsync(hospital.Id, status: "All");

        Assert.Equal(cancelled.Id, Assert.Single(filtered).Id);
        Assert.Equal(2, all.Count);
    }

    // ── Staff clinical queue ─────────────────────────────────────────────

    [Fact]
    public async Task GetStaffHospitalAppointmentsAsync_rejects_unaffiliated_staff()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "loose-nurse@example.com", "VAX-N-7001");
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(context).GetStaffHospitalAppointmentsAsync(nurse.Id, hospital.Id));
    }

    [Fact]
    public async Task GetStaffHospitalAppointmentsAsync_masks_patient_contact_and_hides_cancelled()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "queue-nurse@example.com", "VAX-N-7002");
        TestDb.AddActiveAffiliation(context, hospital, nurse);
        var open = TestDb.AddAppointment(context, hospital);
        open.PatientNic = "901234567V";
        open.PatientPhone = "+94771234567";
        open.PatientEmail = "pii@example.com";
        TestDb.AddAppointment(context, hospital, status: "Cancelled");
        await context.SaveChangesAsync();

        var queue = await CreateService(context).GetStaffHospitalAppointmentsAsync(nurse.Id, hospital.Id);

        var row = Assert.Single(queue);
        Assert.Equal(open.Id, row.Id);
        Assert.Null(row.PatientNic);
        Assert.Null(row.PatientPhone);
        Assert.Null(row.PatientEmail);
        Assert.Contains(context.AuditLogs, l => l.Action == "STAFF_CLINICAL_QUEUE_VIEW");
    }

    [Fact]
    public async Task GetStaffHospitalAppointmentsAsync_rejects_dates_beyond_plus_minus_one_day()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "range-doc@example.com", "VAX-D-7002");
        TestDb.AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).GetStaffHospitalAppointmentsAsync(
                doctor.Id, hospital.Id, StaffDutyHelper.HospitalToday().AddDays(5)));
    }

    // ── Schedule management ──────────────────────────────────────────────

    [Fact]
    public async Task ScheduleService_CreateScheduleAsync_rejects_past_one_time_date()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateScheduleService(context).CreateScheduleAsync(hospital.Id, new CreateVaccineScheduleDto
            {
                VaccineName = "Moderna",
                ScheduleType = "OneTime",
                SpecificDate = StaffDutyHelper.HospitalToday().AddDays(-2),
                StartTime = "09:00",
                EndTime = "11:00",
                BoothId = Guid.NewGuid()
            }));

        Assert.Contains("past", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ScheduleService_CancelScheduleAsync_is_blocked_while_upcoming_bookings_exist()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var date = StaffDutyHelper.HospitalToday().AddDays(3);
        var schedule = AddSchedule(context, hospital, "Moderna", date);
        var booking = TestDb.AddAppointment(context, hospital, date: date);
        booking.VaccineScheduleId = schedule.Id;
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateScheduleService(context).CancelScheduleAsync(hospital.Id, schedule.Id));

        Assert.Equal("Active", (await context.VaccineSchedules.SingleAsync()).Status);
    }

    [Fact]
    public async Task ScheduleService_CancelScheduleAsync_succeeds_when_only_cancelled_bookings_remain()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var date = StaffDutyHelper.HospitalToday().AddDays(3);
        var schedule = AddSchedule(context, hospital, "Moderna", date);
        var booking = TestDb.AddAppointment(context, hospital, status: "Cancelled", date: date);
        booking.VaccineScheduleId = schedule.Id;
        await context.SaveChangesAsync();

        var ok = await CreateScheduleService(context).CancelScheduleAsync(hospital.Id, schedule.Id);

        Assert.True(ok);
        Assert.Equal("Cancelled", (await context.VaccineSchedules.SingleAsync()).Status);
    }

    // ── Known defects (these tests FAIL against the current code) ─────────

    /// <summary>
    /// BUG: BookAppointmentAsync trusts VaccineScheduleId without checking the schedule
    /// belongs to the chosen hospital. A free schedule from another hospital makes a paid
    /// booking free (Fee = 0, Status = Confirmed) — a payment bypass.
    /// </summary>
    [Fact]
    public async Task Defect_BookAppointmentAsync_rejects_schedule_id_from_a_different_hospital()
    {
        await using var context = TestDb.CreateContext();
        var paidHospital = TestDb.AddHospital(context);
        var freeHospital = TestDb.AddHospital(context, "free-h@example.com", "VAX-H-9004");
        var patient = AddPatient(context, "bypass@example.com", "VAX-P-7005");
        var date = StaffDutyHelper.HospitalToday().AddDays(4);
        AddSchedule(context, paidHospital, "Sinopharm", date, price: 2500m);
        var foreignFree = AddSchedule(context, freeHospital, "Pfizer-BioNTech", date, price: 0m);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
            {
                HospitalUserId = paidHospital.Id,
                VaccineName = "Sinopharm",
                VaccineScheduleId = foreignFree.Id,
                AppointmentDate = date,
                TimeSlot = "09:00 AM - 09:20 AM"
            }));
    }

    /// <summary>
    /// BUG: TimeSlot is free text and never checked against the session's 20-minute grid,
    /// so a patient can book 3 AM (and every made-up string gets its own capacity of 3).
    /// </summary>
    [Fact]
    public async Task Defect_BookAppointmentAsync_rejects_time_slot_outside_the_session_window()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "offgrid@example.com", "VAX-P-7006");
        var date = StaffDutyHelper.HospitalToday().AddDays(4);
        var schedule = AddSchedule(context, hospital, "Moderna", date);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
            {
                HospitalUserId = hospital.Id,
                VaccineName = "Moderna",
                VaccineScheduleId = schedule.Id,
                AppointmentDate = date,
                TimeSlot = "03:00 AM - 03:20 AM"
            }));
    }

    /// <summary>
    /// BUG: When no session runs on the requested date, GetAvailableTimeSlotsAsync invents
    /// a default 09:00–11:00 window, so patients see (and can book) slots on closed days.
    /// </summary>
    [Fact]
    public async Task Defect_GetAvailableTimeSlotsAsync_returns_no_slots_on_a_day_without_a_session()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var sessionDate = StaffDutyHelper.HospitalToday().AddDays(4);
        AddSchedule(context, hospital, "Moderna", sessionDate);
        await context.SaveChangesAsync();

        var slots = await CreateService(context)
            .GetAvailableTimeSlotsAsync(hospital.Id, "Moderna", sessionDate.AddDays(1));

        Assert.Empty(slots);
    }

    /// <summary>
    /// BUG: Slot capacity is counted per hospital + time string, not per session/booth.
    /// Two booths running different vaccines at the same time share 3 seats in total, while
    /// ScheduleStockPlanner reserves 3 seats per slot for EACH schedule.
    /// </summary>
    [Fact]
    public async Task Defect_BookAppointmentAsync_capacity_is_per_session_not_shared_across_booths()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var date = StaffDutyHelper.HospitalToday().AddDays(4);
        var modernaBooth = AddSchedule(context, hospital, "Moderna", date, boothLabel: "Booth A");
        var pfizerBooth = AddSchedule(context, hospital, "Pfizer-BioNTech", date, boothLabel: "Booth B");
        var patients = Enumerable.Range(1, 4)
            .Select(i => AddPatient(context, $"booth{i}@example.com", $"VAX-P-71{i:00}"))
            .ToList();
        await context.SaveChangesAsync();
        var service = CreateService(context);
        const string slot = "09:00 AM - 09:20 AM";

        for (var i = 0; i < ScheduleStockPlanner.PatientsPerSlot; i++)
        {
            await service.BookAppointmentAsync(patients[i].Id, new BookAppointmentRequestDto
            {
                HospitalUserId = hospital.Id,
                VaccineName = "Moderna",
                VaccineScheduleId = modernaBooth.Id,
                AppointmentDate = date,
                TimeSlot = slot
            });
        }

        // Booth B has its own staff and stock; its 09:00 band should still be open.
        var pfizer = await service.BookAppointmentAsync(patients[3].Id, new BookAppointmentRequestDto
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Pfizer-BioNTech",
            VaccineScheduleId = pfizerBooth.Id,
            AppointmentDate = date,
            TimeSlot = slot
        });

        Assert.Equal("Confirmed", pfizer.Status);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static VaccineSchedule AddSchedule(
        ApplicationDbContext context,
        User hospital,
        string vaccineName,
        DateOnly date,
        decimal price = 0m,
        string status = "Active",
        string? boothLabel = null)
    {
        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = vaccineName,
            ScheduleType = "OneTime",
            SpecificDate = date,
            StartTime = "09:00",
            EndTime = "11:00",
            Status = status,
            Price = price,
            BoothLabel = boothLabel
        };
        context.VaccineSchedules.Add(schedule);
        return schedule;
    }

    private static AppointmentService CreateService(ApplicationDbContext context) =>
        new(
            context,
            new FakeEmailService(),
            new FakePasswordHasher(),
            new FakeRegistrationNumberService(),
            NullLogger<AppointmentService>.Instance);

    private static ScheduleService CreateScheduleService(ApplicationDbContext context) =>
        new(context, NullLogger<ScheduleService>.Instance);

    private static User AddPatient(
        ApplicationDbContext context,
        string email,
        string registrationNumber)
    {
        var patient = new User
        {
            Email = email,
            PasswordHash = "test-hash",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            RegistrationNumber = registrationNumber,
            PatientProfile = new PatientProfile
            {
                FullName = "Test Patient",
                NicNumber = $"90{Random.Shared.Next(1000000, 9999999)}V",
                PhoneNumber = "+94770000000",
                DateOfBirth = new DateTime(1995, 5, 20, 0, 0, 0, DateTimeKind.Utc)
            }
        };
        context.Users.Add(patient);
        return patient;
    }
}
