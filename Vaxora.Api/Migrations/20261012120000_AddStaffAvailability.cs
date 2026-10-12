using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Lets a doctor with several hospitals mark one as primary and offer the others
    /// fixed weekly hours, plus one-off unavailable dates.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261012120000_AddStaffAvailability")]
    public partial class AddStaffAvailability : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""StaffAffiliations"" ADD COLUMN IF NOT EXISTS ""IsPrimary"" boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ""StaffAvailabilityWindows"" (
    ""Id"" uuid NOT NULL PRIMARY KEY,
    ""AffiliationId"" uuid NOT NULL REFERENCES ""StaffAffiliations""(""Id"") ON DELETE CASCADE,
    ""DayOfWeek"" integer NOT NULL,
    ""StartTime"" time without time zone NOT NULL,
    ""EndTime"" time without time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS ""IX_StaffAvailabilityWindows_AffiliationId_DayOfWeek""
    ON ""StaffAvailabilityWindows"" (""AffiliationId"", ""DayOfWeek"");

CREATE TABLE IF NOT EXISTS ""StaffUnavailableDates"" (
    ""Id"" uuid NOT NULL PRIMARY KEY,
    ""AffiliationId"" uuid NOT NULL REFERENCES ""StaffAffiliations""(""Id"") ON DELETE CASCADE,
    ""Date"" date NOT NULL
);
CREATE INDEX IF NOT EXISTS ""IX_StaffUnavailableDates_AffiliationId_Date""
    ON ""StaffUnavailableDates"" (""AffiliationId"", ""Date"");
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP TABLE IF EXISTS ""StaffUnavailableDates"";
DROP TABLE IF EXISTS ""StaffAvailabilityWindows"";
ALTER TABLE ""StaffAffiliations"" DROP COLUMN IF EXISTS ""IsPrimary"";
");
        }
    }
}
