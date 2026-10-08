using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Models;
using Vaxora.Api.Services;

namespace Vaxora.Api.Data;

public static class DbInitializer
{
    public static async Task SeedAsync(IServiceProvider serviceProvider, IConfiguration configuration)
    {
        using var scope = serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var passwordHasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<ApplicationDbContext>>();

        try
        {
            // Ensure __EFMigrationsHistory table exists in public schema
            try
            {
                await context.Database.ExecuteSqlRawAsync(@"
                    CREATE TABLE IF NOT EXISTS ""__EFMigrationsHistory"" (
                        ""MigrationId"" character varying(150) NOT NULL,
                        ""ProductVersion"" character varying(32) NOT NULL,
                        CONSTRAINT ""PK___EFMigrationsHistory"" PRIMARY KEY (""MigrationId"")
                    );
                ");

                // 20260928004401_AddAppointmentsAndBooths is a consolidated full-schema baseline migration.
                // On a clean database, executing the 16 historical migrations prior to AddAppointmentsAndBooths
                // causes collision because AddAppointmentsAndBooths re-creates the initial sequences and tables.
                // We baseline these historical migrations so AddAppointmentsAndBooths executes cleanly as the schema baseline.
                var baselineHistoricalMigrations = new[]
                {
                    "20260910031256_InitialCreate",
                    "20260910041633_AlignSignupSchema",
                    "20260910044322_RemoveDoctorHospitalAffiliation",
                    "20260910044524_RemoveNurseDepartmentAndAffiliation",
                    "20260910051426_AddVaxoraRegistrationNumbersAndSequences",
                    "20260912125907_AddStaffManagement",
                    "20260914063649_AddInventoryModule",
                    "20260918000000_AddAppointmentScheduleModule",
                    "20260920070000_AddAppointmentPrescribedDosage",
                    "20260920120000_AddPatientRecordsModule",
                    "20260922193000_AddAgentWorkflowState",
                    "20260924160000_AddHospitalBooths",
                    "20260924180000_AddHospitalBoothVaccines",
                    "20260926080618_SyncModelSnapshot",
                    "20260926090000_EnsureAppointmentScheduleColumns",
                    "20260927220000_AddVaccineScheduleBooth"
                };

                foreach (var migrationId in baselineHistoricalMigrations)
                {
                    await context.Database.ExecuteSqlRawAsync(
                        $"INSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ('{migrationId}', '8.0.11') ON CONFLICT DO NOTHING;");
                }

                // Check if baseline/incremental tables exist from prior runs.
                // If they exist, synchronize their migration IDs so EF Core's migrator executes remaining migrations cleanly.
                var subsequentChecks = new (string MigrationId, string SqlCheck)[]
                {
                    ("20260928004401_AddAppointmentsAndBooths", "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'Appointments');"),
                    ("20260929010000_AddShiftSwapRequests", "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ShiftSwapRequests');"),
                    ("20260929030000_AddCoverReplacementOnSwap", "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ShiftSwapRequests' AND column_name = 'CoverDoctorUserId');"),
                    ("20261001120000_AddAgentWorkflowExecutionEvidence", "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'AgentWorkflows' AND column_name = 'CompletedStepsJson');"),
                    ("20261002120000_AddBatchOpenVialDosesRemaining", "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Batches' AND column_name = 'OpenVialDosesRemaining');"),
                    ("20261002130000_AllowGuestWalkInAppointments", "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Appointments' AND column_name = 'GuestWalkInPatientName');"),
                    ("20261005120000_AddHospitalFormularyPrice", "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'HospitalFormularies' AND column_name = 'Price');")
                };

                foreach (var (migrationId, sqlCheck) in subsequentChecks)
                {
                    try
                    {
                        var conn = context.Database.GetDbConnection();
                        if (conn.State != System.Data.ConnectionState.Open)
                        {
                            await conn.OpenAsync();
                        }
                        using var command = conn.CreateCommand();
                        command.CommandText = sqlCheck;
                        var exists = (bool?)await command.ExecuteScalarAsync() ?? false;
                        if (exists)
                        {
                            await context.Database.ExecuteSqlRawAsync(
                                $"INSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ('{migrationId}', '8.0.11') ON CONFLICT DO NOTHING;");
                        }
                    }
                    catch (Exception exCheck)
                    {
                        logger.LogWarning(exCheck, "Notice checking migration synchronization for {MigrationId}: {Message}", migrationId, exCheck.Message);
                    }
                }
            }
            catch (Exception exInitHist)
            {
                logger.LogWarning(exInitHist, "Notice during __EFMigrationsHistory baseline setup: {Message}", exInitHist.Message);
            }

            // Apply critical additive columns even if EF MigrateAsync is blocked
            // (e.g. incomplete migration metadata). Inventory queries depend on these.
            try
            {
                await context.Database.ExecuteSqlRawAsync(@"
                    ALTER TABLE ""Batches"" ADD COLUMN IF NOT EXISTS ""OpenVialDosesRemaining"" INTEGER NULL;
                ");
            }
            catch (Exception exBootstrap)
            {
                logger.LogWarning(exBootstrap, "Non-fatal notice during early schema bootstrap: {Message}", exBootstrap.Message);
            }

            try
            {
                await context.Database.MigrateAsync();
            }
            catch (Exception exMigrate)
            {
                logger.LogWarning(exMigrate, "MigrateAsync notice: {Message}. Continuing to safe schema synchronization and account seeding.", exMigrate.Message);
            }

            // Safe column checks for pricing, agent workflows, and payment integration
            try
            {
                await context.Database.ExecuteSqlRawAsync(@"
                    ALTER TABLE ""VaccineSchedules"" ADD COLUMN IF NOT EXISTS ""Price"" NUMERIC(18,2) NOT NULL DEFAULT 0.00;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""Fee"" NUMERIC(18,2) NOT NULL DEFAULT 0.00;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""PaymentMethod"" VARCHAR(50) NOT NULL DEFAULT 'Free';
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""PaymentStatus"" VARCHAR(50) NOT NULL DEFAULT 'Paid';
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""PaymentTransactionId"" VARCHAR(100) NULL;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""PrescribedDosage"" VARCHAR(100) NULL;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""PrescribedByDoctorUserId"" UUID NULL;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""PrescribedByDoctorName"" VARCHAR(200) NULL;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""DosageUpdatedAt"" TIMESTAMPTZ NULL;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""CheckedInAt"" TIMESTAMPTZ NULL;
                    ALTER TABLE ""Appointments"" ADD COLUMN IF NOT EXISTS ""CheckedInByUserId"" UUID NULL;
                    ALTER TABLE ""Batches"" ADD COLUMN IF NOT EXISTS ""OpenVialDosesRemaining"" INTEGER NULL;
                    ALTER TABLE ""AgentWorkflows"" ADD COLUMN IF NOT EXISTS ""PlanJson"" TEXT NOT NULL DEFAULT '{}';
                    ALTER TABLE ""AgentWorkflows"" ADD COLUMN IF NOT EXISTS ""CompletedStepsJson"" TEXT NOT NULL DEFAULT '[]';
                    ALTER TABLE ""AgentWorkflows"" ADD COLUMN IF NOT EXISTS ""ToolResultsJson"" TEXT NOT NULL DEFAULT '[]';
                    ALTER TABLE ""AgentWorkflows"" ADD COLUMN IF NOT EXISTS ""ValidationResultsJson"" TEXT NOT NULL DEFAULT '{}';
                    ALTER TABLE ""AgentWorkflows"" ADD COLUMN IF NOT EXISTS ""ErrorDetails"" VARCHAR(4000) NULL;
                    ALTER TABLE ""AgentWorkflows"" ADD COLUMN IF NOT EXISTS ""FinalOutcome"" VARCHAR(4000) NULL;

                    CREATE TABLE IF NOT EXISTS ""PatientMedicalHistories"" (
                        ""Id"" UUID PRIMARY KEY,
                        ""PatientProfileId"" UUID NOT NULL REFERENCES ""PatientProfiles""(""Id"") ON DELETE CASCADE,
                        ""RecordType"" VARCHAR(50) NOT NULL,
                        ""Title"" VARCHAR(200) NOT NULL,
                        ""Description"" VARCHAR(2000) NULL,
                        ""Severity"" VARCHAR(50) NOT NULL,
                        ""Status"" VARCHAR(50) NOT NULL,
                        ""Icd10Code"" VARCHAR(20) NULL,
                        ""DiagnosedAt"" TIMESTAMPTZ NOT NULL,
                        ""ResolvedAt"" TIMESTAMPTZ NULL,
                        ""RecordedByUserId"" UUID NULL REFERENCES ""Users""(""Id"") ON DELETE SET NULL,
                        ""RecordedByName"" VARCHAR(200) NULL,
                        ""Notes"" VARCHAR(1000) NULL,
                        ""CreatedAt"" TIMESTAMPTZ NOT NULL,
                        ""UpdatedAt"" TIMESTAMPTZ NULL
                    );

                    CREATE TABLE IF NOT EXISTS ""PatientVaccinationRecords"" (
                        ""Id"" UUID PRIMARY KEY,
                        ""PatientProfileId"" UUID NOT NULL REFERENCES ""PatientProfiles""(""Id"") ON DELETE CASCADE,
                        ""VaccineId"" UUID NOT NULL REFERENCES ""Vaccines""(""Id"") ON DELETE RESTRICT,
                        ""BatchId"" UUID NULL REFERENCES ""Batches""(""Id"") ON DELETE SET NULL,
                        ""AdministeredByUserId"" UUID NULL REFERENCES ""Users""(""Id"") ON DELETE SET NULL,
                        ""AdministeredByName"" VARCHAR(200) NULL,
                        ""AdministeredAt"" TIMESTAMPTZ NOT NULL,
                        ""DoseNumber"" INT NOT NULL DEFAULT 1,
                        ""Route"" VARCHAR(50) NOT NULL,
                        ""Site"" VARCHAR(50) NULL,
                        ""LotNumber"" VARCHAR(100) NULL,
                        ""Notes"" VARCHAR(1000) NULL,
                        ""AdverseEventReported"" BOOLEAN NOT NULL DEFAULT FALSE,
                        ""AdverseEventNotes"" VARCHAR(1000) NULL,
                        ""CreatedAt"" TIMESTAMPTZ NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS ""PatientVisits"" (
                        ""Id"" UUID PRIMARY KEY,
                        ""PatientProfileId"" UUID NOT NULL REFERENCES ""PatientProfiles""(""Id"") ON DELETE CASCADE,
                        ""DoctorUserId"" UUID NULL REFERENCES ""Users""(""Id"") ON DELETE SET NULL,
                        ""DoctorName"" VARCHAR(200) NULL,
                        ""NurseUserId"" UUID NULL REFERENCES ""Users""(""Id"") ON DELETE SET NULL,
                        ""NurseName"" VARCHAR(200) NULL,
                        ""HospitalProfileId"" UUID NULL REFERENCES ""HospitalProfiles""(""Id"") ON DELETE SET NULL,
                        ""AppointmentId"" UUID NULL,
                        ""VisitDate"" TIMESTAMPTZ NOT NULL,
                        ""VisitType"" VARCHAR(50) NOT NULL,
                        ""Status"" VARCHAR(50) NOT NULL,
                        ""ChiefComplaint"" VARCHAR(1000) NULL,
                        ""BloodPressure"" VARCHAR(20) NULL,
                        ""Temperature"" VARCHAR(10) NULL,
                        ""WeightKg"" VARCHAR(10) NULL,
                        ""HeightCm"" VARCHAR(10) NULL,
                        ""HeartRate"" VARCHAR(10) NULL,
                        ""OxygenSaturation"" VARCHAR(10) NULL,
                        ""DiagnosisSummary"" VARCHAR(2000) NULL,
                        ""TreatmentPlan"" VARCHAR(2000) NULL,
                        ""Notes"" VARCHAR(1000) NULL,
                        ""FollowUpDate"" TIMESTAMPTZ NULL,
                        ""CreatedAt"" TIMESTAMPTZ NOT NULL,
                        ""UpdatedAt"" TIMESTAMPTZ NULL
                    );
                ");
            }
            catch (Exception exSql)
            {
                logger.LogWarning(exSql, "Non-fatal notice during database schema sync: {Message}", exSql.Message);
            }

            // ============ SEED ADMIN ============
            // Seed Admin if not exists
            var adminEmail = configuration["AdminSeed:Email"] ?? "admin@vaxora.health.gov.lk";
            var adminPassword = configuration["AdminSeed:Password"] ?? "Admin@Vaxora2026";

            var existingAdmin = await context.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == adminEmail.ToLower());
            if (existingAdmin == null)
            {
                var admin = new User
                {
                    Id = Guid.NewGuid(),
                    Email = adminEmail.ToLower(),
                    PasswordHash = passwordHasher.HashPassword(adminPassword),
                    Role = UserRole.ADMIN,
                    Status = UserStatus.Active,
                    PhoneNumber = "+94112345678",
                    RegistrationNumber = "VAX-A-1000",
                    CreatedAt = DateTime.UtcNow
                };

                context.Users.Add(admin);
                context.AuditLogs.Add(new AuditLog
                {
                    UserId = admin.Id,
                    UserEmail = admin.Email,
                    Role = "ADMIN",
                    Action = "SYSTEM_SEED",
                    Details = "Initial system administrator provisioned on startup",
                    Timestamp = DateTime.UtcNow
                });

                await context.SaveChangesAsync();
                logger.LogInformation("Administrator account successfully seeded: {AdminEmail}", adminEmail);
            }

            // ============ SEED TEST HOSPITAL (DEV ONLY) ============
            // TODO(revert): remove before merging to main
            const string testHospitalEmail = "hospital@vaxora.local";
            const string testHospitalPassword = "Hospital@123";

            var existingHospital = await context.Users
                .FirstOrDefaultAsync(u => u.Email.ToLower() == testHospitalEmail.ToLower());

            if (existingHospital == null)
            {
                var hospitalUser = new User
                {
                    Id = Guid.NewGuid(),
                    Email = testHospitalEmail,
                    PasswordHash = passwordHasher.HashPassword(testHospitalPassword),
                    Role = UserRole.HOSPITAL,
                    Status = UserStatus.Active,
                    PhoneNumber = "+94112345678",
                    RegistrationNumber = "VAX-H-9001",
                    CreatedAt = DateTime.UtcNow
                };
                context.Users.Add(hospitalUser);

                var hospitalProfile = new HospitalProfile
                {
                    Id = Guid.NewGuid(),
                    UserId = hospitalUser.Id,
                    HospitalName = "Test Hospital",
                    RegistrationNumber = "REG-TEST-9001",
                    HospitalType = "Government",
                    Address = "1 Test Road, Colombo",
                    District = "Colombo",
                    Province = "Western",
                    ContactNumber = "+94112345678",
                    VerificationStatus = VerificationStatus.Approved,
                    CreatedAt = DateTime.UtcNow
                };
                context.HospitalProfiles.Add(hospitalProfile);

                context.AuditLogs.Add(new AuditLog
                {
                    UserId = hospitalUser.Id,
                    UserEmail = hospitalUser.Email,
                    Role = "HOSPITAL",
                    Action = "SYSTEM_SEED",
                    Details = "Test hospital account provisioned on startup (dev only)",
                    Timestamp = DateTime.UtcNow
                });

                await context.SaveChangesAsync();
                logger.LogInformation("Test hospital account seeded: {Email} / {Password}",
                    testHospitalEmail, testHospitalPassword);
            }

            // ============ SEED TEST PATIENT (DEV ONLY) ============
            const string testPatientEmail = "patient1@vaxora.lk";
            const string testPatientPassword = "Password123!";

            var existingPatient = await context.Users
                .FirstOrDefaultAsync(u => u.Email.ToLower() == testPatientEmail.ToLower());

            if (existingPatient == null)
            {
                var patientUser = new User
                {
                    Id = Guid.NewGuid(),
                    Email = testPatientEmail,
                    PasswordHash = passwordHasher.HashPassword(testPatientPassword),
                    Role = UserRole.PATIENT,
                    Status = UserStatus.Active,
                    PhoneNumber = "0771234567",
                    RegistrationNumber = "VAX-P-1003",
                    CreatedAt = DateTime.UtcNow
                };
                context.Users.Add(patientUser);

                var patientProfile = new PatientProfile
                {
                    Id = Guid.NewGuid(),
                    UserId = patientUser.Id,
                    FullName = "Kamal Perera",
                    NicNumber = "199512345678",
                    DateOfBirth = new DateTime(1995, 5, 15, 0, 0, 0, DateTimeKind.Utc),
                    PhoneNumber = "0771234567",
                    CreatedAt = DateTime.UtcNow
                };
                context.PatientProfiles.Add(patientProfile);

                context.AuditLogs.Add(new AuditLog
                {
                    UserId = patientUser.Id,
                    UserEmail = patientUser.Email,
                    Role = "PATIENT",
                    Action = "SYSTEM_SEED",
                    Details = "Test patient account provisioned on startup (dev only)",
                    Timestamp = DateTime.UtcNow
                });

                await context.SaveChangesAsync();
                logger.LogInformation("Test patient account seeded: {Email} / {Password}",
                    testPatientEmail, testPatientPassword);
            }
            // ============ END DEV-ONLY ============
            // Seed National Vaccines if not exists
            if (!await context.Vaccines.AnyAsync())
            {
                var defaultVaccines = new List<Vaccine>
                {
                    new Vaccine { Name = "AstraZeneca", Manufacturer = "AstraZeneca", Category = VaccineCategory.Routine, DosesPerVial = 1, RequiredTemp = "+2°C to +8°C Chilled", DefaultMinThreshold = 100 },
                    new Vaccine { Name = "Pfizer Bivalent mRNA", Manufacturer = "Pfizer-BioNTech", Category = VaccineCategory.MRNA, DosesPerVial = 6, RequiredTemp = "-80°C to -60°C Deep Freeze", DefaultMinThreshold = 200 },
                    new Vaccine { Name = "Hepatitis B Recombinant", Manufacturer = "Serum Institute of India", Category = VaccineCategory.Routine, DosesPerVial = 10, RequiredTemp = "+2°C to +8°C Chilled", DefaultMinThreshold = 300 },
                    new Vaccine { Name = "Moderna Spikevax", Manufacturer = "Moderna Inc.", Category = VaccineCategory.MRNA, DosesPerVial = 10, RequiredTemp = "-25°C to -15°C Frozen", DefaultMinThreshold = 150 },
                    new Vaccine { Name = "Influenza (Quadrivalent)", Manufacturer = "Sanofi Pasteur", Category = VaccineCategory.Seasonal, DosesPerVial = 1, RequiredTemp = "+2°C to +8°C Chilled", DefaultMinThreshold = 250 },
                    new Vaccine { Name = "MMR (Measles, Mumps, Rubella)", Manufacturer = "GlaxoSmithKline", Category = VaccineCategory.Routine, DosesPerVial = 1, RequiredTemp = "+2°C to +8°C Chilled", DefaultMinThreshold = 200 },
                    new Vaccine { Name = "BCG (Tuberculosis)", Manufacturer = "State Pharmaceuticals Corp", Category = VaccineCategory.Routine, DosesPerVial = 20, RequiredTemp = "+2°C to +8°C Chilled", DefaultMinThreshold = 100 }
                };

                context.Vaccines.AddRange(defaultVaccines);
                await context.SaveChangesAsync();
                logger.LogInformation("National immunization vaccines successfully initialized.");
            }

            // Ensure test hospital has AstraZeneca formulary & schedule
            var hospitalUserInstance = await context.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == testHospitalEmail.ToLower());
            if (hospitalUserInstance != null)
            {
                var hospitalProf = await context.HospitalProfiles.FirstOrDefaultAsync(p => p.UserId == hospitalUserInstance.Id);
                var astraVaccine = await context.Vaccines.FirstOrDefaultAsync(v => v.Name == "AstraZeneca");

                if (hospitalProf != null && astraVaccine != null)
                {
                    var hasFormulary = await context.HospitalFormularies.AnyAsync(f => f.HospitalProfileId == hospitalProf.Id && f.VaccineId == astraVaccine.Id);
                    if (!hasFormulary)
                    {
                        context.HospitalFormularies.Add(new HospitalFormulary
                        {
                            Id = Guid.NewGuid(),
                            HospitalProfileId = hospitalProf.Id,
                            VaccineId = astraVaccine.Id,
                            RegisteredAt = DateTime.UtcNow
                        });
                        await context.SaveChangesAsync();
                    }

                    var hasSchedule = await context.VaccineSchedules.AnyAsync(s => s.HospitalUserId == hospitalUserInstance.Id && s.VaccineName == "AstraZeneca");
                    if (!hasSchedule)
                    {
                        context.VaccineSchedules.Add(new VaccineSchedule
                        {
                            Id = Guid.NewGuid(),
                            HospitalUserId = hospitalUserInstance.Id,
                            HospitalProfileId = hospitalProf.Id,
                            VaccineId = astraVaccine.Id,
                            VaccineName = "AstraZeneca",
                            ScheduleType = "Weekly",
                            DaysOfWeek = "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                            StartDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
                            EndDate = DateOnly.FromDateTime(DateTime.UtcNow.AddYears(1)),
                            StartTime = "09:00",
                            EndTime = "11:00",
                            Status = "Active",
                            Price = 1000.00m,
                            CreatedAt = DateTime.UtcNow
                        });
                        await context.SaveChangesAsync();
                    }
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error occurred while seeding database");
        }
    }
}
