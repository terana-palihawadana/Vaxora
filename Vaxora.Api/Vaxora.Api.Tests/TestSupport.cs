using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests;

internal static class TestDb
{
    public static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    public static User AddHospital(
        ApplicationDbContext context,
        string email = "hospital@example.com",
        string registrationNumber = "VAX-H-9001")
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

    public static User AddDoctor(ApplicationDbContext context, string email, string registrationNumber)
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

    public static User AddNurse(ApplicationDbContext context, string email, string registrationNumber)
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

    public static StaffAffiliation AddActiveAffiliation(
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

    public static StaffShift AddLiveShift(
        ApplicationDbContext context,
        StaffAffiliation affiliation,
        User createdBy)
    {
        var today = StaffDutyHelper.HospitalToday();
        // Cover the whole hospital-local day so tests don't flake around midnight.
        var shift = new StaffShift
        {
            AffiliationId = affiliation.Id,
            Affiliation = affiliation,
            ShiftDate = today,
            StartTime = new TimeOnly(0, 0),
            EndTime = new TimeOnly(23, 59),
            CreatedByUserId = createdBy.Id
        };
        context.StaffShifts.Add(shift);
        return shift;
    }

    public static StaffShift AddFutureShift(
        ApplicationDbContext context,
        StaffAffiliation affiliation,
        User createdBy,
        int daysAhead = 5)
    {
        var shift = new StaffShift
        {
            AffiliationId = affiliation.Id,
            Affiliation = affiliation,
            ShiftDate = StaffDutyHelper.HospitalToday().AddDays(daysAhead),
            StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0),
            CreatedByUserId = createdBy.Id
        };
        context.StaffShifts.Add(shift);
        return shift;
    }

    public static Appointment AddAppointment(
        ApplicationDbContext context,
        User hospital,
        string status = "Confirmed",
        string paymentStatus = "Paid",
        DateOnly? date = null)
    {
        var appointment = new Appointment
        {
            HospitalUserId = hospital.Id,
            HospitalProfileId = hospital.HospitalProfile?.Id,
            HospitalName = hospital.HospitalProfile?.HospitalName ?? "Test Hospital",
            PatientName = "Test Patient",
            VaccineName = "Hepatitis B",
            AppointmentDate = date ?? StaffDutyHelper.HospitalToday(),
            TimeSlot = "09:00 - 09:20",
            StartTime = "09:00",
            EndTime = "09:20",
            Status = status,
            PaymentStatus = paymentStatus,
            PaymentMethod = "Hospital",
            Fee = 0m,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow.AddMinutes(-15)
        };
        context.Appointments.Add(appointment);
        return appointment;
    }
}

internal sealed class FakeAgentGateway : IAgentGatewayService
{
    public Task<AgentGatewayResult> ChatAsync(
        AgentChatRequestDto request,
        string? bearerToken,
        IReadOnlyCollection<string>? allowedAgents = null,
        CancellationToken ct = default) =>
        Task.FromResult(AgentGatewayResult.Ok("""{"agent":"StaffSchedulingAgent","content":"ok","proposals":[]}"""));

    public Task<AgentGatewayResult> PatientCarePlanAsync(
        Guid patientProfileId,
        string? bearerToken,
        CancellationToken ct = default) =>
        Task.FromResult(AgentGatewayResult.Ok("{}"));

    public Task<AgentHealthDto> HealthAsync(CancellationToken ct = default) =>
        Task.FromResult(new AgentHealthDto { Online = true, Agents = new List<string>() });
}

internal sealed class FakeEmailService : IEmailService
{
    public Task<bool> SendPatientWelcomeEmailAsync(string toEmail, string patientName, string regNumber, DateTime? dob, byte[] vaccinationCardPdfBytes) => Task.FromResult(true);
    public Task<bool> SendPendingApprovalEmailAsync(string toEmail, string recipientName, string regNumber, string roleName) => Task.FromResult(true);
    public Task<bool> SendApprovalEmailAsync(string toEmail, string recipientName, string regNumber, string roleName) => Task.FromResult(true);
    public Task<bool> SendRejectionEmailAsync(string toEmail, string recipientName, string regNumber, string roleName, string? rejectionReason) => Task.FromResult(true);
    public Task<bool> SendPasswordResetEmailAsync(string toEmail, string recipientName, string resetLink, string resetCode, int expiryMinutes = 15) => Task.FromResult(true);
    public Task<bool> SendPasswordChangedConfirmationEmailAsync(string toEmail, string recipientName) => Task.FromResult(true);
    public Task<bool> SendAccountDeletedEmailAsync(string toEmail, string recipientName, string regNumber, string roleName) => Task.FromResult(true);
    public Task<bool> SendAppointmentBookingConfirmationEmailAsync(string toEmail, string patientName, string vaccineName, string hospitalName, string appointmentDate, string timeSlot, string? doctorName, string? nurseName, string? notes, decimal fee = 0, string paymentMethod = "Free", string paymentStatus = "Paid") => Task.FromResult(true);
    public Task<bool> SendPaymentReceiptEmailAsync(string toEmail, string patientName, string vaccineName, string hospitalName, string appointmentDate, string timeSlot, decimal amountPaid, string currency, string transactionId, string orderId, DateTime paymentTime) => Task.FromResult(true);
    public Task<bool> SendAppointmentCancellationEmailAsync(string toEmail, string patientName, string vaccineName, string hospitalName, string appointmentDate, string timeSlot, string cancelledBy) => Task.FromResult(true);
    public Task<bool> SendPurchaseOrderToSupplierAsync(string toEmail, string supplierName, string poNumber, string hospitalName, string orderDate, string deliveryDate, List<(string VaccineName, int Quantity, decimal UnitPrice, decimal LineTotal)> lineItems, decimal totalLkr, string approvalNotes) => Task.FromResult(true);
    public Task<bool> SendExpiryMemoToOpsManagerAsync(string toEmail, string recipientName, string memoNumber, string hospitalName, List<(string VaccineName, string BatchNumber, int Quantity, string ExpiryDate, int DaysLeft, string Priority, string Action)> actions, string summary) => Task.FromResult(true);
    public Task<bool> SendAefiSurveillanceAlertAsync(string toEmail, string recipientName, string patientName, string vaccineName, string hospitalName, string appointmentDate, string timeSlot, string severity, string symptoms, string treatmentGiven, string reportedBy, string appointmentId) => Task.FromResult(true);
    public Task<bool> SendDamageReportToSupplierAsync(string toEmail, string supplierName, string hospitalName, string vaccineName, string lotNumber, int quantity, string damageType, string notes, byte[] photoBytes, string photoFileName, string photoContentType) => Task.FromResult(true);
}

internal sealed class FakePasswordHasher : IPasswordHasher
{
    public string HashPassword(string password) => $"hash:{password}";
    public bool VerifyPassword(string password, string passwordHash) => passwordHash == $"hash:{password}";
}

internal sealed class FakeRegistrationNumberService : IRegistrationNumberService
{
    public Task<string> GenerateRegistrationNumberAsync(UserRole role) =>
        Task.FromResult($"VAX-{role.ToString()[0]}-{Random.Shared.Next(1000, 9999)}");
}

internal sealed class FakeR2StorageService : IR2StorageService
{
    public Task<string> UploadFileAsync(Microsoft.AspNetCore.Http.IFormFile file, string folderPrefix, string customFileName = "") =>
        Task.FromResult($"https://fake-r2.vaxora.lk/{folderPrefix}/test.png");

    public Task<string> GetPresignedUrlAsync(string objectKey, int expiryMinutes = 60) =>
        Task.FromResult($"https://fake-r2.vaxora.lk/{objectKey}?token=valid");

    public Task<bool> DeleteFileAsync(string objectKey) => Task.FromResult(true);
}

internal sealed class FakeVaccinationCardService : IVaccinationCardService
{
    public byte[] GenerateVaccinationCardPdf(
        string patientName,
        string registrationNumber,
        string nicNumber,
        DateTime? dateOfBirth,
        string? phoneNumber,
        DateTime issuanceDate) =>
        new byte[] { 0x25, 0x50, 0x44, 0x46 }; // %PDF
}

