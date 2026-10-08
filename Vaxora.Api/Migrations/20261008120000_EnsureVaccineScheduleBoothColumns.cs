using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Re-applies the VaccineSchedules booth columns. On a fresh database the startup baseline
    /// marks AddVaccineScheduleBooth as applied, and AddAppointmentsAndBooths creates
    /// VaccineSchedules without them. Idempotent, so a no-op on databases that already have them.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261008120000_EnsureVaccineScheduleBoothColumns")]
    public partial class EnsureVaccineScheduleBoothColumns : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""VaccineSchedules"" ADD COLUMN IF NOT EXISTS ""BoothId"" uuid NULL;
ALTER TABLE ""VaccineSchedules"" ADD COLUMN IF NOT EXISTS ""BoothLabel"" character varying(120) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FK_VaccineSchedules_HospitalBooths_BoothId'
    ) THEN
        ALTER TABLE ""VaccineSchedules""
            ADD CONSTRAINT ""FK_VaccineSchedules_HospitalBooths_BoothId""
            FOREIGN KEY (""BoothId"") REFERENCES ""HospitalBooths"" (""Id"")
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ""IX_VaccineSchedules_BoothId"" ON ""VaccineSchedules"" (""BoothId"");
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Columns belong to AddVaccineScheduleBooth; nothing to undo here.
        }
    }
}
