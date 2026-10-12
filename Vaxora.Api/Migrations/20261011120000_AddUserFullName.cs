using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vaxora.Api.Data;

#nullable disable

namespace Vaxora.Api.Migrations
{
    /// <summary>
    /// Front-desk accounts have no profile table, so their name is kept on the user row.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261011120000_AddUserFullName")]
    public partial class AddUserFullName : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""FullName"" character varying(150) NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Users"" DROP COLUMN IF EXISTS ""FullName"";
");
        }
    }
}
