using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/patient-vaccinations")]
[Authorize(Roles = "DOCTOR,NURSE,HOSPITAL,ADMIN,PATIENT")]
public class PatientVaccinationController : ControllerBase
{
    private readonly IPatientVaccinationService _service;
    private readonly IClinicalScopeService _scope;
    private readonly ILogger<PatientVaccinationController> _logger;

    public PatientVaccinationController(IPatientVaccinationService service, IClinicalScopeService scope, ILogger<PatientVaccinationController> logger)
    {
        _service = service;
        _scope = scope;
        _logger = logger;
    }

    [HttpGet("patients/{patientProfileId:guid}/timeline")]
    public async Task<IActionResult> GetTimeline(Guid patientProfileId)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        var role = User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;
        if (string.Equals(role, "PATIENT", StringComparison.OrdinalIgnoreCase))
        {
            var owns = await _service.IsOwnedByUserAsync(patientProfileId, currentUserId);
            if (!owns) return Forbid();
        }
        else if (!await _scope.CanAccessPatientAsync(currentUserId, role, patientProfileId))
        {
            return Forbid();
        }

        try
        {
            var result = await _service.GetTimelineAsync(patientProfileId);
            return Ok(result);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching vaccination timeline for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to fetch vaccination timeline." });
        }
    }

    [HttpGet("{id:guid}")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL,ADMIN")]
    public async Task<IActionResult> GetById(Guid id)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _service.GetByIdAsync(id);
            if (!await _scope.CanAccessPatientAsync(currentUserId, CurrentRole, result.PatientProfileId)) return Forbid();
            return Ok(result);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching vaccination record {Id}", id);
            return StatusCode(500, new { message = "Failed to fetch vaccination record." });
        }
    }

    [HttpPost("patients/{patientProfileId:guid}")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL")]
    public async Task<IActionResult> Create(Guid patientProfileId, [FromBody] CreatePatientVaccinationDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        var hospitalIds = await _scope.GetHospitalProfileIdsAsync(actorUserId, CurrentRole);
        if (hospitalIds != null && hospitalIds.Count == 0) return Forbid();

        try
        {
            var result = await _service.CreateAsync(actorUserId, patientProfileId, dto);
            return Ok(result);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (UnauthorizedAccessException) { return Forbid(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error recording vaccination for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to record vaccination." });
        }
    }

    private string CurrentRole => User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;

    private bool TryGetUserId(out Guid userId)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(claim, out userId);
    }
}