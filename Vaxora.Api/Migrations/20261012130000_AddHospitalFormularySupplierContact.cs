using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// The supplier is recorded when a product is registered, so purchase orders
    /// and damage reports for that vaccine are emailed to the right company.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261012130000_AddHospitalFormularySupplierContact")]
    public partial class AddHospitalFormularySupplierContact : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""HospitalFormularies"" ADD COLUMN IF NOT EXISTS ""SupplierName"" character varying(200) NULL;
ALTER TABLE ""HospitalFormularies"" ADD COLUMN IF NOT EXISTS ""SupplierEmail"" character varying(200) NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""HospitalFormularies"" DROP COLUMN IF EXISTS ""SupplierName"";
ALTER TABLE ""HospitalFormularies"" DROP COLUMN IF EXISTS ""SupplierEmail"";
");
        }
    }
}
