namespace Vaxora.Api.Models;

public enum VaccineCategory
{
    MRNA,
    Routine,
    Seasonal,
    Pediatric
}

public enum TransactionType
{
    Restock,
    Wastage,
    Adjustment,
    Issue,
    Order
}

public enum WastageReason
{
    VialBreakage,
    ColdChainExcursion,
    ExpiredUnopened,
    OpenVialExpiration,
    ReconstitutionError,
    Contamination
}

public enum BatchStatus
{
    Active,
    Expired,
    Depleted,
    /// <summary>Ordered from the supplier but not delivered yet. Holds no usable stock.</summary>
    Ordered
}