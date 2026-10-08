using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/clinical")]
[Authorize(Roles = "DOCTOR,NURSE")]
public class ClinicalPatientController : ControllerBase
{
    private readonly IClinicalPatientService _service;
    private readonly ILogger<ClinicalPatientController> _logger;

    public ClinicalPatientController(IClinicalPatientService service, ILogger<ClinicalPatientController> logger)
    {
        _service = service;
        _logger = logger;
    }

    [HttpGet("patients/search")]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] int limit = 10)
    {
        if (!TryGetUserId(out var viewerUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _service.SearchPatientsAsync(
                q ?? string.Empty,
                viewerUserId,
                limit);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error searching clinical patients");
            return StatusCode(500, new { message = "Failed to search patients." });
        }
    }

    [HttpGet("patients/recent")]
    public async Task<IActionResult> GetRecent([FromQuery] int limit = 10)
    {
        if (!TryGetUserId(out var viewerUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _service.GetRecentDosageUpdatesAsync(viewerUserId, limit);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching recent dosage updates");
            return StatusCode(500, new { message = "Failed to fetch recent updates." });
        }
    }

    [HttpGet("patients/{vaxoraId}")]
    public async Task<IActionResult> GetByVaxoraId(string vaxoraId)
    {
        if (!TryGetUserId(out var viewerUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _service.GetPatientByVaxoraIdAsync(
                vaxoraId,
                viewerUserId);
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
            _logger.LogError(ex, "Error fetching clinical patient {VaxoraId}", vaxoraId);
            return StatusCode(500, new { message = "Failed to fetch patient." });
        }
    }

    [HttpPut("appointments/{appointmentId:guid}/dosage")]
    [Authorize(Roles = "DOCTOR")]
    public async Task<IActionResult> UpdateDosage(Guid appointmentId, [FromBody] UpdatePrescribedDosageDto dto)
    {
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        if (!TryGetUserId(out var doctorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _service.UpdatePrescribedDosageAsync(doctorUserId, appointmentId, dto);
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
            _logger.LogError(ex, "Error updating dosage for appointment {AppointmentId}", appointmentId);
            return StatusCode(500, new { message = "Failed to update dosage." });
        }
    }

    private bool TryGetUserId(out Guid userId)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(claim, out userId);
    }
}
