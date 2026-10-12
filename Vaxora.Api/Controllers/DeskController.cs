using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/desk")]
[Authorize]
public class DeskController : ControllerBase
{
    private readonly IDeskAccessService _deskAccess;
    private readonly IInventoryService _inventoryService;
    private readonly ILogger<DeskController> _logger;

    public DeskController(
        IDeskAccessService deskAccess,
        IInventoryService inventoryService,
        ILogger<DeskController> logger)
    {
        _deskAccess = deskAccess;
        _inventoryService = inventoryService;
        _logger = logger;
    }

    [HttpPost("accounts")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> CreateDeskAccount([FromBody] CreateDeskAccountDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _deskAccess.CreateDeskAccountAsync(hospitalUserId, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating front-desk account");
            return StatusCode(500, new { message = "Failed to create front-desk account." });
        }
    }

    [HttpGet("accounts")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetDeskAccounts()
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _deskAccess.GetDeskAccountsAsync(hospitalUserId);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error listing front-desk accounts");
            return StatusCode(500, new { message = "Failed to fetch front-desk accounts." });
        }
    }

    [HttpDelete("accounts/{affiliationId:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> RemoveDeskAccount(Guid affiliationId)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            await _deskAccess.RemoveDeskAccountAsync(hospitalUserId, affiliationId);
            return Ok(new { message = "Front-desk account removed." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error removing front-desk account {AffiliationId}", affiliationId);
            return StatusCode(500, new { message = "Failed to remove front-desk account." });
        }
    }

    /// <summary>The hospital the logged-in front-desk account works for.</summary>
    [HttpGet("me")]
    [Authorize(Roles = "FRONT_DESK")]
    public async Task<IActionResult> GetMyDeskContext()
    {
        if (!TryGetUserId(out var deskUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _deskAccess.GetDeskContextAsync(deskUserId);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading front-desk context");
            return StatusCode(500, new { message = "Failed to load front-desk details." });
        }
    }

    /// <summary>
    /// Vaccines the hospital offers, so the desk can register walk-ins. Read-only: the
    /// inventory endpoints themselves stay closed to front-desk accounts.
    /// </summary>
    [HttpGet("formulary")]
    [Authorize(Roles = "FRONT_DESK")]
    public async Task<IActionResult> GetHospitalFormulary()
    {
        if (!TryGetUserId(out var deskUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var hospitalUserId = await _deskAccess.ResolveHospitalUserIdAsync(deskUserId);
            var result = await _inventoryService.GetFormularyAsync(hospitalUserId);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading formulary for the front desk");
            return StatusCode(500, new { message = "Failed to fetch formulary." });
        }
    }

    private bool TryGetUserId(out Guid userId)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(claim, out userId);
    }
}
