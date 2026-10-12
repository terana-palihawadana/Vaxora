using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "HOSPITAL,ADMIN,NURSE,DOCTOR")]
public class InventoryController : ControllerBase
{
    private readonly IInventoryService _inventoryService;
    private readonly ILogger<InventoryController> _logger;

    public InventoryController(IInventoryService inventoryService, ILogger<InventoryController> logger)
    {
        _inventoryService = inventoryService;
        _logger = logger;
    }

    private Guid GetUserId()
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (string.IsNullOrEmpty(claim) || !Guid.TryParse(claim, out var id))
            throw new UnauthorizedAccessException("Invalid user token.");
        return id;
    }

    // ==================== VACCINES ====================

    [HttpGet("vaccines")]
    [AllowAnonymous]
    public async Task<IActionResult> GetVaccines()
    {
        try
        {
            var result = await _inventoryService.GetGlobalVaccinesAsync();
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching vaccines");
            return StatusCode(500, new { message = "Failed to fetch vaccines." });
        }
    }

    [HttpGet("vaccines-with-hospitals")]
    [AllowAnonymous]
    public async Task<IActionResult> GetVaccinesWithHospitals()
    {
        try
        {
            var result = await _inventoryService.GetVaccinesWithHospitalsAsync();
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching vaccines with hospitals");
            return StatusCode(500, new { message = "Failed to fetch vaccine hospital availability." });
        }
    }

    // ==================== FORMULARY ====================

    [HttpGet("formulary")]
    public async Task<IActionResult> GetFormulary()
    {
        try
        {
            var result = await _inventoryService.GetFormularyAsync(GetUserId());
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching formulary");
            return StatusCode(500, new { message = "Failed to fetch formulary." });
        }
    }

    [HttpPost("formulary")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> RegisterFormulary([FromBody] RegisterFormularyDto dto)
    {
        try
        {
            var result = await _inventoryService.RegisterFormularyAsync(GetUserId(), dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error registering formulary");
            return StatusCode(500, new { message = "Failed to register vaccine." });
        }
    }

    [HttpPatch("formulary/{id:guid}/price")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> UpdateFormularyPrice(Guid id, [FromBody] UpdateFormularyPriceDto dto)
    {
        try
        {
            var result = await _inventoryService.UpdateFormularyPriceAsync(GetUserId(), id, dto);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating formulary price {FormularyId}", id);
            return StatusCode(500, new { message = "Failed to update vaccine fee." });
        }
    }

    [HttpDelete("formulary/{id}")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> RemoveFormulary(Guid id)
    {
        try
        {
            await _inventoryService.RemoveFormularyAsync(GetUserId(), id);
            return Ok(new { message = "Vaccine removed from formulary." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error removing formulary");
            return StatusCode(500, new { message = "Failed to remove vaccine." });
        }
    }

    // ==================== BATCHES / INVENTORY ====================

    [HttpGet("batches")]
    public async Task<IActionResult> GetInventory([FromQuery] Guid? hospitalUserId = null)
    {
        try
        {
            var result = await _inventoryService.GetInventoryAsync(GetUserId(), hospitalUserId);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching inventory");
            return StatusCode(500, new { message = "Failed to fetch inventory." });
        }
    }

    [HttpGet("batches/expiring")]
    public async Task<IActionResult> GetExpiringBatches([FromQuery] int daysThreshold = 60)
    {
        try
        {
            var result = await _inventoryService.GetExpiringBatchesAsync(GetUserId(), daysThreshold);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching expiring batches");
            return StatusCode(500, new { message = "Failed to fetch expiring batches." });
        }
    }

    [HttpPost("batches")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> Restock([FromBody] RestockBatchDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        try
        {
            var result = await _inventoryService.RestockBatchAsync(GetUserId(), dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error restocking");
            return StatusCode(500, new { message = "Failed to restock." });
        }
    }

    [HttpPost("batches/{id}/wastage")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> LogWastage(Guid id, [FromBody] WastageDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        try
        {
            var result = await _inventoryService.LogWastageAsync(GetUserId(), id, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error logging wastage");
            return StatusCode(500, new { message = "Failed to log wastage." });
        }
    }

    [HttpPut("batches/{id}/adjust")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> AdjustStock(Guid id, [FromBody] AdjustStockDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        try
        {
            var result = await _inventoryService.AdjustStockAsync(GetUserId(), id, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error adjusting stock");
            return StatusCode(500, new { message = "Failed to adjust stock." });
        }
    }

    [HttpPost("batches/{id}/receive")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> ReceiveOrderedBatch(Guid id, [FromBody] ReceiveBatchDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        try
        {
            var result = await _inventoryService.ReceiveOrderedBatchAsync(GetUserId(), id, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error receiving ordered batch");
            return StatusCode(500, new { message = "Failed to receive the delivery." });
        }
    }

    [HttpPost("batches/{id}/issue")]
    public async Task<IActionResult> IssueStock(Guid id, [FromBody] IssueStockDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        try
        {
            var result = await _inventoryService.IssueStockAsync(GetUserId(), id, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error issuing stock");
            return StatusCode(500, new { message = "Failed to issue stock." });
        }
    }

    [HttpGet("batches/{id}/audit")]
    public async Task<IActionResult> GetBatchAudit(Guid id)
    {
        try
        {
            var result = await _inventoryService.GetBatchAuditAsync(GetUserId(), id);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching audit");
            return StatusCode(500, new { message = "Failed to fetch audit." });
        }
    }

    // ==================== COLD VAULTS ====================

    [HttpGet("vaults")]
    public async Task<IActionResult> GetVaults()
    {
        try
        {
            var result = await _inventoryService.GetColdVaultsAsync(GetUserId());
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching vaults");
            return StatusCode(500, new { message = "Failed to fetch vaults." });
        }
    }

    // ==================== SUMMARY ====================

    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary()
    {
        try
        {
            var result = await _inventoryService.GetSummaryAsync(GetUserId());
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching summary");
            return StatusCode(500, new { message = "Failed to fetch summary." });
        }
    }

    // ==================== AGENT DRAFT EXECUTION (ADDED) ====================

    [HttpPost("agent/execute-draft")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> ExecuteAgentDraft([FromBody] ExecuteDraftDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        try
        {
            var result = await _inventoryService.ExecuteAgentDraftAsync(GetUserId(), dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing agent draft");
            return StatusCode(500, new { message = "Failed to execute agent draft." });
        }
    }

    [HttpGet("agent/workflows")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    public async Task<IActionResult> GetAgentWorkflows([FromQuery] int limit = 20)
    {
        try
        {
            var result = await _inventoryService.GetRecentAgentWorkflowsAsync(GetUserId(), limit);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching agent workflows");
            return StatusCode(500, new { message = "Failed to fetch workflows." });
        }
    }

        [HttpPost("damage-report")]
    [Authorize(Roles = "HOSPITAL,ADMIN")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> ReportDamage([FromForm] ReportDamageForm form)
    {
        try
        {
            if (form.Photo == null || form.Photo.Length == 0)
                return BadRequest(new { message = "Photo is required." });

            byte[] photoBytes;
            using (var ms = new MemoryStream())
            {
                await form.Photo.CopyToAsync(ms);
                photoBytes = ms.ToArray();
            }

            var dto = new ReportDamageDto
            {
                BatchId = form.BatchId ?? string.Empty,
                VaccineName = form.VaccineName ?? string.Empty,
                LotNumber = form.LotNumber ?? string.Empty,
                Quantity = form.Quantity,
                DamageType = form.DamageType ?? string.Empty,
                Notes = form.Notes ?? string.Empty,
                PhotoBytes = photoBytes,
                PhotoFileName = form.Photo.FileName,
                PhotoContentType = string.IsNullOrWhiteSpace(form.Photo.ContentType)
                    ? "image/jpeg"
                    : form.Photo.ContentType
            };

            var result = await _inventoryService.ReportDamageAsync(GetUserId(), dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error submitting damage report");
            return StatusCode(500, new { message = "Failed to submit damage report." });
        }
    }
}