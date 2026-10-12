using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vaxora.Api.Models;

[Table("HospitalFormularies")]
public class HospitalFormulary
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid HospitalProfileId { get; set; }

    [Required]
    public Guid VaccineId { get; set; }

    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;

    /// <summary>Hospital fee per person in LKR for this vaccine (0 = Free / subsidized).</summary>
    [Range(0, 1000000)]
    public decimal Price { get; set; } = 0.00m;

    /// <summary>What the hospital pays the supplier per vial in LKR (0 = not set). Used on purchase orders.</summary>
    [Range(0, 1000000)]
    public decimal SupplierCost { get; set; } = 0.00m;

    /// <summary>Who this hospital buys the vaccine from. Purchase orders and damage reports are emailed here.</summary>
    [MaxLength(200)]
    public string? SupplierName { get; set; }

    [MaxLength(200)]
    public string? SupplierEmail { get; set; }

    // Navigation
    [ForeignKey(nameof(HospitalProfileId))]
    public virtual HospitalProfile HospitalProfile { get; set; } = null!;

    [ForeignKey(nameof(VaccineId))]
    public virtual Vaccine Vaccine { get; set; } = null!;
}