using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class ClinicalStaffWorkflowTests
{
    [Fact]
    public async Task UpdatePrescribedDosage_blocks_past_incomplete_visits()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-3001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(
            context,
            hospital,
            status: "Confirmed",
            date: StaffDutyHelper.HospitalToday().AddDays(-2));
        await context.SaveChangesAsync();

        var service = new ClinicalPatientService(context, NullLogger<ClinicalPatientService>.Instance);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdatePrescribedDosageAsync(
                doctor.Id,
                appointment.Id,
                new UpdatePrescribedDosageDto { Dosage = "0.5ml" }));

        Assert.Contains("already passed", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("Administering")]
    [InlineData("Observation")]
    public async Task UpdatePrescribedDosageAsync_is_locked_once_administration_started(string status)
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-3010");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: status);
        appointment.PrescribedDosage = "0.5ml";
        await context.SaveChangesAsync();

        var service = new ClinicalPatientService(context, NullLogger<ClinicalPatientService>.Instance);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdatePrescribedDosageAsync(
                doctor.Id,
                appointment.Id,
                new UpdatePrescribedDosageDto { Dosage = "1.0ml" }));

        Assert.Contains("dose is locked", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("0.5ml", (await context.Appointments.SingleAsync()).PrescribedDosage);
    }

    [Fact]
    public async Task GetPatientByVaxoraId_marks_past_pending_visit_as_overdue_missed()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-3006");
        TestDb.AddActiveAffiliation(context, hospital, doctor);
        var patient = new User
        {
            Email = "patient@example.com",
            PasswordHash = "hash",
            Role = UserRole.PATIENT,
            Status = UserStatus.Active,
            RegistrationNumber = "VAX-P-3001",
            PatientProfile = new PatientProfile
            {
                FullName = "Overdue Patient",
                NicNumber = "900000000V",
                DateOfBirth = new DateTime(1990, 1, 1, 0, 0, 0, DateTimeKind.Utc)
            }
        };
        context.Users.Add(patient);
        await context.SaveChangesAsync();

        var appointment = TestDb.AddAppointment(
            context,
            hospital,
            status: "Confirmed",
            date: StaffDutyHelper.HospitalToday().AddDays(-3));
        appointment.PatientUserId = patient.Id;
        appointment.PatientProfileId = patient.PatientProfile!.Id;
        appointment.PatientName = patient.PatientProfile.FullName;
        await context.SaveChangesAsync();

        var service = new ClinicalPatientService(context, NullLogger<ClinicalPatientService>.Instance);
        var detail = await service.GetPatientByVaxoraIdAsync("VAX-P-3001", doctor.Id);

        var pending = Assert.Single(detail.PendingVaccines);
        Assert.True(pending.IsOverdue);
        Assert.Equal("Missed", pending.Status);
    }

    [Fact]
    public async Task Staff_cannot_jump_from_Confirmed_to_Completed()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-3002");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Confirmed");
        appointment.PrescribedDosage = "0.5ml";
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateAppointmentStatusAsync(
                doctor.Id,
                appointment.Id,
                new UpdateAppointmentStatusDto { Status = "Completed" }));

        Assert.Contains("Cannot change appointment status", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Staff_cannot_confirm_unpaid_PendingPayment_booking()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-3003");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(
            context,
            hospital,
            status: "PendingPayment",
            paymentStatus: "PendingOnline");
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateAppointmentStatusAsync(
                doctor.Id,
                appointment.Id,
                new UpdateAppointmentStatusDto { Status = "Confirmed" }));

        Assert.Contains("Cannot change appointment status", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Staff_can_move_Confirmed_to_Administering_when_on_duty_and_paid()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-3004");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Confirmed");
        appointment.PrescribedDosage = "0.5ml";
        appointment.CheckedInAt = DateTime.UtcNow;
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var updated = await service.UpdateAppointmentStatusAsync(
            doctor.Id,
            appointment.Id,
            new UpdateAppointmentStatusDto { Status = "Administering" });

        Assert.Equal("Administering", updated.Status);
    }

    [Fact]
    public async Task Discharge_is_refused_before_the_15_minute_observation_window()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "nurse@example.com", "VAX-N-3030");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Observation");
        appointment.PrescribedDosage = "0.5ml";
        appointment.UpdatedAt = DateTime.UtcNow.AddMinutes(-5);
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateAppointmentStatusAsync(
                nurse.Id,
                appointment.Id,
                new UpdateAppointmentStatusDto { Status = "Completed" }));

        Assert.Contains("Observation is not complete", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Staff_cannot_call_a_patient_who_has_not_checked_in()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "nurse@example.com", "VAX-N-3020");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Confirmed");
        appointment.PrescribedDosage = "0.5ml";
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateAppointmentStatusAsync(
                nurse.Id,
                appointment.Id,
                new UpdateAppointmentStatusDto { Status = "Administering" }));

        Assert.Contains("not checked in", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CheckInAsync_marks_today_patient_arrived_and_rejects_other_days()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var today = TestDb.AddAppointment(context, hospital, status: "Confirmed");
        var tomorrow = TestDb.AddAppointment(
            context,
            hospital,
            status: "Confirmed",
            date: StaffDutyHelper.HospitalToday().AddDays(1));
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var checkedIn = await service.CheckInAsync(hospital.Id, today.Id);

        Assert.NotNull(checkedIn.CheckedInAt);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CheckInAsync(hospital.Id, tomorrow.Id));
        Assert.Contains("day of their appointment", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Staff_cannot_start_administering_without_a_prescribed_dose()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddDoctor(context, "nurse@example.com", "VAX-D-3005");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Confirmed");
        appointment.PrescribedDosage = null;
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateAppointmentStatusAsync(
                nurse.Id,
                appointment.Id,
                new UpdateAppointmentStatusDto { Status = "Administering" }));

        Assert.Contains("must prescribe the dose", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(false, true, true)]
    [InlineData(true, false, true)]
    [InlineData(true, true, false)]
    [InlineData(null, null, null)]
    public async Task Recording_administration_requires_dose_consent_and_vitals_sign_off(
        bool? doseConfirmed,
        bool? consentConfirmed,
        bool? vitalsConfirmed)
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "nurse@example.com", "VAX-N-3010");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        TestDb.AddLiveShift(context, affiliation, hospital);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Administering");
        appointment.PrescribedDosage = "0.5ml";
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateAppointmentStatusAsync(
                nurse.Id,
                appointment.Id,
                new UpdateAppointmentStatusDto
                {
                    Status = "Observation",
                    DoseConfirmed = doseConfirmed,
                    ConsentConfirmed = consentConfirmed,
                    VitalsConfirmed = vitalsConfirmed
                }));

        Assert.Contains("Confirm the prescribed dose", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Administering", (await context.Appointments.SingleAsync()).Status);
    }

    [Fact]
    public async Task ReportAefi_does_not_bump_UpdatedAt_observation_timer()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var nurse = TestDb.AddNurse(context, "nurse@example.com", "VAX-N-3001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, nurse);
        TestDb.AddLiveShift(context, affiliation, hospital);

        var observationStarted = DateTime.UtcNow.AddMinutes(-12);
        var appointment = TestDb.AddAppointment(context, hospital, status: "Observation");
        appointment.UpdatedAt = observationStarted;
        await context.SaveChangesAsync();

        var service = CreateAppointmentService(context);
        await service.ReportAefiAsync(
            nurse.Id,
            appointment.Id,
            new ReportAefiDto
            {
                Severity = "Mild",
                Description = "Low-grade fever",
                TreatmentGiven = "Paracetamol and observation",
                FollowUpPlan = "Phone check tomorrow morning",
                FollowUpAt = DateTime.UtcNow.Date.AddDays(1),
                NotifyDoctor = false
            });

        var stored = await context.Appointments.SingleAsync(a => a.Id == appointment.Id);
        Assert.Equal(observationStarted, stored.UpdatedAt);
        Assert.Contains("AEFI", stored.Notes ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    private static AppointmentService CreateAppointmentService(Vaxora.Api.Data.ApplicationDbContext context) =>
        new(
            context,
            new FakeEmailService(),
            new FakePasswordHasher(),
            new FakeRegistrationNumberService(),
            NullLogger<AppointmentService>.Instance);
}
