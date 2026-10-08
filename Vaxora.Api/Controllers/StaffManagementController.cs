using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/staff")]
[Authorize]
public class StaffManagementController : ControllerBase
{
    private readonly IStaffManagementService _staffService;
    private readonly ILogger<StaffManagementController> _logger;

    public StaffManagementController(IStaffManagementService staffService, ILogger<StaffManagementController> logger)
    {
        _staffService = staffService;
        _logger = logger;
    }

    [HttpPost("invite")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> InviteStaff([FromBody] InviteStaffDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.InviteStaffAsync(hospitalUserId, dto);
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
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error inviting staff");
            return StatusCode(500, new { message = "Failed to invite staff." });
        }
    }

    [HttpGet("candidates")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> SearchCandidates([FromQuery] string? q, [FromQuery] int limit = 10)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.SearchInviteCandidatesAsync(hospitalUserId, q ?? string.Empty, limit);
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
            _logger.LogError(ex, "Error searching staff candidates");
            return StatusCode(500, new { message = "Failed to search staff candidates." });
        }
    }

    [HttpPost("invitations/{affiliationId:guid}/respond")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> RespondToInvitation(Guid affiliationId, [FromBody] AffiliationDecisionDto dto)
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.RespondToInvitationAsync(staffUserId, affiliationId, dto);
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
            _logger.LogError(ex, "Error responding to invitation {AffiliationId}", affiliationId);
            return StatusCode(500, new { message = "Failed to respond to invitation." });
        }
    }

    [HttpGet("hospital")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetHospitalStaff(
        [FromQuery] string? role,
        [FromQuery] string? dutyStatus,
        [FromQuery] string? search,
        [FromQuery] string? status)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetHospitalStaffAsync(hospitalUserId, role, dutyStatus, search, status);
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
            _logger.LogError(ex, "Error listing hospital staff");
            return StatusCode(500, new { message = "Failed to fetch hospital staff." });
        }
    }

    [HttpGet("invitations")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> GetMyInvitations()
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetMyInvitationsAsync(staffUserId);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching invitations");
            return StatusCode(500, new { message = "Failed to fetch invitations." });
        }
    }

    [HttpGet("my-affiliations")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> GetMyAffiliations()
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetMyAffiliationsAsync(staffUserId);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching affiliations");
            return StatusCode(500, new { message = "Failed to fetch affiliations." });
        }
    }

    [HttpDelete("affiliations/{affiliationId:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> RemoveAffiliation(Guid affiliationId)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var freedShiftCount = await _staffService.RemoveAffiliationAsync(hospitalUserId, affiliationId);
            return Ok(new { message = "Staff affiliation removed.", freedShiftCount });
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
            _logger.LogError(ex, "Error removing affiliation {AffiliationId}", affiliationId);
            return StatusCode(500, new { message = "Failed to remove affiliation." });
        }
    }

    [HttpPut("affiliations/{affiliationId:guid}/duty")]
    [Authorize(Roles = "HOSPITAL,DOCTOR,NURSE")]
    public async Task<IActionResult> UpdateDutyStatus(Guid affiliationId, [FromBody] UpdateDutyStatusDto dto)
    {
        if (!TryGetUserId(out var actorUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.UpdateDutyStatusAsync(actorUserId, affiliationId, dto);
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
            _logger.LogError(ex, "Error updating duty status for {AffiliationId}", affiliationId);
            return StatusCode(500, new { message = "Failed to update duty status." });
        }
    }

    [HttpPost("shifts")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> CreateShift([FromBody] CreateStaffShiftDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.CreateShiftAsync(hospitalUserId, dto);
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
            _logger.LogError(ex, "Error creating shift");
            return StatusCode(500, new { message = "Failed to create shift." });
        }
    }

    [HttpGet("shifts/hospital")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetHospitalShifts([FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetHospitalShiftsAsync(hospitalUserId, from, to);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching hospital shifts");
            return StatusCode(500, new { message = "Failed to fetch shifts." });
        }
    }

    /// <summary>
    /// Busy times for this hospital's active staff across every affiliation (any hospital).
    /// </summary>
    [HttpGet("shifts/busy")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetAffiliatedStaffBusyBlocks([FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetAffiliatedStaffBusyBlocksAsync(hospitalUserId, from, to);
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
            _logger.LogError(ex, "Error fetching affiliated staff busy blocks");
            return StatusCode(500, new { message = "Failed to fetch staff busy blocks." });
        }
    }

    [HttpGet("coverage")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetCoverage([FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetCoverageReportAsync(hospitalUserId, from, to);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching staff coverage");
            return StatusCode(500, new { message = "Failed to fetch coverage report." });
        }
    }

    /// <summary>
    /// Rules-based shift suggestions for low-coverage days. Does not create shifts —
    /// hospital must approve each proposal (human-in-the-loop).
    /// </summary>
    [HttpPost("shifts/suggest-week")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> SuggestWeekCoverage([FromBody] SuggestWeekCoverageDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.SuggestWeekCoverageAsync(hospitalUserId, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error suggesting week coverage");
            return StatusCode(500, new { message = "Failed to suggest week coverage." });
        }
    }

    [HttpGet("shifts/mine")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> GetMyShifts([FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        if (!TryGetUserId(out var staffUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetMyShiftsAsync(staffUserId, from, to);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching my shifts");
            return StatusCode(500, new { message = "Failed to fetch shifts." });
        }
    }

    [HttpPut("shifts/{shiftId:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> UpdateShift(Guid shiftId, [FromBody] UpdateStaffShiftDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.UpdateShiftAsync(hospitalUserId, shiftId, dto);
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
            _logger.LogError(ex, "Error updating shift {ShiftId}", shiftId);
            return StatusCode(500, new { message = "Failed to update shift." });
        }
    }

    [HttpDelete("shifts/{shiftId:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> DeleteShift(Guid shiftId)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            await _staffService.DeleteShiftAsync(hospitalUserId, shiftId);
            return Ok(new { message = "Shift deleted." });
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
            _logger.LogError(ex, "Error deleting shift {ShiftId}", shiftId);
            return StatusCode(500, new { message = "Failed to delete shift." });
        }
    }

    [HttpGet("booths")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> GetHospitalBooths([FromQuery] bool activeOnly = false)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.GetHospitalBoothsAsync(hospitalUserId, activeOnly);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching hospital booths");
            return StatusCode(500, new { message = "Failed to fetch booths." });
        }
    }

    [HttpPost("booths")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> CreateHospitalBooth([FromBody] CreateHospitalBoothDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.CreateHospitalBoothAsync(hospitalUserId, dto);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating hospital booth");
            return StatusCode(500, new { message = "Failed to create booth." });
        }
    }

    [HttpPut("booths/{boothId:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> UpdateHospitalBooth(Guid boothId, [FromBody] UpdateHospitalBoothDto dto)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            var result = await _staffService.UpdateHospitalBoothAsync(hospitalUserId, boothId, dto);
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
            _logger.LogError(ex, "Error updating hospital booth {BoothId}", boothId);
            return StatusCode(500, new { message = "Failed to update booth." });
        }
    }

    [HttpDelete("booths/{boothId:guid}")]
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> DeactivateHospitalBooth(Guid boothId)
    {
        if (!TryGetUserId(out var hospitalUserId))
            return Unauthorized(new { message = "Invalid identity claim." });

        try
        {
            await _staffService.DeactivateHospitalBoothAsync(hospitalUserId, boothId);
            return Ok(new { message = "Booth deactivated." });
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
            _logger.LogError(ex, "Error deactivating hospital booth {BoothId}", boothId);
            return StatusCode(500, new { message = "Failed to deactivate booth." });
        }
    }

    private bool TryGetUserId(out Guid userId)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(claim, out userId);
    }
}
