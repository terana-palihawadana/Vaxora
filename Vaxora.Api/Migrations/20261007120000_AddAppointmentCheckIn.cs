using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Records when a patient physically arrives, so only checked-in patients join the clinical queue.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261007120000_AddAppointmentCheckIn")]
    public partial class AddAppointmentCheckIn : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""CheckedInAt"" timestamp with time zone NULL;
ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""CheckedInByUserId"" uuid NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Appointments"" DROP COLUMN IF EXISTS ""CheckedInAt"";
ALTER TABLE ""Appointments"" DROP COLUMN IF EXISTS ""CheckedInByUserId"";
");
        }
    }
}
