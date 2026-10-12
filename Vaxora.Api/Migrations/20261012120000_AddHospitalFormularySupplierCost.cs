using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Supplier cost per vial is what the hospital pays, separate from the patient fee in Price.
    /// Purchase orders are priced from it.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261012120000_AddHospitalFormularySupplierCost")]
    public partial class AddHospitalFormularySupplierCost : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""HospitalFormularies"" ADD COLUMN IF NOT EXISTS ""SupplierCost"" numeric NOT NULL DEFAULT 0;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""HospitalFormularies"" DROP COLUMN IF EXISTS ""SupplierCost"";
");
        }
    }
}
