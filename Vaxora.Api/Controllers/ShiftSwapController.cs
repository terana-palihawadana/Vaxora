using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/staff/shift-swaps")]
[Authorize]
public class ShiftSwapController : ControllerBase
{
    private readonly IShiftSwapService _swapService;
    private readonly ILogger<ShiftSwapController> _logger;

    public ShiftSwapController(IShiftSwapService swapService, ILogger<ShiftSwapController> logger)
    {
        _swapService = swapService;
        _logger = logger;
    }

    [HttpPost]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> Create([FromBody] CreateShiftSwapRequestDto dto)
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _swapService.CreateAsync(staffUserId, dto);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating shift-swap request");
            return StatusCode(500, new { message = "Failed to log cover request." });
        }
    }

    [HttpGet("quota")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> GetQuota([FromQuery] Guid? shiftId)
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _swapService.GetQuotaAsync(staffUserId, shiftId);
            return Ok(result);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading cover quota");
            return StatusCode(500, new { message = "Failed to load cover quota." });
        }
    }

    [HttpGet("mine")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> ListForStaff([FromQuery] int limit = 40)
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _swapService.ListForStaffAsync(staffUserId, limit);
            return Ok(result);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error listing staff cover requests");
            return StatusCode(500, new { message = "Failed to load cover requests." });
        }
    }

    [HttpGet("hospital")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> ListForHospital([FromQuery] string? status, [FromQuery] int limit = 40)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _swapService.ListForHospitalAsync(hospitalUserId, status, limit);
            return Ok(result);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error listing hospital cover requests");
            return StatusCode(500, new { message = "Failed to load cover requests." });
        }
    }

    [HttpPost("{requestId:guid}/rank")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> RankWithAi(Guid requestId)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _swapService.RankWithAgentAsync(hospitalUserId, requestId, ExtractBearerToken());
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error ranking cover request {RequestId}", requestId);
            return StatusCode(500, new { message = "Failed to rank replacements." });
        }
    }

    [HttpPost("{requestId:guid}/decision")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> Decide(Guid requestId, [FromBody] ShiftSwapDecisionDto decision)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _swapService.DecideAsync(hospitalUserId, requestId, decision);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deciding cover request {RequestId}", requestId);
            return StatusCode(500, new { message = "Failed to record decision." });
        }
    }

    private bool TryGetUserId(out Guid userId)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(claim, out userId);
    }

    private string? ExtractBearerToken()
    {
        var header = Request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? header["Bearer ".Length..].Trim()
            : null;
    }
}
