using Xunit;
using Vaxora.Api.Services;

namespace Vaxora.Api.Tests.StaffManagement;

public class StaffNameFormatterTests
{
    [Theory]
    [InlineData("Silva", "Dr. Silva")]
    [InlineData("Dr. Silva", "Dr. Silva")]
    [InlineData("dr Silva", "Dr. Silva")]
    [InlineData("Doctor Silva", "Dr. Silva")]
    [InlineData("Dr. Dr. Silva", "Dr. Silva")]
    [InlineData("Dr.Silva", "Dr. Silva")]
    [InlineData("Drake Perera", "Dr. Drake Perera")]
    [InlineData("", "Dr")]
    public void WithRolePrefix_adds_exactly_one_doctor_title(string fullName, string expected)
    {
        Assert.Equal(expected, StaffNameFormatter.WithRolePrefix(fullName, "Dr."));
    }

    [Theory]
    [InlineData("Perera", "Nurse Perera")]
    [InlineData("nurse Perera", "Nurse Perera")]
    [InlineData("Nurse Nurse Perera", "Nurse Perera")]
    public void WithRolePrefix_adds_exactly_one_nurse_title(string fullName, string expected)
    {
        Assert.Equal(expected, StaffNameFormatter.WithRolePrefix(fullName, "Nurse"));
    }
}
