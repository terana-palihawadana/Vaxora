using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Vaxora.Api.Data;
using Vaxora.Api.Dtos;
using Vaxora.Api.Services;

namespace Vaxora.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PaymentController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IPayHereService _payHereService;
    private readonly IAppointmentService _appointmentService;
    private readonly ILogger<PaymentController> _logger;

    public PaymentController(
        ApplicationDbContext context,
        IPayHereService payHereService,
        IAppointmentService appointmentService,
        ILogger<PaymentController> logger)
    {
        _context = context;
        _payHereService = payHereService;
        _appointmentService = appointmentService;
        _logger = logger;
    }

    /// <summary>
    /// Generates PayHere checkout form parameters and security MD5 hash for a given appointment.
    /// </summary>
    [HttpPost("payhere-init")]
    [Authorize]
    public async Task<IActionResult> InitializePayHere([FromBody] PayHereInitRequestDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId))
        {
            return Unauthorized(new { message = "Invalid user identity token." });
        }

        var appointment = await _context.Appointments
            .FirstOrDefaultAsync(a => a.Id == dto.AppointmentId && a.PatientUserId == userId);

        if (appointment == null)
        {
            return NotFound(new { message = "Appointment record not found or does not belong to you." });
        }

        if (appointment.Fee <= 0)
        {
            return BadRequest(new { message = "This vaccination appointment is free (0 LKR). Payment gateway is not required." });
        }

        if (string.Equals(appointment.PaymentStatus, "Paid", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "This appointment is already paid." });
        }

        if (string.Equals(appointment.Status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(appointment.Status, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "Cannot pay for a cancelled or rejected appointment." });
        }

        var originHeader = Request.Headers.Origin.ToString();
        var clientOrigin = !string.IsNullOrWhiteSpace(originHeader) ? originHeader : "http://localhost:5173";

        var payload = _payHereService.CreateCheckoutParameters(appointment, clientOrigin);

        _logger.LogInformation(
            "Generated PayHere checkout payload for Appointment {AppId} (Order: {OrderId}, Fee: {Fee})",
            appointment.Id, payload.OrderId, payload.Amount);

        return Ok(payload);
    }

    /// <summary>
    /// Returns the server-confirmed PayHere payment status for the patient UI.
    /// Only the signed PayHere IPN can transition an appointment to Paid.
    /// </summary>
    [HttpPost("confirm")]
    [Authorize]
    public async Task<IActionResult> ConfirmPayment([FromBody] ConfirmPayHerePaymentRequestDto dto)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId))
        {
            return Unauthorized(new { message = "Invalid user identity token." });
        }

        var appointment = await _context.Appointments
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == dto.AppointmentId && a.PatientUserId == userId);

        if (appointment == null)
        {
            return NotFound(new { message = "Appointment record not found." });
        }

        if (string.Equals(appointment.PaymentStatus, "Paid", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(appointment.Status, "Confirmed", StringComparison.OrdinalIgnoreCase))
        {
            return Ok(new
            {
                message = "Payment already confirmed.",
                confirmed = true,
                appointment
            });
        }

        return Accepted(new
        {
            message = "Waiting for PayHere payment notification.",
            confirmed = false,
            appointment
        });
    }

    /// <summary>
    /// PayHere IPN (Instant Payment Notification) Webhook.
    /// Validates MD5 signature, merchant, amount, and order id before confirming.
    /// </summary>
    [HttpPost("payhere-notify")]
    [AllowAnonymous]
    [Consumes("application/x-www-form-urlencoded", "multipart/form-data")]
    public async Task<IActionResult> PayHereNotify([FromForm] IFormCollection form)
    {
        try
        {
            var merchantId = form["merchant_id"].ToString();
            var orderId = form["order_id"].ToString();
            var paymentId = form["payment_id"].ToString();
            var payhereAmount = form["payhere_amount"].ToString();
            var payhereCurrency = form["payhere_currency"].ToString();
            var statusCode = form["status_code"].ToString();
            var md5Sig = form["md5sig"].ToString();

            _logger.LogInformation(
                "Received PayHere IPN: Order={OrderId}, PaymentId={PaymentId}, Status={StatusCode}, Amount={Amount}",
                orderId, paymentId, statusCode, payhereAmount);

            var isValid = _payHereService.VerifyNotification(
                merchantId, orderId, payhereAmount, payhereCurrency, statusCode, md5Sig);
            if (!isValid)
            {
                _logger.LogWarning("Invalid PayHere IPN signature for Order {OrderId}", orderId);
                return BadRequest("Invalid hash signature");
            }

            // PayHere status_code: 2 = Success, 0 = Pending, -1 = Canceled, -2 = Failed, -3 = Chargedback
            if (statusCode != "2")
            {
                _logger.LogInformation(
                    "PayHere IPN status code was {StatusCode} (non-success). No confirmation applied.",
                    statusCode);
                return Ok("Notification processed");
            }

            if (string.IsNullOrWhiteSpace(paymentId))
            {
                _logger.LogWarning("PayHere IPN missing payment_id for Order {OrderId}", orderId);
                return BadRequest("Missing payment_id");
            }

            var appointment = await FindAppointmentForOrderAsync(orderId);
            if (appointment == null)
            {
                _logger.LogWarning("PayHere IPN: Could not locate appointment matching OrderId {OrderId}", orderId);
                return Ok("Notification processed");
            }

            if (!_payHereService.MatchesOrderId(appointment.Id, orderId))
            {
                _logger.LogWarning(
                    "PayHere IPN order id mismatch for Appointment {AppId}. Order={OrderId}",
                    appointment.Id, orderId);
                return BadRequest("Order id mismatch");
            }

            if (!string.Equals(payhereCurrency, "LKR", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "PayHere IPN currency mismatch for Appointment {AppId}. Currency={Currency}",
                    appointment.Id, payhereCurrency);
                return BadRequest("Currency mismatch");
            }

            if (!_payHereService.TryParseAmount(payhereAmount, out var paidAmount) ||
                Math.Abs(paidAmount - appointment.Fee) > 0.01m)
            {
                _logger.LogWarning(
                    "PayHere IPN amount mismatch for Appointment {AppId}. Paid={Paid}, Expected={Expected}",
                    appointment.Id, payhereAmount, appointment.Fee);
                return BadRequest("Amount mismatch");
            }

            await _appointmentService.ConfirmPayHerePaymentAsync(appointment.Id, paymentId, orderId.Trim());
            _logger.LogInformation("Successfully processed PayHere IPN for Appointment {AppId}", appointment.Id);

            return Ok("Notification processed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing PayHere notification");
            return StatusCode(500, "Internal error processing payment notification");
        }
    }

    private async Task<Models.Appointment?> FindAppointmentForOrderAsync(string orderId)
    {
        var cleanOrderId = (orderId ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(cleanOrderId))
            return null;

        // Canonical format from checkout: APT-{first 12 hex chars of Guid "N"}
        if (cleanOrderId.StartsWith("APT-", StringComparison.OrdinalIgnoreCase) &&
            cleanOrderId.Length >= 16)
        {
            var prefix = cleanOrderId[4..].ToLowerInvariant();
            if (prefix.Length > 12) prefix = prefix[..12];

            var candidates = await _context.Appointments
                .Where(a => a.PaymentStatus != "Paid")
                .OrderByDescending(a => a.CreatedAt)
                .Take(200)
                .ToListAsync();

            return candidates.FirstOrDefault(a =>
                a.Id.ToString("N").StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        }

        if (Guid.TryParse(cleanOrderId, out var directId))
        {
            return await _context.Appointments.FirstOrDefaultAsync(a => a.Id == directId);
        }

        return null;
    }
}
