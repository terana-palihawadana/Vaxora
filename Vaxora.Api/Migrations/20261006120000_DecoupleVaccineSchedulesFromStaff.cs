using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Vaccine schedules define clinic windows; staff are rostered separately.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261006120000_DecoupleVaccineSchedulesFromStaff")]
    public partial class DecoupleVaccineSchedulesFromStaff : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""VaccineSchedules"" DROP CONSTRAINT IF EXISTS ""FK_VaccineSchedules_Users_DoctorUserId"";
ALTER TABLE ""VaccineSchedules"" DROP CONSTRAINT IF EXISTS ""FK_VaccineSchedules_Users_NurseUserId"";
DROP INDEX IF EXISTS ""IX_VaccineSchedules_DoctorUserId"";
DROP INDEX IF EXISTS ""IX_VaccineSchedules_NurseUserId"";
ALTER TABLE ""VaccineSchedules"" DROP COLUMN IF EXISTS ""DoctorUserId"";
ALTER TABLE ""VaccineSchedules"" DROP COLUMN IF EXISTS ""DoctorName"";
ALTER TABLE ""VaccineSchedules"" DROP COLUMN IF EXISTS ""NurseUserId"";
ALTER TABLE ""VaccineSchedules"" DROP COLUMN IF EXISTS ""NurseName"";
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""VaccineSchedules""
    ADD COLUMN ""DoctorUserId"" uuid NULL,
    ADD COLUMN ""DoctorName"" character varying(200) NOT NULL DEFAULT '',
    ADD COLUMN ""NurseUserId"" uuid NULL,
    ADD COLUMN ""NurseName"" character varying(200) NOT NULL DEFAULT '';
ALTER TABLE ""VaccineSchedules"" ALTER COLUMN ""DoctorName"" DROP DEFAULT;
ALTER TABLE ""VaccineSchedules"" ALTER COLUMN ""NurseName"" DROP DEFAULT;
ALTER TABLE ""VaccineSchedules""
    ADD CONSTRAINT ""FK_VaccineSchedules_Users_DoctorUserId""
        FOREIGN KEY (""DoctorUserId"") REFERENCES ""Users"" (""Id"");
ALTER TABLE ""VaccineSchedules""
    ADD CONSTRAINT ""FK_VaccineSchedules_Users_NurseUserId""
        FOREIGN KEY (""NurseUserId"") REFERENCES ""Users"" (""Id"");
CREATE INDEX ""IX_VaccineSchedules_DoctorUserId"" ON ""VaccineSchedules"" (""DoctorUserId"");
CREATE INDEX ""IX_VaccineSchedules_NurseUserId"" ON ""VaccineSchedules"" (""NurseUserId"");
");
        }
    }
}
