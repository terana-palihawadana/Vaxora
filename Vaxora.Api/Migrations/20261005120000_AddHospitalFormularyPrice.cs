using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Hospital formulary price is the single free/paid source for a vaccine at that hospital.
    /// Schedules inherit this fee instead of inventing conflicting prices.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261005120000_AddHospitalFormularyPrice")]
    public partial class AddHospitalFormularyPrice : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""HospitalFormularies"" ADD COLUMN IF NOT EXISTS ""Price"" numeric NOT NULL DEFAULT 0;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""HospitalFormularies"" DROP COLUMN IF EXISTS ""Price"";
");
        }
    }
}
