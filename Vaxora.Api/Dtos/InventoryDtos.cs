using System.ComponentModel.DataAnnotations;

namespace Vaxora.Api.Dtos;

// ==================== RESPONSE DTOs ====================

public class VaccineDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public int DosesPerVial { get; set; }
    public string RequiredTemp { get; set; } = string.Empty;
    public int DefaultMinThreshold { get; set; }
}

public class HospitalSummaryDto
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid HospitalProfileId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string? District { get; set; }
    public string? Type { get; set; }
    public string? ContactNumber { get; set; }
}

public class VaccineWithHospitalsDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public int DosesPerVial { get; set; }
    public string RequiredTemp { get; set; } = string.Empty;
    public List<HospitalSummaryDto> Hospitals { get; set; } = new();
}

public class FormularyEntryDto
{
    public Guid Id { get; set; }
    public Guid VaccineId { get; set; }
    public string VaccineName { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string Category { get; set; } = "routine";
    public decimal Price { get; set; }
    public bool IsFree => Price <= 0;
    public string FormattedPrice => Price <= 0 ? "Free" : $"LKR {Price:N2}";
    public DateTime RegisteredAt { get; set; }
}

public class InventoryItemDto
{
    public Guid Id { get; set; }                 // Batch Id
    public Guid VaccineId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string LotNumber { get; set; } = string.Empty;
    public int Available { get; set; }
    public int Capacity { get; set; }
    public int MinThreshold { get; set; }
    public int DosesPerVial { get; set; }
    /// <summary>Doses left in the currently opened vial (0 if sealed-only stock).</summary>
    public int OpenVialDosesRemaining { get; set; }
    /// <summary>Total administerable doses = sealed vials × doses/vial + open vial remainder.</summary>
    public int AvailableDoses { get; set; }
    public string Expiry { get; set; } = string.Empty;
    public string ExpiryStatus { get; set; } = string.Empty;
    public string Temp { get; set; } = string.Empty;
    public string StorageUnit { get; set; } = string.Empty;
    public string StatusColor { get; set; } = string.Empty;
    public string LastRestocked { get; set; } = string.Empty;
}

public class ColdVaultDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Temp { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Humidity { get; set; } = string.Empty;
    public string SensorStatus { get; set; } = string.Empty;
    public int AssignedLots { get; set; }
}

public class AuditEntryDto
{
    public Guid Id { get; set; }
    public string Timestamp { get; set; } = string.Empty;
    public string Event { get; set; } = string.Empty;
    public string Actor { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
}

public class BatchAuditDto
{
    public InventoryItemDto Vaccine { get; set; } = null!;
    public List<AuditEntryDto> Entries { get; set; } = new();
}

public class InventorySummaryDto
{
    public int TotalVials { get; set; }
    public int TotalDoses { get; set; }
    public int LowStockCount { get; set; }
    public int ExpiringCount { get; set; }
    public int TotalFormulations { get; set; }
    public string ColdStorageHealth { get; set; } = "100%";
    public int VaultsOnline { get; set; }
}

// ==================== REQUEST DTOs ====================

public class RegisterFormularyDto
{
    [Required]
    [MaxLength(200)]
    public string VaccineName { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Manufacturer { get; set; }

    /// <summary>Catalog category: routine | mrna | seasonal | pediatric. Defaults to routine.</summary>
    [MaxLength(40)]
    public string? Category { get; set; }

    /// <summary>Hospital fee per person in LKR (0 = Free).</summary>
    [Range(0, 1000000)]
    public decimal Price { get; set; } = 0.00m;
}

public class UpdateFormularyPriceDto
{
    [Range(0, 1000000)]
    public decimal Price { get; set; }

    /// <summary>Optional catalog category update: routine | mrna | seasonal | pediatric.</summary>
    [MaxLength(40)]
    public string? Category { get; set; }
}

public class RestockBatchDto
{
    [Required]
    [MaxLength(200)]
    public string VaccineName { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string LotNumber { get; set; } = string.Empty;

    [Required]
    [Range(1, int.MaxValue)]
    public int Quantity { get; set; }

    [MaxLength(200)]
    public string? StorageUnit { get; set; }

    public DateTime? ExpiryDate { get; set; }

    [MaxLength(200)]
    public string? Supplier { get; set; }

    /// <summary>Used when creating a brand-new vaccine from restock. Defaults to routine.</summary>
    [MaxLength(40)]
    public string? Category { get; set; }
}

public class WastageDto
{
    [Required]
    [Range(1, int.MaxValue)]
    public int Quantity { get; set; }

    [Required]
    public string Reason { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? ReportedBy { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTime? IncidentDate { get; set; }
}

public class AdjustStockDto
{
    [Required]
    public int Delta { get; set; }   // can be positive or negative

    [MaxLength(500)]
    public string? Reason { get; set; }
}

public class IssueStockDto
{
    [Required]
    [Range(1, int.MaxValue)]
    public int Quantity { get; set; }

    [MaxLength(500)]
    public string? SessionReference { get; set; }
}