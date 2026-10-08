using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using System.Globalization;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.BookingManagement;

public class VaccinationBookingTests
{
    [Fact]
    public async Task BookAppointmentAsync_creates_Confirmed_and_Paid_for_free_schedule()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient1@example.com", "VAX-P-4001");
        var scheduleDate = StaffDutyHelper.HospitalToday().AddDays(3);

        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Pfizer-BioNTech",
            ScheduleType = "OneTime",
            SpecificDate = scheduleDate,
            StartTime = "09:00",
            EndTime = "11:00",
            Status = "Active",
            Price = 0.00m
        };
        context.VaccineSchedules.Add(schedule);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var result = await service.BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Pfizer-BioNTech",
            VaccineScheduleId = schedule.Id,
            AppointmentDate = scheduleDate,
            TimeSlot = "09:00 AM - 09:20 AM"
        });

        Assert.Equal("Confirmed", result.Status);
        Assert.Equal("Free", result.PaymentMethod);
        Assert.Equal("Paid", result.PaymentStatus);
        Assert.Equal(0.00m, result.Fee);
        Assert.Equal(patient.Id, result.PatientUserId);
        Assert.Equal("09:00 AM - 09:20 AM", result.TimeSlot);

        var stored = await context.Appointments.SingleAsync(a => a.Id == result.Id);
        Assert.Equal("Confirmed", stored.Status);
        Assert.Equal("Paid", stored.PaymentStatus);
    }

    [Fact]
    public async Task BookAppointmentAsync_creates_PendingPayment_when_schedule_has_fee()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient2@example.com", "VAX-P-4002");
        var scheduleDate = StaffDutyHelper.HospitalToday().AddDays(4);

        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Sinopharm",
            ScheduleType = "OneTime",
            SpecificDate = scheduleDate,
            StartTime = "09:00",
            EndTime = "11:00",
            Status = "Active",
            Price = 2500.00m
        };
        context.VaccineSchedules.Add(schedule);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var result = await service.BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Sinopharm",
            VaccineScheduleId = schedule.Id,
            AppointmentDate = scheduleDate,
            TimeSlot = "09:20 AM - 09:40 AM"
        });

        Assert.Equal("PendingPayment", result.Status);
        Assert.Equal("PayHere", result.PaymentMethod);
        Assert.Equal("PendingOnline", result.PaymentStatus);
        Assert.Equal(2500.00m, result.Fee);
    }

    [Fact]
    public async Task BookAppointmentAsync_allows_up_to_three_patients_per_20min_slot_then_rejects()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patients = Enumerable.Range(1, 4)
            .Select(i => AddPatient(context, $"patient-cap{i}@example.com", $"VAX-P-4{i:000}"))
            .ToList();
        var appointmentDate = StaffDutyHelper.HospitalToday().AddDays(2);
        const string slot = "10:00 AM - 10:20 AM";

        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Moderna",
            ScheduleType = "OneTime",
            SpecificDate = appointmentDate,
            StartTime = "10:00",
            EndTime = "11:00",
            Status = "Active",
            Price = 0.00m
        };
        context.VaccineSchedules.Add(schedule);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var dtoFor = (Guid patientId) => new BookAppointmentRequestDto
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Moderna",
            VaccineScheduleId = schedule.Id,
            AppointmentDate = appointmentDate,
            TimeSlot = slot
        };

        // First 3 seats succeed
        for (var i = 0; i < 3; i++)
        {
            var booked = await service.BookAppointmentAsync(patients[i].Id, dtoFor(patients[i].Id));
            Assert.Equal("Confirmed", booked.Status);
        }

        // 4th patient is rejected — band is full
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.BookAppointmentAsync(patients[3].Id, dtoFor(patients[3].Id)));

        Assert.Contains("full", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task BookAppointmentAsync_allows_booking_slot_if_previous_booking_was_cancelled()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient1 = AddPatient(context, "patient5@example.com", "VAX-P-4005");
        var patient2 = AddPatient(context, "patient6@example.com", "VAX-P-4006");
        var appointmentDate = StaffDutyHelper.HospitalToday().AddDays(2);
        const string slot = "10:20 AM - 10:40 AM";

        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Moderna",
            ScheduleType = "OneTime",
            SpecificDate = appointmentDate,
            StartTime = "10:00",
            EndTime = "11:00",
            Status = "Active",
            Price = 0.00m
        };
        context.VaccineSchedules.Add(schedule);
        await context.SaveChangesAsync();

        var service = CreateService(context);

        // Patient 1 books and then cancels
        var firstBooking = await service.BookAppointmentAsync(patient1.Id, new BookAppointmentRequestDto
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Moderna",
            VaccineScheduleId = schedule.Id,
            AppointmentDate = appointmentDate,
            TimeSlot = slot
        });

        await service.CancelAppointmentAsync(patient1.Id, firstBooking.Id, isHospital: false);

        // Patient 2 should now be able to book the released slot
        var secondBooking = await service.BookAppointmentAsync(patient2.Id, new BookAppointmentRequestDto
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Moderna",
            VaccineScheduleId = schedule.Id,
            AppointmentDate = appointmentDate,
            TimeSlot = slot
        });

        Assert.Equal("Confirmed", secondBooking.Status);
        Assert.Equal(patient2.Id, secondBooking.PatientUserId);
    }

    [Fact]
    public async Task BookAppointmentAsync_throws_UnauthorizedAccessException_when_patient_not_found()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.BookAppointmentAsync(Guid.NewGuid(), new BookAppointmentRequestDto
            {
                HospitalUserId = hospital.Id,
                VaccineName = "Pfizer",
                AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(1),
                TimeSlot = "09:00 AM - 09:20 AM"
            }));
    }

    [Fact]
    public async Task BookAppointmentAsync_throws_KeyNotFoundException_when_hospital_not_found()
    {
        await using var context = TestDb.CreateContext();
        var patient = AddPatient(context, "patient7@example.com", "VAX-P-4007");
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.BookAppointmentAsync(patient.Id, new BookAppointmentRequestDto
            {
                HospitalUserId = Guid.NewGuid(),
                VaccineName = "Pfizer",
                AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(1),
                TimeSlot = "09:00 AM - 09:20 AM"
            }));
    }

    [Fact]
    public async Task GetAvailableTimeSlotsAsync_returns_20min_intervals_and_flags_booked_slots()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient8@example.com", "VAX-P-4008");
        var targetDate = StaffDutyHelper.HospitalToday().AddDays(1);

        var schedule = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Rabies Vaccine",
            ScheduleType = "OneTime",
            SpecificDate = targetDate,
            StartTime = "09:00",
            EndTime = "10:00", // 3 slots: 09:00-09:20, 09:20-09:40, 09:40-10:00
            Status = "Active",
            Price = 0.00m
        };
        context.VaccineSchedules.Add(schedule);

        // Pre-book the first slot
        context.Appointments.Add(new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = patient.Id,
            PatientName = "Prebooked Patient",
            VaccineName = "Rabies Vaccine",
            AppointmentDate = targetDate,
            TimeSlot = "09:00 AM - 09:20 AM",
            StartTime = "09:00",
            EndTime = "09:20",
            Status = "Confirmed",
            PaymentStatus = "Paid"
        });
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var slots = await service.GetAvailableTimeSlotsAsync(hospital.Id, "Rabies Vaccine", targetDate);

        Assert.Equal(3, slots.Count);
        Assert.False(slots[0].IsBooked); // 1 of 3 seats taken — still open
        Assert.Equal(1, slots[0].BookedCount);
        Assert.Equal(3, slots[0].Capacity);
        Assert.Equal(2, slots[0].SeatsRemaining);
        Assert.Equal("09:00 AM - 09:20 AM", slots[0].Slot);
        Assert.False(slots[1].IsBooked);
        Assert.Equal("09:20 AM - 09:40 AM", slots[1].Slot);
        Assert.False(slots[2].IsBooked);
        Assert.Equal("09:40 AM - 10:00 AM", slots[2].Slot);
    }

    [Fact]
    public async Task ConfirmPayHerePaymentAsync_transitions_PendingPayment_to_Confirmed_and_Paid()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient9@example.com", "VAX-P-4009");

        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = patient.Id,
            PatientName = "Paying Patient",
            VaccineName = "Influenza",
            AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(2),
            TimeSlot = "10:00 AM - 10:20 AM",
            Status = "PendingPayment",
            PaymentMethod = "PayHere",
            PaymentStatus = "PendingOnline",
            Fee = 1500.00m
        };
        context.Appointments.Add(appointment);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var confirmed = await service.ConfirmPayHerePaymentAsync(appointment.Id, "TXN-PAYHERE-5544", "ORDER-991");

        Assert.Equal("Confirmed", confirmed.Status);
        Assert.Equal("Paid", confirmed.PaymentStatus);
        Assert.Equal("TXN-PAYHERE-5544", confirmed.PaymentTransactionId);

        var stored = await context.Appointments.SingleAsync(a => a.Id == appointment.Id);
        Assert.Equal("Confirmed", stored.Status);
        Assert.Equal("Paid", stored.PaymentStatus);
        Assert.Equal("TXN-PAYHERE-5544", stored.PaymentTransactionId);
    }

    [Fact]
    public async Task ConfirmPayHerePaymentAsync_rejects_free_appointment()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient10@example.com", "VAX-P-4010");

        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = patient.Id,
            PatientName = "Free Patient",
            VaccineName = "MMR",
            AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(2),
            TimeSlot = "10:00 AM - 10:20 AM",
            Status = "PendingPayment",
            PaymentMethod = "PayHere",
            PaymentStatus = "PendingOnline",
            Fee = 0.00m
        };
        context.Appointments.Add(appointment);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.ConfirmPayHerePaymentAsync(appointment.Id, "TXN-IRRELEVANT"));

        Assert.Contains("does not require PayHere payment", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CancelAppointmentAsync_patient_cancels_own_appointment()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient11@example.com", "VAX-P-4011");

        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = patient.Id,
            PatientName = "Patient To Cancel",
            PatientEmail = patient.Email,
            VaccineName = "Polio",
            AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(3),
            TimeSlot = "11:00 AM - 11:20 AM",
            Status = "Confirmed",
            PaymentStatus = "Paid"
        };
        context.Appointments.Add(appointment);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var cancelled = await service.CancelAppointmentAsync(patient.Id, appointment.Id, isHospital: false);

        Assert.True(cancelled);
        var stored = await context.Appointments.SingleAsync(a => a.Id == appointment.Id);
        Assert.Equal("Cancelled", stored.Status);
    }

    [Fact]
    public async Task CancelAppointmentAsync_blocks_patient_cancellation_within_24_hours()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient-within-cutoff@example.com", "VAX-P-4015");
        var appointmentStart = StaffDutyHelper.HospitalNow().AddHours(12);

        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = patient.Id,
            PatientName = "Patient Within Cutoff",
            VaccineName = "Polio",
            AppointmentDate = DateOnly.FromDateTime(appointmentStart),
            TimeSlot = $"{appointmentStart.ToString("hh:mm tt", CultureInfo.InvariantCulture)} - " +
                       $"{appointmentStart.AddMinutes(20).ToString("hh:mm tt", CultureInfo.InvariantCulture)}",
            Status = "Confirmed",
            PaymentStatus = "Paid"
        };
        context.Appointments.Add(appointment);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CancelAppointmentAsync(patient.Id, appointment.Id, isHospital: false));

        Assert.Contains("at least 24 hours", ex.Message, StringComparison.OrdinalIgnoreCase);

        var hospitalCancelled = await service.CancelAppointmentAsync(
            hospital.Id,
            appointment.Id,
            isHospital: true);
        Assert.True(hospitalCancelled);
    }

    [Fact]
    public async Task CancelAppointmentAsync_blocks_other_patient_from_cancelling()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var owner = AddPatient(context, "owner@example.com", "VAX-P-4012");
        var intruder = AddPatient(context, "intruder@example.com", "VAX-P-4013");

        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = owner.Id,
            PatientName = "Owner Patient",
            VaccineName = "Polio",
            AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(3),
            TimeSlot = "11:00 AM - 11:20 AM",
            Status = "Confirmed",
            PaymentStatus = "Paid"
        };
        context.Appointments.Add(appointment);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.CancelAppointmentAsync(intruder.Id, appointment.Id, isHospital: false));
    }

    [Fact]
    public async Task CancelAppointmentAsync_blocks_cancellation_of_Completed_appointment_by_patient()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "patient14@example.com", "VAX-P-4014");

        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            PatientUserId = patient.Id,
            PatientName = "Completed Patient",
            VaccineName = "Hepatitis B",
            AppointmentDate = StaffDutyHelper.HospitalToday().AddDays(-1),
            TimeSlot = "09:00 AM - 09:20 AM",
            Status = "Completed",
            PaymentStatus = "Paid"
        };
        context.Appointments.Add(appointment);
        await context.SaveChangesAsync();

        var service = CreateService(context);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CancelAppointmentAsync(patient.Id, appointment.Id, isHospital: false));

        Assert.Contains("Completed vaccination appointments cannot be cancelled", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateWalkInAppointmentAsync_creates_confirmed_appointment_and_auto_provisions_patient()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var walkInDto = new CreateWalkInAppointmentDto
        {
            PatientNic = "921234567V",
            PatientName = "Walkin John Doe",
            PatientEmail = "walkin.john@example.com",
            PatientPhone = "+94771122334",
            VaccineName = "Tetanus Toxoid",
            Dose = "0.5ml",
            BoothLabel = "Booth A"
        };

        var result = await service.CreateWalkInAppointmentAsync(hospital.Id, walkInDto);

        Assert.Equal("Confirmed", result.Status);
        Assert.Equal("WalkIn", result.PaymentMethod);
        Assert.Equal("Paid", result.PaymentStatus);
        Assert.Equal("Walkin John Doe", result.PatientName);
        Assert.Equal("Tetanus Toxoid", result.VaccineName);
        // The desk cannot prescribe: a doctor must set the dosage before administration.
        Assert.Null(result.PrescribedDosage);

        // Confirm patient user was auto-provisioned
        var user = await context.Users.Include(u => u.PatientProfile)
            .SingleOrDefaultAsync(u => u.Email == "walkin.john@example.com");
        Assert.NotNull(user);
        Assert.Equal(UserRole.PATIENT, user.Role);
        Assert.NotNull(user.PatientProfile);
        Assert.Equal("921234567V", user.PatientProfile.NicNumber);
    }

    [Fact]
    public async Task CreateWalkInAppointmentAsync_auto_assigns_staffed_booth_that_offers_the_vaccine()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "walkin.nurse@example.com", "VAX-N-4100");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        var tetanus = AddVaccine(context, "Tetanus Toxoid");
        var flu = AddVaccine(context, "Influenza");
        AddBooth(context, hospital, "B01", "Adult", 1, flu);
        var quietBooth = AddBooth(context, hospital, "B02", "Travel", 2, tetanus);
        var staffedBooth = AddBooth(context, hospital, "B03", "Wound care", 3, tetanus);
        var shift = TestDb.AddLiveShift(context, affiliation, hospital);
        shift.BoothId = staffedBooth.Id;
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.CreateWalkInAppointmentAsync(hospital.Id, WalkIn("Tetanus Toxoid", boothLabel: null));

        Assert.Equal(staffedBooth.DisplayLabel, result.BoothLabel);
        Assert.NotEqual(quietBooth.DisplayLabel, result.BoothLabel);
    }

    [Fact]
    public async Task CreateWalkInAppointmentAsync_rejects_desk_booth_that_does_not_offer_the_vaccine()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var tetanus = AddVaccine(context, "Tetanus Toxoid");
        var flu = AddVaccine(context, "Influenza");
        var fluBooth = AddBooth(context, hospital, "B01", "Adult", 1, flu);
        AddBooth(context, hospital, "B02", "Travel", 2, tetanus);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateWalkInAppointmentAsync(hospital.Id, WalkIn("Tetanus Toxoid", fluBooth.DisplayLabel)));

        Assert.Contains("does not offer", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateWalkInAppointmentAsync_returns_clean_booth_label_from_notes()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var tetanus = AddVaccine(context, "Tetanus Toxoid");
        var booth = AddBooth(context, hospital, "B02", "Travel", 1, tetanus);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var dto = WalkIn("Tetanus Toxoid", booth.DisplayLabel);
        dto.Age = 30;
        dto.Gender = "Female";
        var result = await service.CreateWalkInAppointmentAsync(hospital.Id, dto);

        Assert.Equal("B02 · Travel", result.BoothLabel);
    }

    [Fact]
    public async Task CreateWalkInAppointmentAsync_charges_the_hospital_price_for_paid_vaccines()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var vaccine = AddVaccine(context, "Tetanus Toxoid");
        context.HospitalFormularies.Add(new HospitalFormulary
        {
            HospitalProfileId = hospital.HospitalProfile!.Id,
            VaccineId = vaccine.Id,
            Price = 2500m
        });
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.CreateWalkInAppointmentAsync(hospital.Id, WalkIn("Tetanus Toxoid", boothLabel: null));

        Assert.Equal("PendingPayment", result.Status);
        Assert.Equal(2500m, result.Fee);
        Assert.NotEqual("Paid", result.PaymentStatus);
    }

    [Fact]
    public async Task CreateWalkInAppointmentAsync_checks_in_todays_booking_for_same_vaccine_but_not_others()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var patient = AddPatient(context, "booked@example.com", "VAX-P-4100");
        var booking = TestDb.AddAppointment(context, hospital, status: "Confirmed");
        booking.PatientUserId = patient.Id;
        booking.VaccineName = "Tetanus Toxoid";
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var nic = patient.PatientProfile!.NicNumber;

        var sameVaccine = WalkIn("Tetanus Toxoid", boothLabel: null);
        sameVaccine.PatientNic = nic;
        var matched = await service.CreateWalkInAppointmentAsync(hospital.Id, sameVaccine);

        Assert.True(matched.MatchedExistingBooking);
        Assert.Equal(booking.Id, matched.Id);
        Assert.NotNull(matched.CheckedInAt);
        Assert.Equal(1, await context.Appointments.CountAsync());

        var otherVaccine = WalkIn("Influenza", boothLabel: null);
        otherVaccine.PatientNic = nic;
        var extra = await service.CreateWalkInAppointmentAsync(hospital.Id, otherVaccine);

        Assert.False(extra.MatchedExistingBooking);
        Assert.Equal(2, await context.Appointments.CountAsync());
    }

    private static CreateWalkInAppointmentDto WalkIn(string vaccineName, string? boothLabel) => new()
    {
        PatientNic = "931234567V",
        PatientName = "Walkin Jane",
        PatientEmail = "walkin.jane@example.com",
        PatientPhone = "+94771234567",
        VaccineName = vaccineName,
        Dose = "0.5ml",
        BoothLabel = boothLabel
    };

    private static Vaccine AddVaccine(ApplicationDbContext context, string name)
    {
        var vaccine = new Vaccine { Name = name, Manufacturer = "Test Pharma" };
        context.Vaccines.Add(vaccine);
        return vaccine;
    }

    private static HospitalBooth AddBooth(
        ApplicationDbContext context,
        User hospital,
        string code,
        string name,
        int sortOrder,
        Vaccine vaccine)
    {
        var booth = new HospitalBooth
        {
            HospitalUserId = hospital.Id,
            Code = code,
            Name = name,
            SortOrder = sortOrder
        };
        booth.Vaccines.Add(new HospitalBoothVaccine { BoothId = booth.Id, VaccineId = vaccine.Id, Vaccine = vaccine });
        context.HospitalBooths.Add(booth);
        return booth;
    }

    private static AppointmentService CreateService(ApplicationDbContext context) =>
        new(
            context,
            new FakeEmailService(),
            new FakePasswordHasher(),
            new FakeRegistrationNumberService(),
            NullLogger<AppointmentService>.Instance);

    private static User AddPatient(
        ApplicationDbContext context,
        string email = "patient@example.com",
        string registrationNumber = "VAX-P-4000")
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
