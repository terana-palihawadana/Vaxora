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

    public AppointmentsController(IAppointmentService appointmentService, ILogger<AppointmentsController> logger)
    {
        _appointmentService = appointmentService;
        _logger = logger;
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
        if (!Guid.TryParse(userIdStr, out var hospitalUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

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
    [Authorize(Roles = "HOSPITAL")]
    public async Task<IActionResult> CreateWalkInAppointment([FromBody] CreateWalkInAppointmentDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var hospitalUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        try
        {
            var appointment = await _appointmentService.CreateWalkInAppointmentAsync(hospitalUserId, dto);
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
        if (!Guid.TryParse(userIdStr, out var actorUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        try
        {
            var updated = await _appointmentService.UpdateAppointmentStatusAsync(actorUserId, id, dto);
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
    [Authorize(Roles = "HOSPITAL,DOCTOR,NURSE")]
    public async Task<IActionResult> CheckIn(Guid id)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var actorUserId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        try
        {
            return Ok(await _appointmentService.CheckInAsync(actorUserId, id));
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
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
        {
            return Unauthorized(new { message = "Invalid user token." });
        }

        var isHospital = User.IsInRole("HOSPITAL");

        try
        {
            await _appointmentService.CancelAppointmentAsync(userId, id, isHospital);
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
