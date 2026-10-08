using System.Text.RegularExpressions;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

/// <summary>
/// Single place that turns a doctor/nurse account into a display name, so the
/// roster, shifts and cover requests all show the same "Dr. Silva" / "Nurse Perera".
/// </summary>
public static class StaffNameFormatter
{
    // Leading titles already typed into FullName: "Dr.", "dr ", "Doctor ", "Nurse " (repeated, any case).
    private static readonly Regex TitlePrefix = new(
        @"^(?:(?:dr\.|dr\s|doctor\s|nurse\s)\s*)+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string Format(User? staffUser, string fallback = "Staff")
    {
        if (staffUser == null) return fallback;
        if (staffUser.Role == UserRole.DOCTOR && staffUser.DoctorProfile != null)
            return WithRolePrefix(staffUser.DoctorProfile.FullName, "Dr.");
        if (staffUser.Role == UserRole.NURSE && staffUser.NurseProfile != null)
            return WithRolePrefix(staffUser.NurseProfile.FullName, "Nurse");
        return staffUser.Email;
    }

    /// <summary>Strips any existing title from <paramref name="fullName"/>, then adds <paramref name="prefix"/>.</summary>
    public static string WithRolePrefix(string? fullName, string prefix)
    {
        var name = TitlePrefix.Replace((fullName ?? string.Empty).Trim(), string.Empty).Trim();
        if (string.IsNullOrEmpty(name))
            return prefix.TrimEnd('.');
        return $"{prefix} {name}";
    }
}
