using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Models;

namespace Vaxora.Api.Services;

public interface IInventoryService
{
    Task<List<VaccineDto>> GetGlobalVaccinesAsync();
    Task<List<VaccineWithHospitalsDto>> GetVaccinesWithHospitalsAsync();
    Task<List<FormularyEntryDto>> GetFormularyAsync(Guid userId);
    Task<FormularyEntryDto> RegisterFormularyAsync(Guid userId, RegisterFormularyDto dto);
    Task<FormularyEntryDto> UpdateFormularyPriceAsync(Guid userId, Guid formularyId, UpdateFormularyPriceDto dto);
    Task<bool> RemoveFormularyAsync(Guid userId, Guid formularyId);
    Task<List<InventoryItemDto>> GetInventoryAsync(Guid userId, Guid? hospitalUserId = null);
    Task<InventoryItemDto> RestockBatchAsync(Guid userId, RestockBatchDto dto);
    Task<InventoryItemDto> LogWastageAsync(Guid userId, Guid batchId, WastageDto dto);
    Task<InventoryItemDto> AdjustStockAsync(Guid userId, Guid batchId, AdjustStockDto dto);
    Task<InventoryItemDto> IssueStockAsync(Guid userId, Guid batchId, IssueStockDto dto);
    Task<BatchAuditDto> GetBatchAuditAsync(Guid userId, Guid batchId);
    Task<List<ColdVaultDto>> GetColdVaultsAsync(Guid userId);
    Task<InventorySummaryDto> GetSummaryAsync(Guid userId);
    Task<List<InventoryItemDto>> GetExpiringBatchesAsync(Guid userId, int daysThreshold);
    Task<object> ExecuteAgentDraftAsync(Guid userId, ExecuteDraftDto dto);
    Task<List<InventoryAgentWorkflowDto>> GetRecentAgentWorkflowsAsync(Guid userId, int limit);
}

public class InventoryService : IInventoryService
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<InventoryService> _logger;
    private readonly IEmailService _emailService;

    public InventoryService(
        ApplicationDbContext context,
        ILogger<InventoryService> logger,
        IEmailService emailService)
    {
        _context = context;
        _logger = logger;
        _emailService = emailService;
    }

    // ==================== HELPERS ====================

    private async Task<HospitalProfile?> GetHospitalAsync(Guid userId, Guid? preferredHospitalUserId = null)
    {
        var own = await _context.HospitalProfiles.FirstOrDefaultAsync(h => h.UserId == userId);
        if (own != null) return own;

        // Doctor/Nurse: prefer the hospital they are currently working in when provided.
        if (preferredHospitalUserId.HasValue)
        {
            var affiliatedPreferred = await _context.StaffAffiliations
                .AsNoTracking()
                .AnyAsync(a =>
                    a.StaffUserId == userId &&
                    a.HospitalUserId == preferredHospitalUserId.Value &&
                    a.Status == AffiliationStatus.Active);

            if (affiliatedPreferred)
            {
                return await _context.HospitalProfiles
                    .FirstOrDefaultAsync(h => h.UserId == preferredHospitalUserId.Value);
            }
        }

        var hospitalUserId = await _context.StaffAffiliations
            .AsNoTracking()
            .Where(a => a.StaffUserId == userId && a.Status == AffiliationStatus.Active)
            .OrderBy(a => a.InvitedAt)
            .Select(a => (Guid?)a.HospitalUserId)
            .FirstOrDefaultAsync();

        if (hospitalUserId == null) return null;

        return await _context.HospitalProfiles.FirstOrDefaultAsync(h => h.UserId == hospitalUserId.Value);
    }

    private async Task<(string Name, string Email)> GetUserInfoAsync(Guid userId)
    {
        var user = await _context.Users
            .Include(u => u.HospitalProfile)
            .Include(u => u.NurseProfile)
            .Include(u => u.DoctorProfile)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null) return ("System", "system@vaxora.local");

        var name = user.HospitalProfile?.HospitalName
            ?? user.NurseProfile?.FullName
            ?? user.DoctorProfile?.FullName
            ?? user.Email;

        return (name, user.Email);
    }

    private static string ComputeCategory(VaccineCategory c) => c switch
    {
        VaccineCategory.MRNA => "mrna",
        VaccineCategory.Routine => "routine",
        VaccineCategory.Seasonal => "seasonal",
        VaccineCategory.Pediatric => "pediatric",
        _ => "routine"
    };

    private static VaccineCategory ParseCategory(string? raw) =>
        (raw ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "mrna" => VaccineCategory.MRNA,
            "seasonal" => VaccineCategory.Seasonal,
            "pediatric" => VaccineCategory.Pediatric,
            _ => VaccineCategory.Routine
        };

    private static string ComputeStatusColor(int available, int minThreshold)
    {
        if (available <= minThreshold) return "bar-red";
        if (available <= minThreshold * 1.5) return "bar-orange";
        return "bar-green";
    }

    private static string ComputeExpiryStatus(DateTime expiry)
    {
        if (expiry < DateTime.UtcNow) return "expired";
        if (expiry <= DateTime.UtcNow.AddDays(60)) return "expiring_soon";
        return "healthy";
    }

    private static DateTime EnsureUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static WastageReason MapWastageReason(string reason) => reason?.ToLower() switch
    {
        "vial_breakage" => WastageReason.VialBreakage,
        "cold_chain_excursion" => WastageReason.ColdChainExcursion,
        "expired_unopened" => WastageReason.ExpiredUnopened,
        "open_vial_expiration" => WastageReason.OpenVialExpiration,
        "reconstitution_error" => WastageReason.ReconstitutionError,
        "contamination" => WastageReason.Contamination,
        _ => WastageReason.VialBreakage
    };

    private static InventoryItemDto MapToItemDto(Batch b, Vaccine v)
    {
        var minThreshold = v.DefaultMinThreshold;
        var lastRestock = b.LastRestockedAt ?? b.CreatedAt;
        var openDoses = Math.Max(0, b.OpenVialDosesRemaining ?? 0);
        return new InventoryItemDto
        {
            Id = b.Id,
            VaccineId = v.Id,
            Name = v.Name,
            Manufacturer = v.Manufacturer,
            Category = ComputeCategory(v.Category),
            LotNumber = b.BatchNumber,
            Available = b.QuantityAvailable,
            Capacity = b.QuantityReceived,
            MinThreshold = minThreshold,
            DosesPerVial = v.DosesPerVial,
            OpenVialDosesRemaining = openDoses,
            AvailableDoses = InventoryDoseHelper.AvailableDoseCount(b, v),
            Expiry = b.ExpiryDate.ToString("yyyy-MM-dd"),
            ExpiryStatus = ComputeExpiryStatus(b.ExpiryDate),
            Temp = v.RequiredTemp,
            StorageUnit = b.StorageUnit ?? "Chiller Unit B (2-8°C)",
            StatusColor = ComputeStatusColor(b.QuantityAvailable, minThreshold),
            LastRestocked = lastRestock.ToString("yyyy-MM-dd")
        };
    }

    // ==================== VACCINES (GLOBAL) ====================

    public async Task<List<VaccineDto>> GetGlobalVaccinesAsync()
    {
        return await _context.Vaccines
            .OrderBy(v => v.Name)
            .Select(v => new VaccineDto
            {
                Id = v.Id,
                Name = v.Name,
                Manufacturer = v.Manufacturer,
                Category = ComputeCategory(v.Category),
                DosesPerVial = v.DosesPerVial,
                RequiredTemp = v.RequiredTemp,
                DefaultMinThreshold = v.DefaultMinThreshold
            })
            .ToListAsync();
    }

    public async Task<List<VaccineWithHospitalsDto>> GetVaccinesWithHospitalsAsync()
    {
        var vaccines = await _context.Vaccines
            .OrderBy(v => v.Name)
            .ToListAsync();

        var formularies = await _context.HospitalFormularies
            .Include(f => f.HospitalProfile)
            .ToListAsync();

        var groupedVaccines = vaccines
            .GroupBy(v => v.Name.Trim(), StringComparer.OrdinalIgnoreCase);

        var result = new List<VaccineWithHospitalsDto>();

        foreach (var group in groupedVaccines)
        {
            var first = group.First();
            var vaccineIds = group.Select(v => v.Id).ToHashSet();

            var offeringHospitals = formularies
                .Where(f => vaccineIds.Contains(f.VaccineId) && f.HospitalProfile != null)
                .Select(f => new HospitalSummaryDto
                {
                    Id = f.HospitalProfile.UserId,
                    UserId = f.HospitalProfile.UserId,
                    HospitalProfileId = f.HospitalProfile.Id,
                    Name = f.HospitalProfile.HospitalName,
                    Location = f.HospitalProfile.Address,
                    District = f.HospitalProfile.District,
                    Type = f.HospitalProfile.HospitalType,
                    ContactNumber = f.HospitalProfile.ContactNumber
                })
                .GroupBy(h => h.Id)
                .Select(g => g.First())
                .ToList();

            var manufacturers = group
                .Select(v => v.Manufacturer)
                .Where(m => !string.IsNullOrWhiteSpace(m))
                .Distinct()
                .ToList();

            result.Add(new VaccineWithHospitalsDto
            {
                Id = first.Id,
                Name = first.Name,
                Manufacturer = manufacturers.Count > 0 ? string.Join(", ", manufacturers) : first.Manufacturer,
                Category = ComputeCategory(first.Category),
                DosesPerVial = first.DosesPerVial,
                RequiredTemp = first.RequiredTemp,
                Hospitals = offeringHospitals
            });
        }

        return result;
    }

    // ==================== FORMULARY ====================

    public async Task<List<FormularyEntryDto>> GetFormularyAsync(Guid userId)
    {
        var hospital = await GetHospitalAsync(userId);
        if (hospital == null) return new List<FormularyEntryDto>();

        return await _context.HospitalFormularies
            .Where(f => f.HospitalProfileId == hospital.Id)
            .Include(f => f.Vaccine)
            .OrderBy(f => f.Vaccine.Name)
            .Select(f => new FormularyEntryDto
            {
                Id = f.Id,
                VaccineId = f.VaccineId,
                VaccineName = f.Vaccine.Name,
                Manufacturer = f.Vaccine.Manufacturer,
                Price = f.Price,
                RegisteredAt = f.RegisteredAt
            })
            .ToListAsync();
    }

    public async Task<FormularyEntryDto> RegisterFormularyAsync(Guid userId, RegisterFormularyDto dto)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can manage formulary.");

        var (_, userEmail) = await GetUserInfoAsync(userId);

        var normalizedName = dto.VaccineName.Trim();
        var price = Math.Max(0.00m, dto.Price);
        var category = ParseCategory(dto.Category);
        var vaccine = await _context.Vaccines
            .FirstOrDefaultAsync(v => v.Name.ToLower() == normalizedName.ToLower());

        if (vaccine == null)
        {
            vaccine = new Vaccine
            {
                Name = normalizedName,
                Manufacturer = string.IsNullOrWhiteSpace(dto.Manufacturer) ? "Authorized State Manufacturer" : dto.Manufacturer.Trim(),
                Category = category,
                DosesPerVial = 1,
                RequiredTemp = "2°C to 8°C Chilled",
                DefaultMinThreshold = 100
            };
            _context.Vaccines.Add(vaccine);
            await _context.SaveChangesAsync();
        }
        else if (!string.IsNullOrWhiteSpace(dto.Category) && vaccine.Category != category)
        {
            // Allow hospital to correct catalog category when (re)registering
            vaccine.Category = category;
        }

        var existing = await _context.HospitalFormularies
            .FirstOrDefaultAsync(f => f.HospitalProfileId == hospital.Id && f.VaccineId == vaccine.Id);

        if (existing != null)
        {
            existing.Price = price;
            await SyncActiveSchedulePricesAsync(hospital.UserId, hospital.Id, vaccine.Id, price);
            await _context.SaveChangesAsync();
            return MapFormularyDto(existing, vaccine);
        }

        var entry = new HospitalFormulary
        {
            HospitalProfileId = hospital.Id,
            VaccineId = vaccine.Id,
            Price = price
        };
        _context.HospitalFormularies.Add(entry);

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "FORMULARY_REGISTERED",
            Details = $"Vaccine '{vaccine.Name}' added to formulary at {(price <= 0 ? "Free" : $"LKR {price:N2}")}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        return MapFormularyDto(entry, vaccine);
    }

    public async Task<FormularyEntryDto> UpdateFormularyPriceAsync(Guid userId, Guid formularyId, UpdateFormularyPriceDto dto)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can manage formulary.");

        var entry = await _context.HospitalFormularies
            .Include(f => f.Vaccine)
            .FirstOrDefaultAsync(f => f.Id == formularyId && f.HospitalProfileId == hospital.Id)
            ?? throw new KeyNotFoundException("Formulary entry not found.");

        var price = Math.Max(0.00m, dto.Price);
        entry.Price = price;
        if (!string.IsNullOrWhiteSpace(dto.Category) && entry.Vaccine != null)
            entry.Vaccine.Category = ParseCategory(dto.Category);
        await SyncActiveSchedulePricesAsync(hospital.UserId, hospital.Id, entry.VaccineId, price);
        await _context.SaveChangesAsync();

        return MapFormularyDto(entry, entry.Vaccine!);
    }

    private async Task SyncActiveSchedulePricesAsync(
        Guid hospitalUserId,
        Guid hospitalProfileId,
        Guid vaccineId,
        decimal price)
    {
        var schedules = await _context.VaccineSchedules
            .Where(s =>
                s.Status == "Active" &&
                (s.HospitalUserId == hospitalUserId || s.HospitalProfileId == hospitalProfileId) &&
                s.VaccineId == vaccineId)
            .ToListAsync();

        foreach (var schedule in schedules)
            schedule.Price = price;
    }

    private static FormularyEntryDto MapFormularyDto(HospitalFormulary entry, Vaccine vaccine) => new()
    {
        Id = entry.Id,
        VaccineId = vaccine.Id,
        VaccineName = vaccine.Name,
        Manufacturer = vaccine.Manufacturer,
        Category = ComputeCategory(vaccine.Category),
        Price = entry.Price,
        RegisteredAt = entry.RegisteredAt
    };

    public async Task<bool> RemoveFormularyAsync(Guid userId, Guid formularyId)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can manage formulary.");

        var (_, userEmail) = await GetUserInfoAsync(userId);

        var entry = await _context.HospitalFormularies
            .Include(f => f.Vaccine)
            .FirstOrDefaultAsync(f => f.Id == formularyId && f.HospitalProfileId == hospital.Id)
            ?? throw new InvalidOperationException("Formulary entry not found.");

        var hasBatches = await _context.Batches
            .AnyAsync(b => b.HospitalProfileId == hospital.Id && b.VaccineId == entry.VaccineId && b.QuantityAvailable > 0);
        if (hasBatches)
            throw new InvalidOperationException("Cannot remove — this vaccine still has stock in inventory.");

        _context.HospitalFormularies.Remove(entry);
        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "FORMULARY_REMOVED",
            Details = $"Vaccine '{entry.Vaccine.Name}' removed from formulary",
            Timestamp = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();
        return true;
    }

    // ==================== INVENTORY (BATCHES) ====================

    public async Task<List<InventoryItemDto>> GetInventoryAsync(Guid userId, Guid? hospitalUserId = null)
    {
        var hospital = await GetHospitalAsync(userId, hospitalUserId);
        if (hospital == null) return new List<InventoryItemDto>();

        var batches = await _context.Batches
            .Where(b => b.HospitalProfileId == hospital.Id)
            .Include(b => b.Vaccine)
            .OrderBy(b => b.Vaccine.Name)
            .ToListAsync();

        return batches.Select(b => MapToItemDto(b, b.Vaccine)).ToList();
    }

    public async Task<InventoryItemDto> RestockBatchAsync(Guid userId, RestockBatchDto dto)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can restock inventory.");

        var (userName, userEmail) = await GetUserInfoAsync(userId);

        var normalizedName = dto.VaccineName.Trim();
        var vaccine = await _context.Vaccines
            .FirstOrDefaultAsync(v => v.Name.ToLower() == normalizedName.ToLower());

        if (vaccine == null)
        {
            vaccine = new Vaccine
            {
                Name = normalizedName,
                Manufacturer = string.IsNullOrWhiteSpace(dto.Supplier) ? "Authorized State Manufacturer" : dto.Supplier.Trim(),
                Category = ParseCategory(dto.Category),
                DosesPerVial = 1,
                RequiredTemp = "2°C to 8°C Chilled",
                DefaultMinThreshold = 100
            };
            _context.Vaccines.Add(vaccine);
            await _context.SaveChangesAsync();
        }

        var inFormulary = await _context.HospitalFormularies
            .AnyAsync(f => f.HospitalProfileId == hospital.Id && f.VaccineId == vaccine.Id);
        if (!inFormulary)
        {
            _context.HospitalFormularies.Add(new HospitalFormulary
            {
                HospitalProfileId = hospital.Id,
                VaccineId = vaccine.Id
            });
        }

        var expiryDate = dto.ExpiryDate.HasValue
            ? EnsureUtc(dto.ExpiryDate.Value)
            : DateTime.UtcNow.AddYears(2);

        var batch = new Batch
        {
            HospitalProfileId = hospital.Id,
            VaccineId = vaccine.Id,
            BatchNumber = dto.LotNumber.Trim(),
            ExpiryDate = expiryDate,
            QuantityReceived = dto.Quantity,
            QuantityAvailable = dto.Quantity,
            StorageUnit = dto.StorageUnit,
            Supplier = dto.Supplier,
            Status = BatchStatus.Active,
            LastRestockedAt = DateTime.UtcNow
        };
        _context.Batches.Add(batch);
        await _context.SaveChangesAsync();

        _context.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id,
            Type = TransactionType.Restock,
            Quantity = dto.Quantity,
            Reason = $"Restock of {dto.Quantity} vials",
            PerformedByUserId = userId,
            PerformedByName = userName
        });

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "INVENTORY_RESTOCK",
            Details = $"Restocked {dto.Quantity} vials of {vaccine.Name} (Lot {batch.BatchNumber})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return MapToItemDto(batch, vaccine);
    }

    public async Task<InventoryItemDto> LogWastageAsync(Guid userId, Guid batchId, WastageDto dto)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can log wastage.");

        var (userName, userEmail) = await GetUserInfoAsync(userId);

        var batch = await _context.Batches
            .Include(b => b.Vaccine)
            .FirstOrDefaultAsync(b => b.Id == batchId && b.HospitalProfileId == hospital.Id)
            ?? throw new InvalidOperationException("Batch not found.");

        if (dto.Quantity > batch.QuantityAvailable)
            throw new InvalidOperationException($"Cannot wastage {dto.Quantity} — only {batch.QuantityAvailable} vials available.");

        batch.QuantityAvailable -= dto.Quantity;
        batch.UpdatedAt = DateTime.UtcNow;
        if (batch.QuantityAvailable == 0) batch.Status = BatchStatus.Depleted;

        var reason = MapWastageReason(dto.Reason);

        var incidentDate = dto.IncidentDate.HasValue
            ? EnsureUtc(dto.IncidentDate.Value)
            : DateTime.UtcNow;

        _context.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id,
            Type = TransactionType.Wastage,
            Quantity = dto.Quantity,
            WastageReason = reason,
            Reason = $"Wastage: {reason}",
            Notes = dto.Notes,
            IncidentDate = incidentDate,
            PerformedByUserId = userId,
            PerformedByName = dto.ReportedBy ?? userName
        });

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "INVENTORY_WASTAGE",
            Details = $"Logged {dto.Quantity} wasted vials of {batch.Vaccine.Name} (Lot {batch.BatchNumber}) — {reason}",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return MapToItemDto(batch, batch.Vaccine);
    }

    public async Task<InventoryItemDto> AdjustStockAsync(Guid userId, Guid batchId, AdjustStockDto dto)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can adjust stock.");

        var (userName, userEmail) = await GetUserInfoAsync(userId);

        var batch = await _context.Batches
            .Include(b => b.Vaccine)
            .FirstOrDefaultAsync(b => b.Id == batchId && b.HospitalProfileId == hospital.Id)
            ?? throw new InvalidOperationException("Batch not found.");

        var newQty = batch.QuantityAvailable + dto.Delta;
        if (newQty < 0)
            throw new InvalidOperationException($"Cannot adjust — result would be negative ({newQty}).");

        batch.QuantityAvailable = newQty;
        // Positive adjustments are additional receipts — keep Received in sync so
        // Available never appears to exceed Received/"capacity" in the UI.
        if (dto.Delta > 0 && batch.QuantityAvailable > batch.QuantityReceived)
            batch.QuantityReceived = batch.QuantityAvailable;

        batch.UpdatedAt = DateTime.UtcNow;
        if (batch.QuantityAvailable == 0 && batch.Status == BatchStatus.Active)
            batch.Status = BatchStatus.Depleted;
        else if (batch.QuantityAvailable > 0 && batch.Status == BatchStatus.Depleted)
            batch.Status = BatchStatus.Active;

        _context.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id,
            Type = TransactionType.Adjustment,
            Quantity = Math.Abs(dto.Delta),
            Reason = dto.Reason ?? $"Manual adjustment {(dto.Delta >= 0 ? "+" : "")}{dto.Delta}",
            PerformedByUserId = userId,
            PerformedByName = userName
        });

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "INVENTORY_ADJUST",
            Details = $"Stock adjustment {(dto.Delta >= 0 ? "+" : "")}{dto.Delta} for {batch.Vaccine.Name} (Lot {batch.BatchNumber})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return MapToItemDto(batch, batch.Vaccine);
    }

    public async Task<InventoryItemDto> IssueStockAsync(Guid userId, Guid batchId, IssueStockDto dto)
    {
        var (userName, userEmail) = await GetUserInfoAsync(userId);

        var batch = await _context.Batches
            .Include(b => b.Vaccine)
            .Include(b => b.HospitalProfile)
            .FirstOrDefaultAsync(b => b.Id == batchId)
            ?? throw new InvalidOperationException("Batch not found.");

        if (batch.QuantityAvailable < dto.Quantity)
            throw new InvalidOperationException($"Insufficient stock. Available: {batch.QuantityAvailable}, Requested: {dto.Quantity}.");

        if (batch.ExpiryDate < DateTime.UtcNow)
            throw new InvalidOperationException($"Batch {batch.BatchNumber} is expired and cannot be issued.");

        batch.QuantityAvailable -= dto.Quantity;
        batch.UpdatedAt = DateTime.UtcNow;
        if (batch.QuantityAvailable == 0) batch.Status = BatchStatus.Depleted;

        _context.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id,
            Type = TransactionType.Issue,
            Quantity = dto.Quantity,
            Reason = $"Issued to {(string.IsNullOrWhiteSpace(dto.SessionReference) ? "session" : dto.SessionReference)}",
            PerformedByUserId = userId,
            PerformedByName = userName
        });

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "INVENTORY_ISSUE",
            Details = $"Issued {dto.Quantity} vials of {batch.Vaccine.Name} (Lot {batch.BatchNumber})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();
        return MapToItemDto(batch, batch.Vaccine);
    }

    public async Task<BatchAuditDto> GetBatchAuditAsync(Guid userId, Guid batchId)
    {
        var batch = await _context.Batches
            .Include(b => b.Vaccine)
            .FirstOrDefaultAsync(b => b.Id == batchId)
            ?? throw new InvalidOperationException("Batch not found.");

        var transactions = await _context.InventoryTransactions
            .Where(t => t.BatchId == batchId)
            .OrderByDescending(t => t.Timestamp)
            .ToListAsync();

        var entries = transactions.Select(t => new AuditEntryDto
        {
            Id = t.Id,
            Timestamp = DateTime.SpecifyKind(t.Timestamp, DateTimeKind.Utc).AddHours(5.5).ToString("yyyy-MM-dd hh:mm tt"),
            Event = BuildEventText(t, batch),
            Actor = t.PerformedByName ?? "System",
            Type = t.Type switch
            {
                TransactionType.Restock => "restock",
                TransactionType.Issue => "dispense",
                TransactionType.Wastage => "qa",
                TransactionType.Adjustment => "sensor",
                _ => "qa"
            }
        }).ToList();

        return new BatchAuditDto
        {
            Vaccine = MapToItemDto(batch, batch.Vaccine),
            Entries = entries
        };
    }

    private static string BuildEventText(InventoryTransaction t, Batch b) => t.Type switch
    {
        TransactionType.Restock => $"Batch Shipment {b.BatchNumber} Logged into Inventory (+{t.Quantity} vials)",
        TransactionType.Issue => $"Dispensed {t.Quantity} vials — {t.Reason}",
        TransactionType.Wastage => $"Wastage logged: {t.Quantity} vials ({t.WastageReason})",
        TransactionType.Adjustment => $"Stock adjustment: {t.Quantity} vials — {t.Reason}",
        _ => $"Transaction: {t.Quantity} vials"
    };

    public async Task<List<ColdVaultDto>> GetColdVaultsAsync(Guid userId)
    {
        var hospital = await GetHospitalAsync(userId);
        if (hospital == null) return new List<ColdVaultDto>();

        await EnsureDefaultColdVaultsAsync(hospital.Id);

        return await _context.ColdVaults
            .AsNoTracking()
            .Where(v => v.HospitalProfileId == hospital.Id)
            .OrderBy(v => v.Name)
            .Select(v => new ColdVaultDto
            {
                Id = v.Id,
                Name = v.Name,
                Type = v.Type ?? "",
                Temp = v.CurrentTemp ?? "",
                Target = v.TargetTemp ?? "",
                Status = v.Status ?? "Optimal",
                Humidity = v.Humidity ?? "",
                SensorStatus = v.SensorStatus ?? "Active",
                AssignedLots = v.AssignedLots
            })
            .ToListAsync();
    }

    /// <summary>
    /// Ensure the three standard cold-chain units exist (add any that are missing).
    /// </summary>
    private async Task EnsureDefaultColdVaultsAsync(Guid hospitalProfileId)
    {
        var existingNames = await _context.ColdVaults
            .Where(v => v.HospitalProfileId == hospitalProfileId)
            .Select(v => v.Name)
            .ToListAsync();

        var existingSet = existingNames
            .Select(n => n.Trim().ToLowerInvariant())
            .ToHashSet();

        var defaults = new[]
        {
            new ColdVault
            {
                HospitalProfileId = hospitalProfileId,
                Name = "Ultra-Cold Vault A",
                Type = "-70°C Ultra-Cold Freezer",
                CurrentTemp = "-68.5°C",
                TargetTemp = "-70°C",
                Humidity = "N/A",
                Status = "Optimal",
                SensorStatus = "Active",
                AssignedLots = 0
            },
            new ColdVault
            {
                HospitalProfileId = hospitalProfileId,
                Name = "Chiller Unit B",
                Type = "2°C – 8°C Pharmacy Chiller",
                CurrentTemp = "4.1°C",
                TargetTemp = "2°C – 8°C",
                Humidity = "48%",
                Status = "Optimal",
                SensorStatus = "Active",
                AssignedLots = 0
            },
            new ColdVault
            {
                HospitalProfileId = hospitalProfileId,
                Name = "Mobile Deployment Chiller C",
                Type = "Portable cold box (2°C – 8°C)",
                CurrentTemp = "5.1°C",
                TargetTemp = "2°C – 8°C",
                Humidity = "50%",
                Status = "Optimal",
                SensorStatus = "Active",
                AssignedLots = 0
            }
        };

        var toAdd = defaults
            .Where(d => !existingSet.Contains(d.Name.Trim().ToLowerInvariant()))
            .ToList();

        if (toAdd.Count == 0) return;

        _context.ColdVaults.AddRange(toAdd);
        await _context.SaveChangesAsync();
    }

    // ==================== SUMMARY ====================

    public async Task<InventorySummaryDto> GetSummaryAsync(Guid userId)
    {
        var hospital = await GetHospitalAsync(userId);
        if (hospital == null) return new InventorySummaryDto();

        var batches = await _context.Batches
            .Where(b => b.HospitalProfileId == hospital.Id)
            .Include(b => b.Vaccine)
            .ToListAsync();

        var totalVials = batches.Sum(b => b.QuantityAvailable);
        var totalDoses = batches.Sum(b => InventoryDoseHelper.AvailableDoseCount(b, b.Vaccine));
        var lowStock = batches.Count(b => b.QuantityAvailable <= b.Vaccine.DefaultMinThreshold);
        var expiring = batches.Count(b => b.ExpiryDate <= DateTime.UtcNow.AddDays(60) && b.ExpiryDate >= DateTime.UtcNow);
        var formulations = batches.Select(b => b.VaccineId).Distinct().Count();

        return new InventorySummaryDto
        {
            TotalVials = totalVials,
            TotalDoses = totalDoses,
            LowStockCount = lowStock,
            ExpiringCount = expiring,
            TotalFormulations = formulations,
            ColdStorageHealth = "100%",
            VaultsOnline = await _context.ColdVaults.CountAsync(v => v.HospitalProfileId == hospital.Id)
        };
    }

    public async Task<List<InventoryItemDto>> GetExpiringBatchesAsync(Guid userId, int daysThreshold)
    {
        var hospital = await GetHospitalAsync(userId);
        if (hospital == null) return new List<InventoryItemDto>();

        var thresholdDate = DateTime.UtcNow.AddDays(daysThreshold);

        var batches = await _context.Batches
            .Where(b => b.HospitalProfileId == hospital.Id
                     && b.QuantityAvailable > 0
                     && b.ExpiryDate <= thresholdDate
                     && b.ExpiryDate >= DateTime.UtcNow)
            .Include(b => b.Vaccine)
            .OrderBy(b => b.ExpiryDate)
            .ToListAsync();

        return batches.Select(b => MapToItemDto(b, b.Vaccine)).ToList();
    }

    // ==================== AGENT DRAFT EXECUTION ====================

    public async Task<object> ExecuteAgentDraftAsync(Guid userId, ExecuteDraftDto dto)
    {
        var hospital = await GetHospitalAsync(userId)
            ?? throw new InvalidOperationException("Only hospital accounts can execute agent drafts.");

        var (userName, userEmail) = await GetUserInfoAsync(userId);

        if (dto.DraftType == "purchase_order")
        {
            return await ExecutePurchaseOrderAsync(userId, userName, userEmail, hospital, dto);
        }
        else if (dto.DraftType == "expiry_memo")
        {
            return await ExecuteExpiryMemoAsync(userId, userName, userEmail, hospital, dto);
        }

        throw new InvalidOperationException($"Unknown draft type: {dto.DraftType}");
    }

    private async Task<object> ExecutePurchaseOrderAsync(
        Guid userId, string userName, string userEmail,
        HospitalProfile hospital, ExecuteDraftDto dto)
    {
        var createdBatches = new List<object>();

        if (!dto.Payload.TryGetValue("line_items", out var liRaw) || liRaw is not System.Text.Json.JsonElement lineItems)
            throw new InvalidOperationException("Invalid payload: missing line_items.");

        foreach (var item in lineItems.EnumerateArray())
        {
            var vaccineIdStr = item.TryGetProperty("vaccine_id", out var vIdProp) ? vIdProp.GetString() : null;
            if (!Guid.TryParse(vaccineIdStr, out var vaccineId)) continue;
            var quantity = item.TryGetProperty("quantity", out var qProp) ? qProp.GetInt32() : 0;
            if (quantity <= 0) continue;

            var vaccine = await _context.Vaccines.FindAsync(vaccineId);
            if (vaccine == null) continue;

            var inFormulary = await _context.HospitalFormularies
                .AnyAsync(f => f.HospitalProfileId == hospital.Id && f.VaccineId == vaccineId);
            if (!inFormulary)
            {
                _context.HospitalFormularies.Add(new HospitalFormulary
                {
                    HospitalProfileId = hospital.Id,
                    VaccineId = vaccineId
                });
            }

            var lotNumber = $"PO-{DateTime.UtcNow:yyyyMMdd}-{new Random().Next(1000, 9999)}";
            var batch = new Batch
            {
                HospitalProfileId = hospital.Id,
                VaccineId = vaccineId,
                BatchNumber = lotNumber,
                ExpiryDate = DateTime.UtcNow.AddYears(2),
                QuantityReceived = quantity,
                QuantityAvailable = quantity,
                StorageUnit = "Chiller Unit B (2-8°C)",
                Supplier = "AI-Approved PO",
                Status = BatchStatus.Active,
                LastRestockedAt = DateTime.UtcNow
            };
            _context.Batches.Add(batch);
            await _context.SaveChangesAsync();

            _context.InventoryTransactions.Add(new InventoryTransaction
            {
                BatchId = batch.Id,
                Type = TransactionType.Restock,
                Quantity = quantity,
                Reason = $"AI PO executed — {dto.WorkflowId}",
                PerformedByUserId = userId,
                PerformedByName = $"{userName} (AI Agent)"
            });

            createdBatches.Add(new { batchId = batch.Id, lotNumber, vaccineName = vaccine.Name, quantity });
        }

        var poNumber = dto.Payload.TryGetValue("po_number", out var po) ? po?.ToString() ?? "AI-PO" : "AI-PO";

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "AI_PO_EXECUTED",
            Details = $"Executed AI purchase order {poNumber} — {createdBatches.Count} batch(es) created (workflow {dto.WorkflowId})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // ========== SEND EMAIL TO SUPPLIER ==========
        bool emailSent = false;
        string supplierEmail = Environment.GetEnvironmentVariable("Supplier__Email") ?? "supplier@spc.gov.lk";

        try
        {
            List<(string VaccineName, int Quantity, decimal UnitPrice, decimal LineTotal)> poLines =
                (dto.Payload.TryGetValue("line_items", out var rawLines) && rawLines is System.Text.Json.JsonElement linesElem)
                ? linesElem.EnumerateArray().Select(li => (
                    VaccineName: li.TryGetProperty("vaccine_name", out var v) ? v.GetString() ?? "" : "",
                    Quantity: li.TryGetProperty("quantity", out var q) ? q.GetInt32() : 0,
                    UnitPrice: li.TryGetProperty("unit_price_lkr", out var u) ? u.GetDecimal() : 0m,
                    LineTotal: li.TryGetProperty("total_lkr", out var t) ? t.GetDecimal() : 0m
                  )).ToList()
                : new List<(string VaccineName, int Quantity, decimal UnitPrice, decimal LineTotal)>();

            var totalLkr = dto.Payload.TryGetValue("total_lkr", out var tot) && tot is System.Text.Json.JsonElement tEl
                ? tEl.GetDecimal()
                : poLines.Sum(l => l.LineTotal);

            emailSent = await _emailService.SendPurchaseOrderToSupplierAsync(
                toEmail: supplierEmail,
                supplierName: "State Pharmaceuticals Corporation",
                poNumber: poNumber,
                hospitalName: hospital.HospitalName,
                orderDate: DateTime.UtcNow.ToString("yyyy-MM-dd"),
                deliveryDate: DateTime.UtcNow.AddDays(14).ToString("yyyy-MM-dd"),
                lineItems: poLines,
                totalLkr: totalLkr,
                approvalNotes: $"Approved by {userName} via Vaxora AI Agent"
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send supplier email for PO {PoNumber}", poNumber);
        }

        return new
        {
            success = true,
            message = emailSent
                ? $"Purchase Order {poNumber} executed + email sent to {supplierEmail}"
                : $"Purchase Order {poNumber} executed. {createdBatches.Count} batch(es) added. (Email delivery failed — check logs.)",
            emailSent = emailSent,
            supplierEmail = supplierEmail,
            batches = createdBatches
        };
    }

    private async Task<object> ExecuteExpiryMemoAsync(
        Guid userId, string userName, string userEmail,
        HospitalProfile hospital, ExecuteDraftDto dto)
    {
        var batchIdStr = dto.Payload.TryGetValue("batch_id", out var b) ? b?.ToString() : null;
        if (!Guid.TryParse(batchIdStr, out var batchId))
            throw new InvalidOperationException("Invalid payload: missing batch_id.");

        var action = dto.Payload.TryGetValue("action", out var a) ? a?.ToString() ?? "dispense_first" : "dispense_first";
        var memoNumber = dto.Payload.TryGetValue("memo_number", out var m) ? m?.ToString() ?? "AI-EXP" : "AI-EXP";

        var batch = await _context.Batches
            .Include(x => x.Vaccine)
            .FirstOrDefaultAsync(x => x.Id == batchId && x.HospitalProfileId == hospital.Id)
            ?? throw new InvalidOperationException("Batch not found.");

        _context.InventoryTransactions.Add(new InventoryTransaction
        {
            BatchId = batch.Id,
            Type = TransactionType.Adjustment,
            Quantity = 0,
            Reason = $"AI Expiry Memo executed — {action}",
            Notes = $"Memo {memoNumber}. Full batch quantity {batch.QuantityAvailable} reserved for priority dispensing.",
            PerformedByUserId = userId,
            PerformedByName = $"{userName} (AI Agent)"
        });

        _context.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserEmail = userEmail,
            Role = "HOSPITAL",
            Action = "AI_EXPIRY_MEMO_EXECUTED",
            Details = $"Executed AI expiry memo {memoNumber} — action '{action}' on {batch.Vaccine.Name} (Lot {batch.BatchNumber}, workflow {dto.WorkflowId})",
            Timestamp = DateTime.UtcNow
        });

        await _context.SaveChangesAsync();

        // ========== SEND EMAIL TO OPS MANAGER ==========
        bool emailSent = false;
        string opsEmail = Environment.GetEnvironmentVariable("OpsManager__Email") ?? "opsmanager@vaxora.local";

        try
        {
            var daysLeft = (batch.ExpiryDate - DateTime.UtcNow).Days;
            var actionsList = new List<(string VaccineName, string BatchNumber, int Quantity, string ExpiryDate, int DaysLeft, string Priority, string Action)>
            {
                (batch.Vaccine.Name, batch.BatchNumber, batch.QuantityAvailable,
                 batch.ExpiryDate.ToString("yyyy-MM-dd"), daysLeft, "high", action)
            };

            emailSent = await _emailService.SendExpiryMemoToOpsManagerAsync(
                toEmail: opsEmail,
                recipientName: "Operations Manager",
                memoNumber: memoNumber,
                hospitalName: hospital.HospitalName,
                actions: actionsList,
                summary: $"Batch {batch.BatchNumber} reserved for {action}."
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send ops manager email for memo {MemoNumber}", memoNumber);
        }

        return new
        {
            success = true,
            message = emailSent
                ? $"Expiry memo {memoNumber} executed + notification sent to {opsEmail}"
                : $"Expiry memo {memoNumber} executed. Batch {batch.BatchNumber} reserved for {action}. (Email delivery failed — check logs.)",
            emailSent = emailSent,
            opsEmail = opsEmail,
            batchId = batch.Id
        };
    }

    public async Task<List<InventoryAgentWorkflowDto>> GetRecentAgentWorkflowsAsync(Guid userId, int limit)
    {
        limit = Math.Clamp(limit, 1, 50);

        // Load then cap in-memory so EF InMemory (used by unit tests) cannot
        // ignore Take/UserId filters the way server-side composition sometimes does.
        var logs = await _context.AuditLogs
            .AsNoTracking()
            .Where(a => a.UserId.HasValue && a.UserId.Value == userId && a.Action.StartsWith("AI_"))
            .ToListAsync();

        return logs
            .OrderByDescending(a => a.Timestamp)
            .Take(limit)
            .Select(l => new InventoryAgentWorkflowDto
            {
                WorkflowId = ExtractWorkflowId(l.Details ?? ""),
                AgentName = l.Action.Contains("PO") || l.Action.Contains("RESTOCK") ? "RestockAgent" : "ExpiryAgent",
                DraftType = l.Action.Contains("PO") ? "purchase_order" : "expiry_memo",
                DocumentNumber = ExtractDocNumber(l.Details ?? ""),
                Summary = l.Details ?? "",
                Status = "executed",
                CreatedAt = l.Timestamp
            })
            .ToList();
    }

    private static string ExtractWorkflowId(string details)
    {
        if (string.IsNullOrEmpty(details)) return "";
        var match = System.Text.RegularExpressions.Regex.Match(details, @"workflow ([a-f0-9-]{36})");
        return match.Success ? match.Groups[1].Value : "";
    }

    private static string ExtractDocNumber(string details)
    {
        if (string.IsNullOrEmpty(details)) return "";
        var match = System.Text.RegularExpressions.Regex.Match(details, @"(AI-[A-Z]+-[0-9-]+)");
        return match.Success ? match.Groups[1].Value : "";
    }
}
