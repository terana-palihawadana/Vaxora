using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/patient-visits")]
[Authorize(Roles = "DOCTOR,NURSE,HOSPITAL,ADMIN,PATIENT")]
public class PatientVisitController : ControllerBase
{
    private readonly IPatientVisitService _service;
    private readonly IClinicalScopeService _scope;
    private readonly ILogger<PatientVisitController> _logger;

    public PatientVisitController(IPatientVisitService service, IClinicalScopeService scope, ILogger<PatientVisitController> logger)
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

        try { return Ok(await _service.GetTimelineAsync(patientProfileId)); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching visit timeline for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to fetch visit timeline." });
        }
    }

    [HttpGet("patients/{patientProfileId:guid}/follow-ups")]
    public async Task<IActionResult> GetUpcomingFollowUps(Guid patientProfileId)
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

        try { return Ok(await _service.GetUpcomingFollowUpsAsync(patientProfileId)); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching follow-ups for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to fetch follow-ups." });
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
            var visit = await _service.GetByIdAsync(id);
            if (!await _scope.CanAccessPatientAsync(currentUserId, CurrentRole, visit.PatientProfileId)) return Forbid();
            return Ok(visit);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching visit {Id}", id);
            return StatusCode(500, new { message = "Failed to fetch visit." });
        }
    }

    [HttpGet("{id:guid}/summary")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL,ADMIN")]
    public async Task<IActionResult> GetSummary(Guid id)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var visit = await _service.GetByIdAsync(id);
            if (!await _scope.CanAccessPatientAsync(currentUserId, CurrentRole, visit.PatientProfileId)) return Forbid();
            return Ok(await _service.GetSummaryAsync(id));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching visit summary {Id}", id);
            return StatusCode(500, new { message = "Failed to fetch visit summary." });
        }
    }

    [HttpPost("patients/{patientProfileId:guid}")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL")]
    public async Task<IActionResult> Create(Guid patientProfileId, [FromBody] CreatePatientVisitDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        var hospitalIds = await _scope.GetHospitalProfileIdsAsync(actorUserId, CurrentRole);
        if (hospitalIds != null)
        {
            if (hospitalIds.Count == 0) return Forbid();
            if (dto.HospitalProfileId.HasValue && !hospitalIds.Contains(dto.HospitalProfileId.Value))
                return Forbid();
            if (!dto.HospitalProfileId.HasValue && hospitalIds.Count == 1)
                dto.HospitalProfileId = hospitalIds[0];
        }

        try { return Ok(await _service.CreateAsync(actorUserId, patientProfileId, dto)); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating visit for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to create visit." });
        }
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdatePatientVisitDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var existing = await _service.GetByIdAsync(id);
            if (!await _scope.CanAccessPatientAsync(actorUserId, CurrentRole, existing.PatientProfileId)) return Forbid();
            return Ok(await _service.UpdateAsync(actorUserId, id, dto));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating visit {Id}", id);
            return StatusCode(500, new { message = "Failed to update visit." });
        }
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "DOCTOR,ADMIN")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var existing = await _service.GetByIdAsync(id);
            if (!await _scope.CanAccessPatientAsync(actorUserId, CurrentRole, existing.PatientProfileId)) return Forbid();
            await _service.DeleteAsync(actorUserId, id);
            return Ok(new { message = "Visit deleted." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting visit {Id}", id);
            return StatusCode(500, new { message = "Failed to delete visit." });
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
