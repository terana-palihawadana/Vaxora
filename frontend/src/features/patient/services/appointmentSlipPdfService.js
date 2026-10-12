import { jsPDF } from 'jspdf';

/** Builds and downloads a one-page PDF slip for a booked appointment. */
export function downloadAppointmentSlipPdf(appointment, patientName = '') {
  if (!appointment) throw new Error('No appointment to print.');

  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const left = 16;
  let y = 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(3, 4, 94);
  doc.text('Vaxora', left, y);
  doc.setFontSize(12);
  doc.setTextColor(0, 119, 182);
  doc.text('Vaccination appointment slip', left, (y += 8));

  doc.setDrawColor(202, 240, 248);
  doc.setLineWidth(0.6);
  doc.line(left, (y += 5), 132, y);
  y += 4;

  const rawId = String(appointment.id || appointment.Id || '').replace(/-/g, '');
  const rows = [
    ['Patient', patientName || appointment.patientName || 'Patient'],
    ['Vaccine', appointment.vaccineName || appointment.vaccine || 'Vaccination'],
    ['Hospital', appointment.hospitalName || appointment.location || 'Hospital'],
    ['Date', String(appointment.appointmentDate || appointment.date || '').slice(0, 10)],
    ['Time', appointment.timeSlot || appointment.time || 'See appointment details'],
    ['Status', appointment.status || 'Confirmed'],
    ['Payment', appointment.paymentStatus || 'Not recorded'],
    ['Token', rawId ? `T-${rawId.slice(0, 4).toUpperCase()}` : 'Given at the desk'],
  ];

  doc.setFontSize(10.5);
  rows.forEach(([label, value]) => {
    y += 9;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(91, 102, 128);
    doc.text(label, left, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(3, 4, 94);
    doc.text(doc.splitTextToSize(String(value), 84), left + 32, y);
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(91, 102, 128);
  doc.text(
    doc.splitTextToSize(
      'Show this slip and your NIC at the hospital front desk to check in. Please arrive 10 minutes early.',
      116
    ),
    left,
    y + 16
  );

  const dateKey = String(appointment.appointmentDate || appointment.date || '').slice(0, 10) || 'appointment';
  doc.save(`Vaxora_Appointment_Slip_${dateKey}.pdf`);
}

export default downloadAppointmentSlipPdf;
