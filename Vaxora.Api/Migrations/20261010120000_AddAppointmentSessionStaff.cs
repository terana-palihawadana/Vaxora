using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Records which doctor or nurse called a patient in, so a live session is only
    /// shown to and handled by its booth team (or the caller).
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010120000_AddAppointmentSessionStaff")]
    public partial class AddAppointmentSessionStaff : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""SessionStaffUserId"" uuid NULL;
ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""SessionStaffName"" character varying(200) NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Appointments"" DROP COLUMN IF EXISTS ""SessionStaffUserId"";
ALTER TABLE ""Appointments"" DROP COLUMN IF EXISTS ""SessionStaffName"";
");
        }
    }
}
