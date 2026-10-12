using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Vaxora.Api.Services;

public interface IEmailService
{
    Task<bool> SendPatientWelcomeEmailAsync(string toEmail, string patientName, string regNumber, DateTime? dob, byte[] vaccinationCardPdfBytes);
    Task<bool> SendPendingApprovalEmailAsync(string toEmail, string recipientName, string regNumber, string roleName);
    Task<bool> SendApprovalEmailAsync(string toEmail, string recipientName, string regNumber, string roleName);
    Task<bool> SendRejectionEmailAsync(string toEmail, string recipientName, string regNumber, string roleName, string? rejectionReason);
    Task<bool> SendPasswordResetEmailAsync(string toEmail, string recipientName, string resetLink, string resetCode, int expiryMinutes = 15);
    Task<bool> SendPasswordChangedConfirmationEmailAsync(string toEmail, string recipientName);
    Task<bool> SendAccountDeletedEmailAsync(string toEmail, string recipientName, string regNumber, string roleName);
    Task<bool> SendAppointmentBookingConfirmationEmailAsync(
        string toEmail,
        string patientName,
        string vaccineName,
        string hospitalName,
        string appointmentDate,
        string timeSlot,
        string? doctorName,
        string? nurseName,
        string? notes,
        decimal fee = 0.00m,
        string paymentMethod = "Free",
        string paymentStatus = "Paid");
    Task<bool> SendPaymentReceiptEmailAsync(
        string toEmail,
        string patientName,
        string vaccineName,
        string hospitalName,
        string appointmentDate,
        string timeSlot,
        decimal amountPaid,
        string currency,
        string transactionId,
        string orderId,
        DateTime paymentTime);
    Task<bool> SendAppointmentCancellationEmailAsync(
        string toEmail,
        string patientName,
        string vaccineName,
        string hospitalName,
        string appointmentDate,
        string timeSlot,
        string cancelledBy);

    // ============ INVENTORY / AI AGENT EMAILS ============
    Task<bool> SendPurchaseOrderToSupplierAsync(
        string toEmail,
        string supplierName,
        string poNumber,
        string hospitalName,
        string orderDate,
        string deliveryDate,
        List<(string VaccineName, int Quantity, decimal UnitPrice, decimal LineTotal)> lineItems,
        decimal totalLkr,
        string approvalNotes);

    Task<bool> SendExpiryMemoToOpsManagerAsync(
        string toEmail,
        string recipientName,
        string memoNumber,
        string hospitalName,
        List<(string VaccineName, string BatchNumber, int Quantity, string ExpiryDate, int DaysLeft, string Priority, string Action)> actions,
        string summary);

    Task<bool> SendAefiSurveillanceAlertAsync(
        string toEmail,
        string recipientName,
        string patientName,
        string vaccineName,
        string hospitalName,
        string appointmentDate,
        string timeSlot,
        string severity,
        string symptoms,
        string treatmentGiven,
        string reportedBy,
        string appointmentId);

    // ============ ADDED: DAMAGE REPORT ============
    Task<bool> SendDamageReportToSupplierAsync(
        string toEmail,
        string supplierName,
        string hospitalName,
        string vaccineName,
        string lotNumber,
        int quantity,
        string damageType,
        string notes,
        byte[] photoBytes,
        string photoFileName,
        string photoContentType);
}

public class EmailService : IEmailService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IConfiguration configuration, ILogger<EmailService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<bool> SendPatientWelcomeEmailAsync(string toEmail, string patientName, string regNumber, DateTime? dob, byte[] vaccinationCardPdfBytes)
    {
        var subject = $"Welcome to Vaxora • Your Digital Vaccination Card ({regNumber})";
        var bodyHtml = $@"
<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <title>{subject}</title>
</head>
<body style='margin: 0; padding: 24px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, ""Segoe UI"", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;'>
  <table role='presentation' width='100%' border='0' cellspacing='0' cellpadding='0' style='background-color: #f1f5f9; padding: 20px 0;'>
    <tr>
      <td align='center'>
        <table role='presentation' width='100%' border='0' cellspacing='0' cellpadding='0' style='max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);'>
          <tr>
            <td style='background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 32px 24px; text-align: center;'>
              <h1 style='margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 2px;'>VAXORA</h1>
              <p style='margin: 6px 0 0 0; color: #e0f2fe; font-size: 13px; font-weight: 500; letter-spacing: 0.5px;'>National Immunization &amp; Healthcare Platform</p>
            </td>
          </tr>
          <tr>
            <td style='padding: 32px 28px; background-color: #ffffff;'>
              <p style='margin: 0 0 16px 0; color: #0f172a; font-size: 16px; line-height: 1.5;'>Dear <strong>{patientName}</strong>,</p>
              <p style='margin: 0 0 20px 0; color: #334155; font-size: 15px; line-height: 1.6;'>Welcome to <strong>Vaxora</strong>. Your official national immunization citizen profile has been created successfully.</p>
              <div style='background-color: #f0f9ff; border: 2px solid #0284c7; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;'>
                <div style='color: #0369a1; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;'>Your Vaxora Registration Number</div>
                <div style='color: #0284c7; font-size: 26px; font-weight: 800; letter-spacing: 2px; font-family: ""Courier New"", Courier, monospace;'>{regNumber}</div>
              </div>
              <table role='presentation' width='100%' border='0' cellspacing='0' cellpadding='0' style='margin: 20px 0; border-collapse: collapse;'>
                <tr>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; width: 40%;'>Patient Name:</td>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; font-size: 14px;'>{patientName}</td>
                </tr>
                <tr>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;'>Vaxora ID:</td>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; font-size: 14px;'>{regNumber}</td>
                </tr>
                <tr>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;'>Date of Birth:</td>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; font-size: 14px;'>{dob?.ToString("dd MMM yyyy") ?? "N/A"}</td>
                </tr>
                <tr>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;'>Account Status:</td>
                  <td style='padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #16a34a; font-weight: 700; font-size: 14px;'>✓ Active &amp; Verified</td>
                </tr>
              </table>
              <div style='background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 18px; border-radius: 6px; margin: 24px 0;'>
                <p style='margin: 0; color: #15803d; font-size: 14px; line-height: 1.5;'>
                  📎 <strong>Attached:</strong> Your official digital <strong>Vaxora Vaccination Card (PDF)</strong> is attached to this email. You can present this card at any registered hospital or clinic.
                </p>
              </div>
              <p style='margin: 0; color: #64748b; font-size: 13.5px; line-height: 1.5;'>Please keep your Vaxora Registration Number safe for immunization appointments and verification.</p>
            </td>
          </tr>
          <tr>
            <td style='background-color: #f8fafc; padding: 22px 24px; text-align: center; border-top: 1px solid #e2e8f0;'>
              <p style='margin: 0; color: #64748b; font-size: 12px;'>&copy; {DateTime.UtcNow.Year} Vaxora National Immunization Platform. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>";

        return await SendEmailAsync(toEmail, patientName, subject, bodyHtml, vaccinationCardPdfBytes, $"Vaxora_Vaccination_Card_{regNumber}.pdf");
    }

    public async Task<bool> SendPendingApprovalEmailAsync(string toEmail, string recipientName, string regNumber, string roleName)
    {
        var subject = $"Application Received • Vaxora {roleName} Account ({regNumber})";
        var bodyHtml = $@"
<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <title>{subject}</title>
</head>
<body style='margin: 0; padding: 24px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, ""Segoe UI"", Roboto, Helvetica, Arial, sans-serif; color: #1e293b;'>
  <table role='presentation' width='100%' border='0' cellspacing='0' cellpadding='0' style='background-color: #f1f5f9; padding: 20px 0;'>
    <tr>
      <td align='center'>
        <table role='presentation' width='100%' border='0' cellspacing='0' cellpadding='0' style='max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;'>
          <tr>
            <td style='background: linear-gradient(135deg, #d97706 0%, #b45309 100%); padding: 32px 24px; text-align: center;'>
              <h1 style='margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 2px;'>VAXORA</h1>
              <p style='margin: 6px 0 0 0; color: #fef3c7; font-size: 13px; font-weight: 500;'>Healthcare Professional &amp; Hospital Portal</p>
            </td>
          </tr>
          <tr>
            <td style='padding: 32px 28px; background-color: #ffffff;'>
              <p style='margin: 0 0 16px 0; color: #0f172a; font-size: 16px;'>Dear <strong>{recipientName}</strong>,</p>
              <p style='margin: 0 0 20px 0; color: #334155; font-size: 15px; line-height: 1.6;'>Thank you for registering on <strong>Vaxora</strong> as a <strong>{roleName}</strong>.</p>
              <div style='background-color: #fffbeb; border: 2px solid #f59e0b; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;'>
                <div style='color: #92400e; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;'>Assigned Registration Number</div>
                <div style='color: #b45309; font-size: 26px; font-weight: 800; letter-spacing: 2px; font-family: monospace;'>{regNumber}</div>
              </div>
              <div style='background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px 18px; border-radius: 6px; margin: 24px 0;'>
                <div style='color: #92400e; font-weight: 700; font-size: 14px; margin-bottom: 4px;'>⏳ Application Under Review</div>
                <div style='color: #78350f; font-size: 13.5px; line-height: 1.5;'>Your submitted credentials and documentation are currently undergoing administrative verification by our compliance team.</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style='background-color: #f8fafc; padding: 22px 24px; text-align: center; border-top: 1px solid #e2e8f0;'>
              <p style='margin: 0; color: #64748b; font-size: 12px;'>&copy; {DateTime.UtcNow.Year} Vaxora National Immunization Platform.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>";

        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendApprovalEmailAsync(string toEmail, string recipientName, string regNumber, string roleName)
    {
        var subject = $"Account Approved • Access Granted to Vaxora {roleName} Portal ({regNumber})";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#059669;'>VAXORA</h1>
    <p>Dear <strong>{recipientName}</strong>,</p>
    <p>Your <strong>Vaxora {roleName}</strong> account has been approved.</p>
    <div style='background:#f0fdf4; border:2px solid #16a34a; border-radius:10px; padding:20px; text-align:center; margin:24px 0;'>
      <div style='color:#15803d; font-size:12px; font-weight:700;'>VAXORA REGISTRATION NUMBER</div>
      <div style='color:#16a34a; font-size:26px; font-weight:800; letter-spacing:2px; font-family:monospace;'>{regNumber}</div>
    </div>
    <p>You may now log in at <a href='http://localhost:5173/login'>http://localhost:5173/login</a>.</p>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendRejectionEmailAsync(string toEmail, string recipientName, string regNumber, string roleName, string? rejectionReason)
    {
        var subject = $"Account Verification Notice • Vaxora {roleName} ({regNumber})";
        var reasonText = !string.IsNullOrWhiteSpace(rejectionReason) ? rejectionReason : "The submitted credential documents could not be verified.";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#dc2626;'>VAXORA</h1>
    <p>Dear <strong>{recipientName}</strong>,</p>
    <p>Your application as a <strong>{roleName}</strong> (Ref: <code>{regNumber}</code>) could not be verified.</p>
    <div style='background:#fef2f2; border:1.5px solid #ef4444; border-radius:8px; padding:18px; margin:20px 0;'>
      <div style='color:#dc2626; font-weight:700; margin-bottom:6px;'>Reviewer Feedback:</div>
      <div style='color:#7f1d1d;'>{reasonText}</div>
    </div>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendPasswordResetEmailAsync(string toEmail, string recipientName, string resetLink, string resetCode, int expiryMinutes = 15)
    {
        var subject = "Password Reset Request • Vaxora Platform";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#0284c7;'>VAXORA</h1>
    <p>Dear <strong>{recipientName}</strong>,</p>
    <p>We received a request to reset your password.</p>
    <div style='background:#f0f9ff; border:2px solid #0284c7; border-radius:10px; padding:22px; text-align:center; margin:24px 0;'>
      <div style='color:#0369a1; font-size:12px; font-weight:700;'>RESET CODE</div>
      <div style='color:#0284c7; font-size:32px; font-weight:800; letter-spacing:6px; font-family:monospace;'>{resetCode}</div>
    </div>
    <p><a href='{resetLink}' style='display:inline-block; background:#0284c7; color:#fff; padding:14px 34px; border-radius:8px; text-decoration:none; font-weight:700;'>Reset My Password</a></p>
    <p style='color:#92400e;'>This code expires in {expiryMinutes} minutes.</p>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendPasswordChangedConfirmationEmailAsync(string toEmail, string recipientName)
    {
        var subject = "Security Alert • Your Vaxora Password Was Successfully Changed";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#059669;'>VAXORA</h1>
    <p>Dear <strong>{recipientName}</strong>,</p>
    <p>Your Vaxora password was successfully changed on {DateTime.UtcNow:dd MMM yyyy, HH:mm} UTC.</p>
    <p>If you did not perform this action, contact support immediately.</p>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendAccountDeletedEmailAsync(string toEmail, string recipientName, string regNumber, string roleName)
    {
        var subject = $"Account Deletion Confirmation • Vaxora {roleName} ({regNumber})";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#475569;'>VAXORA</h1>
    <p>Dear <strong>{recipientName}</strong>,</p>
    <p>Your <strong>Vaxora {roleName} account</strong> (Reg: <code>{regNumber}</code>) has been permanently deleted.</p>
    <p style='color:#64748b; font-size:13px;'>If you did not request this, contact support.</p>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendAppointmentBookingConfirmationEmailAsync(
        string toEmail, string patientName, string vaccineName, string hospitalName,
        string appointmentDate, string timeSlot, string? doctorName, string? nurseName,
        string? notes, decimal fee = 0.00m, string paymentMethod = "Free", string paymentStatus = "Paid")
    {
        var subject = $"Appointment Confirmed • {vaccineName} at {hospitalName} ({appointmentDate})";
        var paymentSummaryHtml = fee <= 0
            ? "<span style='color:#16a34a;font-weight:700;'>✓ Free</span>"
            : string.Equals(paymentStatus, "Paid", StringComparison.OrdinalIgnoreCase)
                ? $"<span style='color:#0284c7;font-weight:700;'>LKR {fee:N2} Paid</span>"
                : $"<span style='color:#0284c7;font-weight:700;'>LKR {fee:N2} due at the hospital desk</span>";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#0f766e;'>VAXORA</h1>
    <p>Dear <strong>{patientName}</strong>,</p>
    <p>Your vaccination appointment is confirmed.</p>
    <div style='background:#f0fdfa; border:2px solid #0d9488; border-radius:10px; padding:22px; margin:24px 0;'>
      <div style='color:#0f766e; font-size:12px; font-weight:700;'>RESERVED SESSION</div>
      <div style='color:#0f766e; font-size:22px; font-weight:800;'>{vaccineName}</div>
      <div style='color:#115e59; font-weight:600;'>{hospitalName}</div>
    </div>
    <table style='width:100%; border-collapse: collapse;'>
      <tr><td style='padding:10px 0; border-bottom:1px solid #e2e8f0; color:#64748b;'>Date:</td><td style='padding:10px 0; border-bottom:1px solid #e2e8f0; font-weight:700;'>📅 {appointmentDate}</td></tr>
      <tr><td style='padding:10px 0; border-bottom:1px solid #e2e8f0; color:#64748b;'>Time:</td><td style='padding:10px 0; border-bottom:1px solid #e2e8f0; font-weight:700;'>⏰ {timeSlot}</td></tr>
      <tr><td style='padding:10px 0; border-bottom:1px solid #e2e8f0; color:#64748b;'>Payment:</td><td style='padding:10px 0; border-bottom:1px solid #e2e8f0;'>{paymentSummaryHtml}</td></tr>
    </table>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, patientName, subject, bodyHtml);
    }

    public async Task<bool> SendPaymentReceiptEmailAsync(
        string toEmail, string patientName, string vaccineName, string hospitalName,
        string appointmentDate, string timeSlot, decimal amountPaid, string currency,
        string transactionId, string orderId, DateTime paymentTime)
    {
        var subject = $"Payment Receipt • {orderId} • {currency} {amountPaid:N2} for {vaccineName}";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#1e3a8a;'>VAXORA</h1>
    <p>Dear <strong>{patientName}</strong>,</p>
    <p>Thank you for your payment via PayHere.</p>
    <div style='background:#f0fdf4; border:2px solid #16a34a; border-radius:10px; padding:22px; margin:24px 0; text-align:center;'>
      <div style='color:#15803d; font-size:12px; font-weight:700;'>AMOUNT PAID</div>
      <div style='color:#16a34a; font-size:32px; font-weight:800;'>{currency} {amountPaid:N2}</div>
      <div style='color:#15803d; font-size:13px;'>✓ PAID &amp; VERIFIED</div>
    </div>
    <p><strong>Transaction ID:</strong> {transactionId}<br/>
       <strong>Order ID:</strong> {orderId}<br/>
       <strong>Date:</strong> {paymentTime:dd MMM yyyy, HH:mm} UTC</p>
    <p>Vaccine: <strong>{vaccineName}</strong> at <strong>{hospitalName}</strong> on {appointmentDate} ({timeSlot}).</p>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, patientName, subject, bodyHtml);
    }

    public async Task<bool> SendAppointmentCancellationEmailAsync(
        string toEmail, string patientName, string vaccineName, string hospitalName,
        string appointmentDate, string timeSlot, string cancelledBy)
    {
        var subject = $"Appointment Cancelled • {vaccineName} at {hospitalName} ({appointmentDate})";
        var bodyHtml = $@"
<!DOCTYPE html><html><body style='font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;'>
  <div style='max-width:600px; margin:auto; background:#fff; border-radius:12px; padding:32px;'>
    <h1 style='color:#475569;'>VAXORA</h1>
    <p>Dear <strong>{patientName}</strong>,</p>
    <p>Your vaccination appointment has been <strong>cancelled</strong>.</p>
    <div style='background:#fef2f2; border:1.5px solid #ef4444; border-radius:10px; padding:20px; margin:24px 0; text-align:center;'>
      <div style='color:#991b1b; font-size:12px; font-weight:700;'>APPOINTMENT STATUS</div>
      <div style='color:#dc2626; font-size:22px; font-weight:800;'>✕ Cancelled</div>
    </div>
    <p><strong>Vaccine:</strong> {vaccineName}<br/>
       <strong>Hospital:</strong> {hospitalName}<br/>
       <strong>Date:</strong> {appointmentDate} ({timeSlot})<br/>
       <strong>Cancelled by:</strong> {cancelledBy}</p>
    <p><a href='http://localhost:5173/patient/appointments'>Book a New Appointment</a></p>
  </div>
</body></html>";
        return await SendEmailAsync(toEmail, patientName, subject, bodyHtml);
    }

    // ============ INVENTORY / AI AGENT EMAILS ============

    public async Task<bool> SendPurchaseOrderToSupplierAsync(
        string toEmail,
        string supplierName,
        string poNumber,
        string hospitalName,
        string orderDate,
        string deliveryDate,
        List<(string VaccineName, int Quantity, decimal UnitPrice, decimal LineTotal)> lineItems,
        decimal totalLkr,
        string approvalNotes)
    {
        var subject = $"Purchase Order {poNumber} • {hospitalName}";
        var rows = string.Join("", lineItems.Select((li, i) => $@"
          <tr>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0;'>{i + 1}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0;'>{li.VaccineName}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;'>{li.Quantity:N0}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;'>{li.UnitPrice:N2}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;'>{li.LineTotal:N2}</td>
          </tr>"));

        var bodyHtml = $@"
<!DOCTYPE html>
<html lang='en'>
<head><meta charset='utf-8'><title>{subject}</title></head>
<body style='margin:0; padding:24px; background:#f1f5f9; font-family: -apple-system, BlinkMacSystemFont, ""Segoe UI"", Roboto, Arial, sans-serif; color:#1e293b;'>
  <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='background:#f1f5f9;'>
    <tr><td align='center'>
      <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='max-width:680px; background:#fff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden;'>
        <tr>
          <td style='background: linear-gradient(135deg, #1e3a8a 0%, #0284c7 100%); padding:30px 24px; text-align:center;'>
            <h1 style='margin:0; color:#fff; font-size:26px; font-weight:800; letter-spacing:2px;'>VAXORA</h1>
            <p style='margin:6px 0 0 0; color:#e0f2fe; font-size:13px;'>Official Purchase Order</p>
          </td>
        </tr>
        <tr>
          <td style='padding:32px 28px;'>
            <p style='margin:0 0 8px 0;'>Dear <strong>{supplierName}</strong>,</p>
            <p style='margin:0 0 20px 0; color:#334155;'>Please process the following purchase order submitted by <strong>{hospitalName}</strong>.</p>

            <table role='presentation' width='100%' style='margin:20px 0; border-collapse:collapse;'>
              <tr><td style='padding:8px 0; color:#64748b; width:40%;'>PO Number:</td><td style='padding:8px 0; font-weight:700; font-family:monospace;'>{poNumber}</td></tr>
              <tr><td style='padding:8px 0; color:#64748b;'>Order Date:</td><td style='padding:8px 0;'>{orderDate}</td></tr>
              <tr><td style='padding:8px 0; color:#64748b;'>Requested Delivery:</td><td style='padding:8px 0;'>{deliveryDate}</td></tr>
              <tr><td style='padding:8px 0; color:#64748b;'>Hospital:</td><td style='padding:8px 0; font-weight:700;'>{hospitalName}</td></tr>
            </table>

            <h3 style='margin:24px 0 8px 0; color:#0f172a; font-size:16px;'>Order Items</h3>
            <table role='presentation' width='100%' style='border-collapse:collapse; background:#f8fafc; border-radius:8px; overflow:hidden;'>
              <thead>
                <tr style='background:#0284c7; color:#fff;'>
                  <th style='padding:10px; text-align:left;'>#</th>
                  <th style='padding:10px; text-align:left;'>Vaccine</th>
                  <th style='padding:10px; text-align:right;'>Qty</th>
                  <th style='padding:10px; text-align:right;'>Unit Price (LKR)</th>
                  <th style='padding:10px; text-align:right;'>Line Total (LKR)</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan='4' style='padding:14px 10px; text-align:right; font-weight:700; background:#f0f9ff; color:#0369a1;'>Total (LKR):</td>
                  <td style='padding:14px 10px; text-align:right; font-weight:800; background:#f0f9ff; color:#0369a1; font-size:16px;'>{totalLkr:N2}</td>
                </tr>
              </tfoot>
            </table>

            <div style='background:#f8fafc; border-left:4px solid #0284c7; padding:14px 18px; border-radius:6px; margin:24px 0;'>
              <p style='margin:0; color:#334155; font-size:13.5px;'><strong>Approval Notes:</strong> {approvalNotes}</p>
            </div>

            <p style='margin:0; color:#64748b; font-size:13px;'>Please acknowledge receipt of this order and confirm the delivery schedule at your earliest convenience.</p>
          </td>
        </tr>
        <tr>
          <td style='background:#f8fafc; padding:20px; text-align:center; border-top:1px solid #e2e8f0;'>
            <p style='margin:0; color:#64748b; font-size:12px;'>&copy; {DateTime.UtcNow.Year} Vaxora National Immunization Platform</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>";

        return await SendEmailAsync(toEmail, supplierName, subject, bodyHtml);
    }

    public async Task<bool> SendExpiryMemoToOpsManagerAsync(
        string toEmail,
        string recipientName,
        string memoNumber,
        string hospitalName,
        List<(string VaccineName, string BatchNumber, int Quantity, string ExpiryDate, int DaysLeft, string Priority, string Action)> actions,
        string summary)
    {
        var subject = $"Expiry Action Memo {memoNumber} • {hospitalName}";
        var rows = string.Join("", actions.Select(a => $@"
          <tr>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0;'>{a.VaccineName}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; font-family:monospace;'>{a.BatchNumber}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;'>{a.Quantity:N0}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0;'>{a.ExpiryDate}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-align:center; color:{(a.DaysLeft <= 14 ? "#dc2626" : a.DaysLeft <= 30 ? "#d97706" : "#16a34a")}; font-weight:700;'>{a.DaysLeft}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-transform:capitalize;'>{a.Priority}</td>
            <td style='padding:10px; border-bottom:1px solid #e2e8f0; text-transform:capitalize;'>{a.Action.Replace("_", " ")}</td>
          </tr>"));

        var bodyHtml = $@"
<!DOCTYPE html>
<html lang='en'>
<head><meta charset='utf-8'><title>{subject}</title></head>
<body style='margin:0; padding:24px; background:#f1f5f9; font-family: -apple-system, BlinkMacSystemFont, ""Segoe UI"", Roboto, Arial, sans-serif; color:#1e293b;'>
  <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='background:#f1f5f9;'>
    <tr><td align='center'>
      <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='max-width:720px; background:#fff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden;'>
        <tr>
          <td style='background: linear-gradient(135deg, #d97706 0%, #b45309 100%); padding:30px 24px; text-align:center;'>
            <h1 style='margin:0; color:#fff; font-size:26px; font-weight:800; letter-spacing:2px;'>VAXORA</h1>
            <p style='margin:6px 0 0 0; color:#fef3c7; font-size:13px;'>Cold Chain &amp; Expiry Action Memo</p>
          </td>
        </tr>
        <tr>
          <td style='padding:32px 28px;'>
            <p style='margin:0 0 8px 0;'>Dear <strong>{recipientName}</strong>,</p>
            <p style='margin:0 0 20px 0; color:#334155;'>The Vaxora AI ExpiryAgent has flagged the following batch(es) for immediate attention at <strong>{hospitalName}</strong>.</p>

            <div style='background:#fffbeb; border:2px solid #f59e0b; border-radius:10px; padding:18px; text-align:center; margin:20px 0;'>
              <div style='color:#92400e; font-size:12px; font-weight:700; text-transform:uppercase;'>Memo Reference</div>
              <div style='color:#b45309; font-size:22px; font-weight:800; font-family:monospace; letter-spacing:1px;'>{memoNumber}</div>
            </div>

            <table role='presentation' width='100%' style='border-collapse:collapse; background:#f8fafc; border-radius:8px; overflow:hidden;'>
              <thead>
                <tr style='background:#d97706; color:#fff;'>
                  <th style='padding:10px; text-align:left;'>Vaccine</th>
                  <th style='padding:10px; text-align:left;'>Batch</th>
                  <th style='padding:10px; text-align:right;'>Qty</th>
                  <th style='padding:10px; text-align:left;'>Expiry</th>
                  <th style='padding:10px; text-align:center;'>Days Left</th>
                  <th style='padding:10px; text-align:left;'>Priority</th>
                  <th style='padding:10px; text-align:left;'>Action</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>

            <div style='background:#f8fafc; border-left:4px solid #d97706; padding:14px 18px; border-radius:6px; margin:24px 0;'>
              <p style='margin:0; color:#334155; font-size:13.5px;'><strong>Summary:</strong> {summary}</p>
            </div>

            <p style='margin:0; color:#64748b; font-size:13px;'>Please review and take the recommended action at your earliest convenience.</p>
          </td>
        </tr>
        <tr>
          <td style='background:#f8fafc; padding:20px; text-align:center; border-top:1px solid #e2e8f0;'>
            <p style='margin:0; color:#64748b; font-size:12px;'>&copy; {DateTime.UtcNow.Year} Vaxora National Immunization Platform</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>";

        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    public async Task<bool> SendAefiSurveillanceAlertAsync(
        string toEmail,
        string recipientName,
        string patientName,
        string vaccineName,
        string hospitalName,
        string appointmentDate,
        string timeSlot,
        string severity,
        string symptoms,
        string treatmentGiven,
        string reportedBy,
        string appointmentId)
    {
        var subject = $"[AEFI {severity}] {vaccineName} — {hospitalName}";
        var bodyHtml = $@"
<!DOCTYPE html>
<html>
<body style='margin:0; padding:0; background:#f8fafc; font-family:Segoe UI,Arial,sans-serif;'>
  <table role='presentation' width='100%' style='background:#f8fafc; padding:24px 12px;'>
    <tr><td align='center'>
      <table role='presentation' width='600' style='background:#fff; border-radius:12px; overflow:hidden; border:1px solid #fecaca;'>
        <tr>
          <td style='background:linear-gradient(135deg,#dc2626,#991b1b); padding:22px 28px; color:#fff;'>
            <div style='font-size:12px; letter-spacing:1px; text-transform:uppercase; opacity:0.9;'>Immunization Safety Alert</div>
            <div style='font-size:22px; font-weight:700; margin-top:4px;'>AEFI Report — {severity}</div>
          </td>
        </tr>
        <tr>
          <td style='padding:24px 28px; color:#334155; font-size:14px; line-height:1.55;'>
            <p style='margin:0 0 14px 0;'>An adverse event following immunization has been reported and immediate care was documented.</p>
            <table role='presentation' width='100%' style='border-collapse:collapse; background:#fef2f2; border-radius:8px;'>
              <tr><td style='padding:10px 14px; width:140px; color:#7f1d1d; font-weight:600;'>Patient</td><td style='padding:10px 14px;'>{patientName}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Vaccine</td><td style='padding:10px 14px;'>{vaccineName}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Hospital</td><td style='padding:10px 14px;'>{hospitalName}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Session</td><td style='padding:10px 14px;'>{appointmentDate} {timeSlot}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Severity</td><td style='padding:10px 14px;'>{severity}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Symptoms</td><td style='padding:10px 14px;'>{symptoms}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Treatment</td><td style='padding:10px 14px;'>{treatmentGiven}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Reported by</td><td style='padding:10px 14px;'>{reportedBy}</td></tr>
              <tr><td style='padding:10px 14px; color:#7f1d1d; font-weight:600;'>Appointment</td><td style='padding:10px 14px; font-family:monospace;'>{appointmentId}</td></tr>
            </table>
            <p style='margin:18px 0 0 0; color:#64748b; font-size:12px;'>This alert was generated by Vaxora for surveillance / clinical follow-up.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>";

        return await SendEmailAsync(toEmail, recipientName, subject, bodyHtml);
    }

    // ============ ADDED: DAMAGE REPORT EMAIL ============

    public async Task<bool> SendDamageReportToSupplierAsync(
        string toEmail,
        string supplierName,
        string hospitalName,
        string vaccineName,
        string lotNumber,
        int quantity,
        string damageType,
        string notes,
        byte[] photoBytes,
        string photoFileName,
        string photoContentType)
    {
        var subject = $"Damage Report — {lotNumber} — {hospitalName}";

        var notesHtml = string.IsNullOrWhiteSpace(notes)
            ? "<em style='color:#94a3b8;'>No additional notes provided.</em>"
            : System.Net.WebUtility.HtmlEncode(notes).Replace("\n", "<br/>");

        var bodyHtml = $@"
<!DOCTYPE html>
<html lang='en'>
<head><meta charset='utf-8'><title>{subject}</title></head>
<body style='margin:0; padding:24px; background:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,""Segoe UI"",Roboto,Arial,sans-serif; color:#1e293b;'>
  <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='background:#f1f5f9;'>
    <tr><td align='center'>
      <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='max-width:640px; background:#ffffff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden;'>
        <tr>
          <td style='background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%); padding:28px 24px; text-align:center;'>
            <h1 style='margin:0; color:#ffffff; font-size:24px; font-weight:800; letter-spacing:2px;'>VAXORA</h1>
            <p style='margin:6px 0 0 0; color:#fecaca; font-size:13px;'>Vaccine Damage Report</p>
          </td>
        </tr>
        <tr>
          <td style='padding:32px 28px;'>
            <p style='margin:0 0 8px 0;'>Dear <strong>{supplierName}</strong>,</p>
            <p style='margin:0 0 20px 0; color:#334155; line-height:1.6;'>
              This is to report damage detected on a vaccine batch received at <strong>{hospitalName}</strong>.
            </p>

            <table role='presentation' width='100%' style='margin:20px 0; border-collapse:collapse; background:#f8fafc; border-radius:8px;'>
              <tr><td style='padding:12px 16px; color:#64748b; width:40%; border-bottom:1px solid #e2e8f0;'>Vaccine</td><td style='padding:12px 16px; font-weight:700; border-bottom:1px solid #e2e8f0;'>{vaccineName}</td></tr>
              <tr><td style='padding:12px 16px; color:#64748b; border-bottom:1px solid #e2e8f0;'>Lot Number</td><td style='padding:12px 16px; font-family:monospace; font-weight:700; border-bottom:1px solid #e2e8f0;'>{lotNumber}</td></tr>
              <tr><td style='padding:12px 16px; color:#64748b; border-bottom:1px solid #e2e8f0;'>Quantity Damaged</td><td style='padding:12px 16px; font-weight:700; border-bottom:1px solid #e2e8f0;'>{quantity} vials</td></tr>
              <tr><td style='padding:12px 16px; color:#64748b;'>Damage Type</td><td style='padding:12px 16px; font-weight:700; color:#dc2626;'>{damageType}</td></tr>
            </table>

            <div style='background:#fef2f2; border-left:4px solid #dc2626; padding:14px 18px; border-radius:6px; margin:20px 0;'>
              <p style='margin:0 0 6px 0; color:#991b1b; font-weight:700; font-size:13px;'>DETAILS</p>
              <p style='margin:0; color:#7f1d1d; font-size:14px; line-height:1.6;'>{notesHtml}</p>
            </div>

            <div style='background:#f0f9ff; border-left:4px solid #0284c7; padding:14px 18px; border-radius:6px; margin:20px 0;'>
              <p style='margin:0; color:#0369a1; font-size:13.5px;'>
                📎 <strong>Photographic evidence is attached</strong> for your review.
              </p>
            </div>

            <p style='margin:24px 0 0 0; color:#334155; line-height:1.6;'>
              Kindly advise on replacement or credit at your earliest convenience.
            </p>

            <p style='margin:24px 0 0 0; color:#64748b; font-size:13px;'>
              Regards,<br/>
              <strong>{hospitalName}</strong><br/>
              Vaxora Hospital Inventory
            </p>
          </td>
        </tr>
        <tr>
          <td style='background:#f8fafc; padding:20px; text-align:center; border-top:1px solid #e2e8f0;'>
            <p style='margin:0; color:#64748b; font-size:12px;'>&copy; {DateTime.UtcNow.Year} Vaxora National Immunization Platform</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>";

        var safeContentType = string.IsNullOrWhiteSpace(photoContentType)
            ? "image/jpeg"
            : photoContentType;

        var parts = safeContentType.Split('/');
        var mediaType = parts.Length > 0 ? parts[0] : "image";
        var mediaSubtype = parts.Length > 1 ? parts[1] : "jpeg";

        return await SendEmailWithCustomAttachmentAsync(
            toEmail,
            supplierName,
            subject,
            bodyHtml,
            photoBytes,
            photoFileName,
            new ContentType(mediaType, mediaSubtype));
    }

    // ============ PRIVATE HELPERS ============

    private string? GetConfigValue(string configKey, string envKey)
    {
        return _configuration[configKey]
            ?? _configuration[envKey]
            ?? Environment.GetEnvironmentVariable(envKey)
            ?? Environment.GetEnvironmentVariable(configKey.Replace(":", "__"))
            ?? Environment.GetEnvironmentVariable(configKey)
            ?? Environment.GetEnvironmentVariable(configKey.Replace(":", "_").ToUpperInvariant());
    }

    private async Task<bool> SendEmailAsync(
        string toEmail,
        string toName,
        string subject,
        string bodyHtml,
        byte[]? attachmentBytes = null,
        string? attachmentFilename = null)
    {
        var host = GetConfigValue("Smtp:Host", "SMTP_HOST");
        var portStr = GetConfigValue("Smtp:Port", "SMTP_PORT") ?? "587";
        var username = GetConfigValue("Smtp:Username", "SMTP_USERNAME");
        var password = GetConfigValue("Smtp:Password", "SMTP_PASSWORD");
        var fromEmail = GetConfigValue("Smtp:FromEmail", "SMTP_FROM_EMAIL");
        var fromName = GetConfigValue("Smtp:FromName", "SMTP_FROM_NAME") ?? "Vaxora Immunization Platform";
        var enableSslStr = GetConfigValue("Smtp:EnableSsl", "SMTP_ENABLE_SSL") ?? "true";

        toEmail = toEmail?.Trim() ?? string.Empty;
        toName = string.IsNullOrWhiteSpace(toName) ? (toEmail.Contains('@') ? toEmail.Split('@')[0] : "User") : toName.Trim();

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password) || string.IsNullOrWhiteSpace(toEmail))
        {
            _logger.LogWarning("SMTP credentials or recipient not fully configured (Host: {Host}, User: {User}, Recipient: {Recipient}). Skipping live email dispatch for '{Subject}'.", host, username, toEmail, subject);
            return false;
        }

        if (string.IsNullOrWhiteSpace(fromEmail) || (host?.Contains("gmail.com", StringComparison.OrdinalIgnoreCase) == true))
        {
            fromEmail = username;
        }

        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(fromName, fromEmail));
            message.To.Add(new MailboxAddress(toName, toEmail));
            message.Subject = subject;

            var builder = new BodyBuilder { HtmlBody = bodyHtml };

            if (attachmentBytes != null && !string.IsNullOrWhiteSpace(attachmentFilename))
            {
                builder.Attachments.Add(attachmentFilename, attachmentBytes, new ContentType("application", "pdf"));
            }

            message.Body = builder.ToMessageBody();

            int port = int.TryParse(portStr, out var p) ? p : 587;
            bool enableSsl = bool.TryParse(enableSslStr, out var ssl) ? ssl : true;
            var socketOptions = enableSsl
                ? (port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls)
                : SecureSocketOptions.Auto;

            using var client = new SmtpClient();
            client.ServerCertificateValidationCallback = (s, c, h, e) => true;

            await client.ConnectAsync(host!, port, socketOptions);
            await client.AuthenticateAsync(username!, password!);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            _logger.LogInformation("Successfully sent email '{Subject}' to '{Recipient}' from '{FromEmail}'.", subject, toEmail, fromEmail);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email '{Subject}' to '{Recipient}'. Host: {Host}, Port: {Port}, User: {User}", subject, toEmail, host, portStr, username);
            return false;
        }
    }

    private async Task<bool> SendEmailWithCustomAttachmentAsync(
        string toEmail,
        string toName,
        string subject,
        string bodyHtml,
        byte[]? attachmentBytes,
        string? attachmentFilename,
        ContentType? attachmentContentType)
    {
        var host = GetConfigValue("Smtp:Host", "SMTP_HOST");
        var portStr = GetConfigValue("Smtp:Port", "SMTP_PORT") ?? "587";
        var username = GetConfigValue("Smtp:Username", "SMTP_USERNAME");
        var password = GetConfigValue("Smtp:Password", "SMTP_PASSWORD");
        var fromEmail = GetConfigValue("Smtp:FromEmail", "SMTP_FROM_EMAIL");
        var fromName = GetConfigValue("Smtp:FromName", "SMTP_FROM_NAME") ?? "Vaxora Immunization Platform";
        var enableSslStr = GetConfigValue("Smtp:EnableSsl", "SMTP_ENABLE_SSL") ?? "true";

        toEmail = toEmail?.Trim() ?? string.Empty;
        toName = string.IsNullOrWhiteSpace(toName) ? (toEmail.Contains('@') ? toEmail.Split('@')[0] : "User") : toName.Trim();

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password) || string.IsNullOrWhiteSpace(toEmail))
        {
            _logger.LogWarning("SMTP credentials or recipient not fully configured (Host: {Host}, User: {User}, Recipient: {Recipient}). Skipping live email dispatch for '{Subject}'.", host, username, toEmail, subject);
            return false;
        }

        if (string.IsNullOrWhiteSpace(fromEmail) || (host?.Contains("gmail.com", StringComparison.OrdinalIgnoreCase) == true))
        {
            fromEmail = username;
        }

        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(fromName, fromEmail));
            message.To.Add(new MailboxAddress(toName, toEmail));
            message.Subject = subject;

            var builder = new BodyBuilder { HtmlBody = bodyHtml };

            if (attachmentBytes != null && !string.IsNullOrWhiteSpace(attachmentFilename))
            {
                builder.Attachments.Add(
                    attachmentFilename,
                    attachmentBytes,
                    attachmentContentType ?? new ContentType("application", "pdf"));
            }

            message.Body = builder.ToMessageBody();

            int port = int.TryParse(portStr, out var p) ? p : 587;
            bool enableSsl = bool.TryParse(enableSslStr, out var ssl) ? ssl : true;
            var socketOptions = enableSsl
                ? (port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls)
                : SecureSocketOptions.Auto;

            using var client = new SmtpClient();
            client.ServerCertificateValidationCallback = (s, c, h, e) => true;

            await client.ConnectAsync(host!, port, socketOptions);
            await client.AuthenticateAsync(username!, password!);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            _logger.LogInformation("Successfully sent email '{Subject}' to '{Recipient}' from '{FromEmail}'.", subject, toEmail, fromEmail);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email '{Subject}' to '{Recipient}'. Host: {Host}, Port: {Port}, User: {User}", subject, toEmail, host, portStr, username);
            return false;
        }
    }
}