using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using System.Text.Json;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class StaffManagementServiceTests
{
    [Fact]
    public async Task InviteStaffAsync_creates_pending_affiliation_for_active_doctor()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.InviteStaffAsync(
            hospital.Id,
            new InviteStaffDto { RegistrationNumber = "vax-d-1001" });

        Assert.Equal(AffiliationStatus.Pending.ToString(), result.Status);
        Assert.Equal(doctor.Id, result.StaffUserId);
        Assert.Equal(1, await context.StaffAffiliations.CountAsync());
    }

    [Fact]
    public async Task InviteStaffAsync_rejects_nurse_with_existing_pending_affiliation()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var otherHospital = AddHospital(context, "other-hospital@example.com", "VAX-H-1002");
        var nurse = AddNurse(context, "nurse@example.com", "VAX-N-1001");
        context.StaffAffiliations.Add(new StaffAffiliation
        {
            HospitalUserId = otherHospital.Id,
            StaffUserId = nurse.Id,
            StaffRole = UserRole.NURSE,
            Status = AffiliationStatus.Pending,
            InvitedByUserId = otherHospital.Id
        });
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.InviteStaffAsync(
                hospital.Id,
                new InviteStaffDto { RegistrationNumber = nurse.RegistrationNumber! }));

        Assert.Contains("one hospital", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateShiftAsync_rejects_overlapping_shift_for_same_staff_member()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var shiftDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2));

        await service.CreateShiftAsync(hospital.Id, new CreateStaffShiftDto
        {
            AffiliationId = affiliation.Id,
            ShiftDate = shiftDate,
            StartTime = new TimeOnly(8, 0),
            EndTime = new TimeOnly(12, 0)
        });

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateShiftAsync(hospital.Id, new CreateStaffShiftDto
            {
                AffiliationId = affiliation.Id,
                ShiftDate = shiftDate,
                StartTime = new TimeOnly(11, 30),
                EndTime = new TimeOnly(15, 0)
            }));

        Assert.Contains("already unavailable", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateShiftAsync_rejects_shift_longer_than_twelve_hours()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateShiftAsync(hospital.Id, new CreateStaffShiftDto
            {
                AffiliationId = affiliation.Id,
                ShiftDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2)),
                StartTime = new TimeOnly(7, 0),
                EndTime = new TimeOnly(20, 0)
            }));

        Assert.Contains("12 hours", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DeleteShiftAsync_cancels_pending_cover_request_for_that_shift()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = AddActiveAffiliation(context, hospital, doctor);
        var shift = AddShift(context, hospital, affiliation, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(5)));
        var swap = AddPendingSwap(context, hospital, doctor, shift);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await service.DeleteShiftAsync(hospital.Id, shift.Id);

        var stored = await context.ShiftSwapRequests.SingleAsync(r => r.Id == swap.Id);
        Assert.Equal(ShiftSwapStatus.Cancelled, stored.Status);
        Assert.Equal("Shift removed by hospital", stored.DecisionNote);
        Assert.Equal(hospital.Id, stored.DecidedByUserId);
    }

    [Fact]
    public async Task UpdateShiftAsync_refreshes_pending_cover_request_snapshot()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = AddActiveAffiliation(context, hospital, doctor);
        var shift = AddShift(context, hospital, affiliation, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(5)));
        var swap = AddPendingSwap(context, hospital, doctor, shift);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var newDate = shift.ShiftDate.AddDays(1);

        await service.UpdateShiftAsync(hospital.Id, shift.Id, new UpdateStaffShiftDto
        {
            ShiftDate = newDate,
            StartTime = new TimeOnly(13, 0),
            EndTime = new TimeOnly(17, 0),
            BoothOrStation = "Room 4"
        });

        var stored = await context.ShiftSwapRequests.SingleAsync(r => r.Id == swap.Id);
        Assert.Equal(ShiftSwapStatus.Pending, stored.Status);
        Assert.Equal(newDate, stored.ShiftDate);
        Assert.Equal("13:00–17:00", stored.ShiftWindow);
        Assert.Equal("Room 4", stored.BoothOrStation);
    }

    [Fact]
    public async Task RemoveAffiliationAsync_frees_upcoming_shifts_and_cancels_pending_covers()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = AddActiveAffiliation(context, hospital, doctor);
        var pastShift = AddShift(context, hospital, affiliation, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-3)));
        var upcoming = AddShift(context, hospital, affiliation, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(4)));
        AddShift(context, hospital, affiliation, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(6)));
        var swap = AddPendingSwap(context, hospital, doctor, upcoming);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var freed = await service.RemoveAffiliationAsync(hospital.Id, affiliation.Id);

        Assert.Equal(2, freed);
        var remaining = await context.StaffShifts.Select(s => s.Id).ToListAsync();
        Assert.Equal(new[] { pastShift.Id }, remaining);
        var storedSwap = await context.ShiftSwapRequests.SingleAsync(r => r.Id == swap.Id);
        Assert.Equal(ShiftSwapStatus.Cancelled, storedSwap.Status);
        Assert.Equal("Staff removed from roster", storedSwap.DecisionNote);
    }

    [Fact]
    public async Task SuggestWeekCoverageAsync_skips_doctor_busy_at_another_hospital()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var otherHospital = AddHospital(context, "other@example.com", "VAX-H-2002");
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var nurse = AddNurse(context, "nurse@example.com", "VAX-N-1001");
        AddActiveAffiliation(context, hospital, doctor);
        AddActiveAffiliation(context, hospital, nurse);
        var externalAffiliation = AddActiveAffiliation(context, otherHospital, doctor);
        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(3));
        AddSession(context, hospital, date);
        // Busy elsewhere in the morning slot only.
        AddShift(context, otherHospital, externalAffiliation, date);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.SuggestWeekCoverageAsync(hospital.Id, new SuggestWeekCoverageDto
        {
            From = date,
            To = date
        });

        var doctorProposals = result.Proposals.Where(p => p.StaffRole == "DOCTOR").ToList();
        Assert.NotEmpty(doctorProposals);
        Assert.DoesNotContain(doctorProposals, p => p.StartTime < new TimeOnly(12, 0));
    }

    [Fact]
    public async Task Booth_with_upcoming_sessions_cannot_be_deactivated_or_lose_that_vaccine()
    {
        await using var context = TestDb.CreateContext();
        var hospital = AddHospital(context);
        var hepB = new Vaccine { Name = "Hepatitis B", Manufacturer = "Test" };
        var flu = new Vaccine { Name = "Influenza", Manufacturer = "Test" };
        context.Vaccines.AddRange(hepB, flu);
        var booth = new HospitalBooth { HospitalUserId = hospital.Id, Code = "B01", Name = "Adult" };
        booth.Vaccines.Add(new HospitalBoothVaccine { BoothId = booth.Id, VaccineId = hepB.Id });
        booth.Vaccines.Add(new HospitalBoothVaccine { BoothId = booth.Id, VaccineId = flu.Id });
        context.HospitalBooths.Add(booth);
        var session = AddSession(context, hospital, StaffDutyHelper.HospitalToday().AddDays(3));
        session.BoothId = booth.Id;
        session.VaccineId = hepB.Id;
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var deactivate = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.DeactivateHospitalBoothAsync(hospital.Id, booth.Id));
        Assert.Contains("active session", deactivate.Message, StringComparison.OrdinalIgnoreCase);

        var removeHepB = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateHospitalBoothAsync(hospital.Id, booth.Id, new UpdateHospitalBoothDto
            {
                Code = "B01",
                Name = "Adult",
                IsActive = true,
                VaccineIds = new List<Guid> { flu.Id }
            }));
        Assert.Contains("Cancel them in Schedules", removeHepB.Message);

        // Removing a vaccine with no sessions is still fine.
        var updated = await service.UpdateHospitalBoothAsync(hospital.Id, booth.Id, new UpdateHospitalBoothDto
        {
            Code = "B01",
            Name = "Adult",
            IsActive = true,
            VaccineIds = new List<Guid> { hepB.Id }
        });
        Assert.Equal(new[] { hepB.Id }, updated.VaccineIds);
    }

    [Fact]
    public async Task Session_cannot_be_posted_at_a_booth_with_no_vaccines_listed()
    {
        await using var context = TestDb.CreateContext();
        var hospital = AddHospital(context);
        var booth = new HospitalBooth { HospitalUserId = hospital.Id, Code = "B09", Name = "Empty" };
        context.HospitalBooths.Add(booth);
        await context.SaveChangesAsync();
        var schedules = new ScheduleService(context, NullLogger<ScheduleService>.Instance);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            schedules.CreateScheduleAsync(hospital.Id, new CreateVaccineScheduleDto
            {
                BoothId = booth.Id,
                VaccineName = "Hepatitis B",
                ScheduleType = "OneTime",
                SpecificDate = StaffDutyHelper.HospitalToday().AddDays(3)
            }));

        Assert.Contains("no vaccines listed", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Session_cannot_overlap_another_session_at_the_same_booth()
    {
        await using var context = TestDb.CreateContext();
        var hospital = AddHospital(context);
        var hepB = new Vaccine { Name = "Hepatitis B", Manufacturer = "Test" };
        context.Vaccines.Add(hepB);
        var booth = new HospitalBooth { HospitalUserId = hospital.Id, Code = "B01", Name = "Adult" };
        booth.Vaccines.Add(new HospitalBoothVaccine { BoothId = booth.Id, VaccineId = hepB.Id, Vaccine = hepB });
        context.HospitalBooths.Add(booth);
        var day = StaffDutyHelper.HospitalToday().AddDays(4);
        var existing = AddSession(context, hospital, day);
        existing.BoothId = booth.Id;
        existing.StartTime = "09:00";
        existing.EndTime = "11:00";
        await context.SaveChangesAsync();
        var schedules = new ScheduleService(context, NullLogger<ScheduleService>.Instance);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            schedules.CreateScheduleAsync(hospital.Id, new CreateVaccineScheduleDto
            {
                BoothId = booth.Id,
                VaccineId = hepB.Id,
                VaccineName = "Hepatitis B",
                ScheduleType = "OneTime",
                SpecificDate = day,
                StartTime = "10:00",
                EndTime = "12:00"
            }));

        Assert.Contains("already runs", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GetCoverageReportAsync_does_not_count_closed_or_past_days_as_low()
    {
        await using var context = TestDb.CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        AddActiveAffiliation(context, hospital, doctor);
        var today = StaffDutyHelper.HospitalToday();
        var clinicDay = today.AddDays(2);
        AddSession(context, hospital, clinicDay);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var report = await service.GetCoverageReportAsync(hospital.Id, today.AddDays(-1), today.AddDays(3));

        Assert.Equal("Past", report.Days.Single(d => d.Date == today.AddDays(-1)).CoverageLevel);
        Assert.Equal("NoClinic", report.Days.Single(d => d.Date == today.AddDays(1)).CoverageLevel);
        Assert.Equal("Low", report.Days.Single(d => d.Date == clinicDay).CoverageLevel);
        Assert.Equal(1, report.DaysWithLowCoverage);
    }

    [Fact]
    public async Task GetCoverageReportAsync_marks_day_low_when_a_role_has_no_shift()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        var doctor = AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var nurse = AddNurse(context, "nurse@example.com", "VAX-N-1001");
        var doctorAffiliation = AddActiveAffiliation(context, hospital, doctor);
        AddActiveAffiliation(context, hospital, nurse);
        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2));
        AddSession(context, hospital, date);
        context.StaffShifts.Add(new StaffShift
        {
            AffiliationId = doctorAffiliation.Id,
            ShiftDate = date,
            StartTime = new TimeOnly(8, 0),
            EndTime = new TimeOnly(16, 0),
            CreatedByUserId = hospital.Id
        });
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var report = await service.GetCoverageReportAsync(hospital.Id, date, date);

        var day = Assert.Single(report.Days);
        Assert.Equal(1, report.ActiveDoctors);
        Assert.Equal(1, report.ActiveNurses);
        Assert.Equal("Low", day.CoverageLevel);
        Assert.Equal(1, report.DaysWithLowCoverage);
    }

    [Fact]
    public async Task AgentWorkflowService_persists_structured_execution_evidence()
    {
        await using var context = CreateContext();
        var hospital = AddHospital(context);
        await context.SaveChangesAsync();
        var service = new AgentWorkflowService(
            context,
            NullLogger<AgentWorkflowService>.Instance);

        var workflow = await service.RecordChatAsync(
            hospital.Id,
            new AgentChatRequestDto
            {
                TargetAgent = "StaffSchedulingAgent",
                Messages = new List<AgentMessageDto>
                {
                    new() { Role = "user", Content = "Staff the rest of the week" }
                }
            },
            AgentGatewayResult.Ok("""
                {
                  "agent": "StaffSchedulingAgent",
                  "content": "I prepared shift suggestions.",
                  "plan": {"steps": ["analyze", "validate", "propose"]},
                  "completedSteps": ["analyze", "validate"],
                  "toolResults": [{"tool": "get_coverage", "success": true}],
                  "validation": {"businessRulesPassed": true},
                  "proposals": [{"affiliationId": "staff-1"}]
                }
                """));

        var stored = await context.AgentWorkflows.SingleAsync();
        using var plan = JsonDocument.Parse(stored.PlanJson);
        Assert.Equal(3, plan.RootElement.GetProperty("steps").GetArrayLength());
        using var validation = JsonDocument.Parse(stored.ValidationResultsJson);
        Assert.True(validation.RootElement.GetProperty("businessRulesPassed").GetBoolean());
        Assert.Equal("AwaitingApproval", stored.FinalOutcome);
        Assert.Equal("AwaitingApproval", workflow.Status);
    }

    private static StaffManagementService CreateService(ApplicationDbContext context) =>
        new(context, NullLogger<StaffManagementService>.Instance);

    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static User AddHospital(
        ApplicationDbContext context,
        string email = "hospital@example.com",
        string registrationNumber = "VAX-H-1001")
    {
        var hospital = new User
        {
            Email = email,
            PasswordHash = "test-hash",
            Role = UserRole.HOSPITAL,
            Status = UserStatus.Active,
            RegistrationNumber = registrationNumber,
            HospitalProfile = new HospitalProfile
            {
                HospitalName = "Test Hospital",
                RegistrationNumber = $"HP-{Guid.NewGuid():N}"[..12]
            }
        };
        context.Users.Add(hospital);
        return hospital;
    }

    private static User AddDoctor(ApplicationDbContext context, string email, string registrationNumber)
    {
        var doctor = new User
        {
            Email = email,
            PasswordHash = "test-hash",
            Role = UserRole.DOCTOR,
            Status = UserStatus.Active,
            RegistrationNumber = registrationNumber,
            DoctorProfile = new DoctorProfile
            {
                FullName = "Test Doctor",
                SlmcNumber = $"SLMC-{Guid.NewGuid():N}"[..12],
                VerificationStatus = VerificationStatus.Approved
            }
        };
        context.Users.Add(doctor);
        return doctor;
    }

    private static User AddNurse(ApplicationDbContext context, string email, string registrationNumber)
    {
        var nurse = new User
        {
            Email = email,
            PasswordHash = "test-hash",
            Role = UserRole.NURSE,
            Status = UserStatus.Active,
            RegistrationNumber = registrationNumber,
            NurseProfile = new NurseProfile
            {
                FullName = "Test Nurse",
                SlncNumber = $"SLNC-{Guid.NewGuid():N}"[..12],
                VerificationStatus = VerificationStatus.Approved
            }
        };
        context.Users.Add(nurse);
        return nurse;
    }

    private static VaccineSchedule AddSession(ApplicationDbContext context, User hospital, DateOnly date)
    {
        var session = new VaccineSchedule
        {
            HospitalUserId = hospital.Id,
            VaccineName = "Hepatitis B",
            ScheduleType = "OneTime",
            SpecificDate = date,
            Status = "Active"
        };
        context.VaccineSchedules.Add(session);
        return session;
    }

    private static StaffShift AddShift(
        ApplicationDbContext context,
        User hospital,
        StaffAffiliation affiliation,
        DateOnly date)
    {
        var shift = new StaffShift
        {
            AffiliationId = affiliation.Id,
            Affiliation = affiliation,
            ShiftDate = date,
            StartTime = new TimeOnly(8, 0),
            EndTime = new TimeOnly(12, 0),
            CreatedByUserId = hospital.Id
        };
        context.StaffShifts.Add(shift);
        return shift;
    }

    private static ShiftSwapRequest AddPendingSwap(
        ApplicationDbContext context,
        User hospital,
        User requester,
        StaffShift shift)
    {
        var swap = new ShiftSwapRequest
        {
            ShiftId = shift.Id,
            HospitalUserId = hospital.Id,
            RequesterUserId = requester.Id,
            ShiftDate = shift.ShiftDate,
            ShiftWindow = "08:00–12:00",
            Status = ShiftSwapStatus.Pending
        };
        context.ShiftSwapRequests.Add(swap);
        return swap;
    }

    private static StaffAffiliation AddActiveAffiliation(
        ApplicationDbContext context,
        User hospital,
        User staff)
    {
        var affiliation = new StaffAffiliation
        {
            HospitalUserId = hospital.Id,
            HospitalUser = hospital,
            StaffUserId = staff.Id,
            StaffUser = staff,
            StaffRole = staff.Role,
            Status = AffiliationStatus.Active,
            InvitedByUserId = hospital.Id,
            RespondedAt = DateTime.UtcNow
        };
        context.StaffAffiliations.Add(affiliation);
        return affiliation;
    }
}
