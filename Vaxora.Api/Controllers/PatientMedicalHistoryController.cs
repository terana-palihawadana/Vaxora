using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/patient-medical-history")]
[Authorize(Roles = "DOCTOR,NURSE,HOSPITAL,ADMIN,PATIENT")]
public class PatientMedicalHistoryController : ControllerBase
{
    private readonly IPatientMedicalHistoryService _service;
    private readonly ILogger<PatientMedicalHistoryController> _logger;

    public PatientMedicalHistoryController(IPatientMedicalHistoryService service, ILogger<PatientMedicalHistoryController> logger)
    {
        _service = service;
        _logger = logger;
    }

    [HttpGet("patients/{patientProfileId:guid}/timeline")]
    public async Task<IActionResult> GetTimeline(Guid patientProfileId)
    {
        var accessResult = await CheckPatientProfileAccessAsync(patientProfileId);
        if (accessResult != null) return accessResult;

        try { return Ok(await _service.GetTimelineAsync(patientProfileId)); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching medical timeline for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to fetch medical timeline." });
        }
    }

    [HttpGet("patients/{patientProfileId:guid}/active")]
    public async Task<IActionResult> GetActiveConditions(Guid patientProfileId)
    {
        var accessResult = await CheckPatientProfileAccessAsync(patientProfileId);
        if (accessResult != null) return accessResult;

        try { return Ok(await _service.GetActiveConditionsAsync(patientProfileId)); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching active conditions for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to fetch active conditions." });
        }
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        if (User.IsInRole("PATIENT"))
        {
            if (!TryGetUserId(out var userId))
                return Unauthorized(new { message = "Invalid identity claim." });
            if (!await _service.IsRecordOwnedByUserAsync(id, userId))
                return Forbid();
        }

        try { return Ok(await _service.GetByIdAsync(id)); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching medical record {Id}", id);
            return StatusCode(500, new { message = "Failed to fetch medical record." });
        }
    }

    [HttpPost("patients/{patientProfileId:guid}")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL")]
    public async Task<IActionResult> Create(Guid patientProfileId, [FromBody] CreatePatientMedicalHistoryDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try { return Ok(await _service.CreateAsync(actorUserId, patientProfileId, dto)); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating medical record for patient {PatientId}", patientProfileId);
            return StatusCode(500, new { message = "Failed to create medical record." });
        }
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "DOCTOR,NURSE,HOSPITAL")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdatePatientMedicalHistoryDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try { return Ok(await _service.UpdateAsync(actorUserId, id, dto)); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating medical record {Id}", id);
            return StatusCode(500, new { message = "Failed to update medical record." });
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
            await _service.DeleteAsync(actorUserId, id);
            return Ok(new { message = "Medical record deleted." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting medical record {Id}", id);
            return StatusCode(500, new { message = "Failed to delete medical record." });
        }
    }

    private bool TryGetUserId(out Guid userId)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(claim, out userId);
    }

    private async Task<IActionResult?> CheckPatientProfileAccessAsync(Guid patientProfileId)
    {
        if (!User.IsInRole("PATIENT"))
            return null;

        if (!TryGetUserId(out var userId))
            return Unauthorized(new { message = "Invalid identity claim." });

        return await _service.IsOwnedByUserAsync(patientProfileId, userId)
            ? null
            : Forbid();
    }
}
