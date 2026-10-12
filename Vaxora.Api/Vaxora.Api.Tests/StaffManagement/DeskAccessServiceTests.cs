using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class DeskAccessServiceTests
{
    private static DeskAccessService CreateService(ApplicationDbContext context) =>
        new(context, new PasswordHasher(), NullLogger<DeskAccessService>.Instance);

    private static StaffManagementService CreateStaffService(ApplicationDbContext context) =>
        new(context, NullLogger<StaffManagementService>.Instance);

    private static CreateDeskAccountDto NewDesk(string email = "desk@example.com") =>
        new() { FullName = "John Smith", PhoneNumber = "0771234567", Email = email, Password = "desk-pass-1" };

    [Fact]
    public async Task CreateDeskAccountAsync_creates_active_front_desk_user_linked_to_hospital()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.CreateDeskAccountAsync(hospital.Id, NewDesk("Desk@Example.com"));

        var deskUser = await context.Users.SingleAsync(u => u.Id == result.UserId);
        Assert.Equal(UserRole.FRONT_DESK, deskUser.Role);
        Assert.Equal(UserStatus.Active, deskUser.Status);
        Assert.Equal("desk@example.com", deskUser.Email);
        Assert.StartsWith("VAX-F-", deskUser.RegistrationNumber);
        Assert.True(new PasswordHasher().VerifyPassword("desk-pass-1", deskUser.PasswordHash));

        var affiliation = await context.StaffAffiliations.SingleAsync();
        Assert.Equal(hospital.Id, affiliation.HospitalUserId);
        Assert.Equal(UserRole.FRONT_DESK, affiliation.StaffRole);
        Assert.Equal(AffiliationStatus.Active, affiliation.Status);
        Assert.True(await context.AuditLogs.AnyAsync(a => a.Action == "DESK_ACCOUNT_CREATED"));
    }

    [Fact]
    public async Task CreateDeskAccountAsync_saves_name_and_phone_and_requires_a_name()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var created = await service.CreateDeskAccountAsync(hospital.Id, NewDesk());

        Assert.Equal("John Smith", created.FullName);
        Assert.Equal("0771234567", created.PhoneNumber);
        var listed = Assert.Single(await service.GetDeskAccountsAsync(hospital.Id));
        Assert.Equal("John Smith", listed.FullName);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateDeskAccountAsync(
                hospital.Id,
                new CreateDeskAccountDto { FullName = "  ", Email = "blank@example.com", Password = "desk-pass-1" }));
        Assert.Contains("name is required", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateDeskAccountAsync_rejects_email_used_by_another_account()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        TestDb.AddDoctor(context, "taken@example.com", "VAX-D-1001");
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateDeskAccountAsync(hospital.Id, NewDesk("taken@example.com")));

        Assert.Contains("already exists", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, await context.StaffAffiliations.CountAsync());
    }

    [Fact]
    public async Task CreateDeskAccountAsync_rejects_non_hospital_caller()
    {
        await using var context = TestDb.CreateContext();
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.CreateDeskAccountAsync(doctor.Id, NewDesk()));
    }

    [Fact]
    public async Task GetDeskAccountsAsync_lists_only_this_hospitals_desk_accounts()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var otherHospital = TestDb.AddHospital(context, "other-hospital@example.com", "VAX-H-9002");
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        TestDb.AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        await service.CreateDeskAccountAsync(hospital.Id, NewDesk("mine@example.com"));
        await service.CreateDeskAccountAsync(otherHospital.Id, NewDesk("theirs@example.com"));

        var result = await service.GetDeskAccountsAsync(hospital.Id);

        var account = Assert.Single(result);
        Assert.Equal("mine@example.com", account.Email);
    }

    [Fact]
    public async Task RemoveDeskAccountAsync_closes_the_login_and_blocks_hospital_access()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var account = await service.CreateDeskAccountAsync(hospital.Id, NewDesk());

        await service.RemoveDeskAccountAsync(hospital.Id, account.AffiliationId);

        var deskUser = await context.Users.SingleAsync(u => u.Id == account.UserId);
        Assert.Equal(UserStatus.Suspended, deskUser.Status);
        Assert.Null(deskUser.RefreshToken);
        Assert.Empty(await service.GetDeskAccountsAsync(hospital.Id));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ResolveHospitalUserIdAsync(account.UserId));
    }

    [Fact]
    public async Task RemoveDeskAccountAsync_cannot_remove_another_hospitals_desk_account()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var otherHospital = TestDb.AddHospital(context, "other-hospital@example.com", "VAX-H-9002");
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var account = await service.CreateDeskAccountAsync(otherHospital.Id, NewDesk());

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.RemoveDeskAccountAsync(hospital.Id, account.AffiliationId));
    }

    [Fact]
    public async Task RemoveDeskAccountAsync_does_not_remove_clinical_staff()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        var affiliation = TestDb.AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.RemoveDeskAccountAsync(hospital.Id, affiliation.Id));
        Assert.Equal(UserStatus.Active, doctor.Status);
    }

    [Fact]
    public async Task CreateDeskAccountAsync_reactivates_a_removed_desk_account()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var first = await service.CreateDeskAccountAsync(hospital.Id, NewDesk());
        await service.RemoveDeskAccountAsync(hospital.Id, first.AffiliationId);

        var second = await service.CreateDeskAccountAsync(
            hospital.Id,
            new CreateDeskAccountDto { FullName = "Jane Brown", Email = "desk@example.com", Password = "new-pass-2" });

        Assert.Equal(first.UserId, second.UserId);
        Assert.Equal("Jane Brown", second.FullName);
        Assert.Null(second.PhoneNumber);
        var deskUser = await context.Users.SingleAsync(u => u.Id == second.UserId);
        Assert.Equal(UserStatus.Active, deskUser.Status);
        Assert.True(new PasswordHasher().VerifyPassword("new-pass-2", deskUser.PasswordHash));
        Assert.Equal(hospital.Id, await service.ResolveHospitalUserIdAsync(second.UserId));
    }

    [Fact]
    public async Task CreateDeskAccountAsync_does_not_let_another_hospital_take_a_removed_desk_account()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var otherHospital = TestDb.AddHospital(context, "other-hospital@example.com", "VAX-H-9002");
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var first = await service.CreateDeskAccountAsync(hospital.Id, NewDesk());
        await service.RemoveDeskAccountAsync(hospital.Id, first.AffiliationId);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateDeskAccountAsync(
                otherHospital.Id,
                new CreateDeskAccountDto { FullName = "Jane Brown", Email = "desk@example.com", Password = "new-pass-2" }));

        Assert.Contains("already exists", exception.Message, StringComparison.OrdinalIgnoreCase);
        var deskUser = await context.Users.SingleAsync(u => u.Id == first.UserId);
        Assert.Equal(UserStatus.Suspended, deskUser.Status);
    }

    [Fact]
    public async Task ResolveHospitalUserIdAsync_returns_own_id_for_hospital_and_linked_hospital_for_desk()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var account = await service.CreateDeskAccountAsync(hospital.Id, NewDesk());

        Assert.Equal(hospital.Id, await service.ResolveHospitalUserIdAsync(hospital.Id));
        Assert.Equal(hospital.Id, await service.ResolveHospitalUserIdAsync(account.UserId));
    }

    [Fact]
    public async Task ResolveHospitalUserIdAsync_rejects_clinical_staff_and_patients()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        TestDb.AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ResolveHospitalUserIdAsync(doctor.Id));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ResolveHospitalUserIdAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task ResolveHospitalUserIdAsync_rejects_desk_of_a_suspended_hospital()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        await context.SaveChangesAsync();
        var service = CreateService(context);
        var account = await service.CreateDeskAccountAsync(hospital.Id, NewDesk());
        hospital.Status = UserStatus.Suspended;
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ResolveHospitalUserIdAsync(account.UserId));
    }

    [Fact]
    public async Task Desk_accounts_stay_out_of_the_clinical_roster()
    {
        await using var context = TestDb.CreateContext();
        var hospital = TestDb.AddHospital(context);
        var doctor = TestDb.AddDoctor(context, "doctor@example.com", "VAX-D-1001");
        TestDb.AddActiveAffiliation(context, hospital, doctor);
        await context.SaveChangesAsync();
        var account = await CreateService(context).CreateDeskAccountAsync(hospital.Id, NewDesk());
        var staffService = CreateStaffService(context);

        var staff = await staffService.GetHospitalStaffAsync(hospital.Id, status: "All");
        Assert.Equal(doctor.Id, Assert.Single(staff).StaffUserId);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            staffService.CreateShiftAsync(hospital.Id, new CreateStaffShiftDto
            {
                AffiliationId = account.AffiliationId,
                ShiftDate = StaffDutyHelper.HospitalToday().AddDays(3),
                StartTime = new TimeOnly(9, 0),
                EndTime = new TimeOnly(12, 0)
            }));
        Assert.Contains("doctors or nurses", exception.Message, StringComparison.OrdinalIgnoreCase);
    }
}
