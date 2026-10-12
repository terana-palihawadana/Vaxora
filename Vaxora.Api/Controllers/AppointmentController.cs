using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AppointmentsController : ControllerBase
{
    private readonly IAppointmentService _appointmentService;
    private readonly ILogger<AppointmentsController> _logger;
    private readonly IDeskAccessService? _deskAccess;

    public AppointmentsController(
        IAppointmentService appointmentService,
        ILogger<AppointmentsController> logger,
        IDeskAccessService? deskAccess = null)
    {
        _appointmentService = appointmentService;
        _logger = logger;
        _deskAccess = deskAccess;
    }

    private bool IsFrontDesk => User.IsInRole("FRONT_DESK");

    /// <summary>
    /// Front-desk accounts act for the hospital they are attached to; every other caller
    /// acts as themselves. Returns a 403 result when a desk account has no active hospital.
    /// </summary>
    private async Task<(Guid ActingUserId, IActionResult? Denied)> ResolveActingUserAsync(Guid userId)
    {
        if (!IsFrontDesk)
            return (userId, null);

        try
        {
            if (_deskAccess == null)
                throw new UnauthorizedAccessException("Front-desk access is not available.");
            return (await _deskAccess.ResolveHospitalUserIdAsync(userId), null);
        }
        catch (UnauthorizedAccessException ex)
        {
            return (Guid.Empty, StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message }));
        }
    }

    /// <summary>Keeps a trail of who at the desk acted, since the action itself runs as the hospital.</summary>
    private async Task RecordDeskActionAsync(Guid userId, string action, string details)
    {
        if (!IsFrontDesk || _deskAccess == null) return;

        try
        {
            await _deskAccess.RecordActionAsync(userId, action, details);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not record front-desk action {Action}", action);
        }
    }

    /// <summary>
    /// Fetch available dates for a given hospital & vaccine based on hospital schedules.
    /// </summary>
    [HttpGet("available-dates")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAvailableDates([FromQuery] Guid hospitalUserId, [FromQuery] string vaccineName)
    {
        if (hospitalUserId == Guid.Empty || string.IsNullOrWhiteSpace(vaccineName))
        {
            return BadRequest(new { message = "hospitalUserId and vaccineName are required." });
        }

        try
        {
            var dates = await _appointmentService.GetAvailableDatesAsync(hospitalUserId, vaccineName);
            return Ok(dates);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting available dates for hospital {HospitalId} and vaccine {Vaccine}", hospitalUserId, vaccineName);
            return StatusCode(500, new { message = "Failed to retrieve available dates." });
        }
    }

    /// <summary>
    /// Fetch available 20-minute time slots for a given hospital, vaccine, and date, marking booked slots.
    /// </summary>
    [HttpGet("available-slots")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAvailableSlots([FromQuery] Guid hospitalUserId, [FromQuery] string vaccineName, [FromQuery] string date)
    {
        if (hospitalUserId == Guid.Empty || string.IsNullOrWhiteSpace(vaccineName) || string.IsNullOrWhiteSpace(date))
        {
            return BadRequest(new { message = "hospitalUserId, vaccineName, and date are required." });
        }

        if (!DateOnly.TryParse(date, out var parsedDate))
        {
            return BadRequest(new { message = "Invalid date format. Expected YYYY-MM-DD." });
        }

        try
        {
            var slots = await _appointmentService.GetAvailableTimeSlotsAsync(hospitalUserId, vaccineName, parsedDate);
            return Ok(slots);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting available slots for hospital {HospitalId}, vaccine {Vaccine}, date {Date}", hospitalUserId, vaccineName, date);
            return StatusCode(500, new { message = "Failed to retrieve available time slots." });
        }
    }

    /// <summary>
    /// Book an appointment for the logged-in patient.
    /// </summary>
    [HttpPost]
    [Authorize]
    public async Task<IActionResult> BookAppointment([FromBody] BookAppointmentRequestDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var patientUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        try
        {
            var appointment = await _appointmentService.BookAppointmentAsync(patientUserId, dto);
            return CreatedAtAction(nameof(GetPatientAppointments), new { id = appointment.Id }, appointment);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error booking appointment for patient {PatientId}", patientUserId);
            return StatusCode(500, new { message = "An error occurred while booking the appointment." });
        }
    }

    /// <summary>
    /// Get appointments booked by the logged-in patient.
    /// </summary>
    [HttpGet("patient")]
    [HttpGet("my")]
    [Authorize]
    public async Task<IActionResult> GetPatientAppointments()
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var patientUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        try
        {
            var list = await _appointmentService.GetPatientAppointmentsAsync(patientUserId);
            return Ok(list);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving patient appointments for {PatientId}", patientUserId);
            return StatusCode(500, new { message = "Failed to load appointments." });
        }
    }

    /// <summary>
    /// Get appointments received by the logged-in hospital.
    /// </summary>
    [HttpGet("hospital")]
    [Authorize]
    public async Task<IActionResult> GetHospitalAppointments([FromQuery] string? date = null, [FromQuery] string? status = null)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var callerUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        var (hospitalUserId, denied) = await ResolveActingUserAsync(callerUserId);
        if (denied != null) return denied;

        DateOnly? parsedDate = null;
        if (!string.IsNullOrWhiteSpace(date) && DateOnly.TryParse(date, out var d))
        {
            parsedDate = d;
        }

        try
        {
            var list = await _appointmentService.GetHospitalAppointmentsAsync(hospitalUserId, parsedDate, status);
            return Ok(list);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving hospital appointments for {HospitalId}", hospitalUserId);
            return StatusCode(500, new { message = "Failed to load hospital appointments." });
        }
    }

    /// <summary>
    /// Hospital walk-in: enqueue a patient for today. Links an existing Vaxora account when
    /// NIC matches; otherwise auto-creates a patient account so doses can be recorded.
    /// </summary>
    [HttpPost("hospital/walk-in")]
    [Authorize(Roles = "HOSPITAL,FRONT_DESK")]
    public async Task<IActionResult> CreateWalkInAppointment([FromBody] CreateWalkInAppointmentDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var callerUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        var (hospitalUserId, denied) = await ResolveActingUserAsync(callerUserId);
        if (denied != null) return denied;

        try
        {
            var appointment = await _appointmentService.CreateWalkInAppointmentAsync(hospitalUserId, dto);
            await RecordDeskActionAsync(callerUserId, "DESK_WALK_IN", $"Front desk registered walk-in appointment {appointment.Id}");
            return Ok(appointment);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating walk-in appointment for hospital {HospitalId}", hospitalUserId);
            return StatusCode(500, new { message = "Failed to register walk-in appointment." });
        }
    }

    /// <summary>
    /// Doctor/Nurse: today's clinical queue for an affiliated hospital.
    /// Date is optional and limited to hospital-local today ± 1 day.
    /// </summary>
    [HttpGet("staff")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> GetStaffHospitalAppointments(
        [FromQuery] Guid hospitalUserId,
        [FromQuery] string? date = null)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var staffUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        if (hospitalUserId == Guid.Empty)
            return BadRequest(new { message = "hospitalUserId is required." });

        DateOnly? parsedDate = null;
        if (!string.IsNullOrWhiteSpace(date) && DateOnly.TryParse(date, out var d))
            parsedDate = d;

        try
        {
            var list = await _appointmentService.GetStaffHospitalAppointmentsAsync(
                staffUserId,
                hospitalUserId,
                parsedDate);
            return Ok(list);
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
            _logger.LogError(ex, "Error retrieving staff appointments for hospital {HospitalId}", hospitalUserId);
            return StatusCode(500, new { message = "Failed to load appointments." });
        }
    }

    /// <summary>
    /// Affiliated staff: reveal patient NIC/phone/email for one appointment.
    /// </summary>
    [HttpGet("{id:guid}/staff-contact")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> GetStaffAppointmentPatientContact(Guid id)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var staffUserId))
            return Unauthorized(new { message = "Invalid user token." });

        try
        {
            var contact = await _appointmentService.GetStaffAppointmentPatientContactAsync(staffUserId, id);
            return Ok(contact);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
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
            _logger.LogError(ex, "Error retrieving staff contact for appointment {AppId}", id);
            return StatusCode(500, new { message = "Failed to load patient contact details." });
        }
    }

    /// <summary>
    /// Update status of an appointment (hospital owner, or affiliated doctor/nurse).
    /// </summary>
    [HttpPatch("{id}/status")]
    [Authorize]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateAppointmentStatusDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var callerUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        var (actorUserId, denied) = await ResolveActingUserAsync(callerUserId);
        if (denied != null) return denied;

        try
        {
            var updated = await _appointmentService.UpdateAppointmentStatusAsync(actorUserId, id, dto);
            await RecordDeskActionAsync(callerUserId, "DESK_STATUS_UPDATE", $"Front desk set appointment {id} to {updated.Status}");
            return Ok(updated);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating appointment {AppId} status", id);
            return StatusCode(500, new { message = "Failed to update appointment status." });
        }
    }

    /// <summary>
    /// Mark a patient as arrived (hospital desk or affiliated doctor/nurse), today only.
    /// </summary>
    [HttpPost("{id}/check-in")]
    [Authorize(Roles = "HOSPITAL,FRONT_DESK,DOCTOR,NURSE")]
    public async Task<IActionResult> CheckIn(Guid id)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var callerUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        var (actorUserId, denied) = await ResolveActingUserAsync(callerUserId);
        if (denied != null) return denied;

        try
        {
            var checkedIn = await _appointmentService.CheckInAsync(actorUserId, id);
            await RecordDeskActionAsync(callerUserId, "DESK_CHECK_IN", $"Front desk checked in appointment {id}");
            return Ok(checkedIn);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking in appointment {AppId}", id);
            return StatusCode(500, new { message = "Failed to check in patient." });
        }
    }

    /// <summary>
    /// Clinical AEFI report: capture immediate care, document on linked dose when available, notify MOH/physician.
    /// </summary>
    [HttpPost("{id}/aefi")]
    [Authorize(Roles = "DOCTOR,NURSE")]
    public async Task<IActionResult> ReportAefi(Guid id, [FromBody] ReportAefiDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var actorUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        try
        {
            var result = await _appointmentService.ReportAefiAsync(actorUserId, id, dto);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reporting AEFI for appointment {AppId}", id);
            return StatusCode(500, new { message = "Failed to submit AEFI report." });
        }
    }

    /// <summary>
    /// Cancel an appointment (either by patient or by hospital). Supports Guid Id or ReferenceNumber.
    /// </summary>
    [HttpDelete("{id}/cancel")]
    [Authorize]
    public async Task<IActionResult> CancelAppointment(string id)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var callerUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        var (userId, denied) = await ResolveActingUserAsync(callerUserId);
        if (denied != null) return denied;

        var isHospital = User.IsInRole("HOSPITAL") || IsFrontDesk;

        try
        {
            await _appointmentService.CancelAppointmentAsync(userId, id, isHospital);
            await RecordDeskActionAsync(callerUserId, "DESK_CANCEL", $"Front desk cancelled appointment {id}");
            return Ok(new { message = "Appointment cancelled successfully." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error cancelling appointment {AppId}", id);
            return StatusCode(500, new { message = "Failed to cancel appointment." });
        }
    }
}
