using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ScheduleController : ControllerBase
{
    private readonly IScheduleService _scheduleService;
    private readonly ILogger<ScheduleController> _logger;

    public ScheduleController(IScheduleService scheduleService, ILogger<ScheduleController> logger)
    {
        _scheduleService = scheduleService;
        _logger = logger;
    }

    [HttpPost]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> CreateSchedule([FromBody] CreateVaccineScheduleDto dto)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var hospitalUserId))
        {
            return Unauthorized(new { message = "Invalid authentication claims." });
        }

        try
        {
            var result = await _scheduleService.CreateScheduleAsync(hospitalUserId, dto);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating schedule for hospital {HospitalUserId}", hospitalUserId);
            return StatusCode(500, new { message = "An error occurred while creating the schedule slot." });
        }
    }

    [HttpGet("hospital")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetHospitalSchedules()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var hospitalUserId))
        {
            return Unauthorized(new { message = "Invalid authentication claims." });
        }

        try
        {
            var schedules = await _scheduleService.GetHospitalSchedulesAsync(hospitalUserId);
            return Ok(schedules);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching schedules for hospital {HospitalUserId}", hospitalUserId);
            return StatusCode(500, new { message = "Failed to load hospital schedules." });
        }
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> CancelSchedule(Guid id)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var hospitalUserId))
        {
            return Unauthorized(new { message = "Invalid authentication claims." });
        }

        try
        {
            await _scheduleService.CancelScheduleAsync(hospitalUserId, id);
            return Ok(new { message = "Schedule slot cancelled successfully." });
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
            _logger.LogError(ex, "Error cancelling schedule {ScheduleId}", id);
            return StatusCode(500, new { message = "Failed to cancel schedule slot." });
        }
    }

    [HttpGet("available")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAvailableSchedules([FromQuery] Guid? hospitalUserId, [FromQuery] string? vaccineName)
    {
        try
        {
            var schedules = await _scheduleService.GetAvailableSchedulesAsync(hospitalUserId, vaccineName);
            return Ok(schedules);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching available schedules for booking");
            return StatusCode(500, new { message = "Failed to fetch available schedule slots." });
        }
    }

    /// <summary>
    /// Preview how long current usable stock can cover a proposed clinic window (soft planning; no vial deduct).
    /// </summary>
    [HttpPost("stock-horizon")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetStockHorizon([FromBody] ScheduleStockHorizonRequestDto dto)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var hospitalUserId))
        {
            return Unauthorized(new { message = "Invalid authentication claims." });
        }

        try
        {
            var result = await _scheduleService.GetStockHorizonAsync(hospitalUserId, dto);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error computing stock horizon for hospital {HospitalUserId}", hospitalUserId);
            return StatusCode(500, new { message = "Failed to estimate stock coverage for this schedule." });
        }
    }
}
