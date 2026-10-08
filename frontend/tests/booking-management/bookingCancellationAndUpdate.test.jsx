import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppointmentsTab from '../../src/features/patient/components/AppointmentsTab';
import { appointmentService } from '../../src/features/patient/services/appointmentService';

// Mock appointment service
vi.mock('../../src/features/patient/services/appointmentService', () => ({
  appointmentService: {
    getVaccinesWithHospitals: vi.fn(),
    getPatientAppointments: vi.fn(),
    getAvailableDates: vi.fn(),
    getAvailableSlots: vi.fn(),
    bookAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    updateAppointmentStatus: vi.fn(),
    confirmPayment: vi.fn(),
    initPayHere: vi.fn(),
  },
}));

describe('Booking Management - Cancellation & Status Updates (Scenario 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointmentService.getVaccinesWithHospitals.mockResolvedValue([]);
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  // 9a. Patient cancels an eligible upcoming appointment
  it('allows cancellation for upcoming appointments scheduled at least 1 day in advance', async () => {
    // Generate a date 7 days in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const mockAppointments = [
      {
        id: 'apt-cancel-1',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate: futureDateStr,
        timeSlot: '10:00 - 10:20',
        hospitalName: 'National Hospital Colombo',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointments);
    appointmentService.cancelAppointment.mockResolvedValue({ success: true });

    render(<AppointmentsTab />);

    // Wait for the appointment row to render
    const cancelBtn = await screen.findByRole('button', { name: /^Cancel$/i });
    expect(cancelBtn).toBeInTheDocument();

    // Click cancel
    fireEvent.click(cancelBtn);

    // Verify window.confirm prompt was shown
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Are you sure you want to cancel this appointment slot?')
    );

    // Verify appointmentService.cancelAppointment was dispatched with appointment ID
    await waitFor(() => {
      expect(appointmentService.cancelAppointment).toHaveBeenCalledWith('apt-cancel-1');
    });

    // Verify success toast appears
    await waitFor(() => {
      expect(
        screen.getByText(/Appointment cancelled successfully. A confirmation email has been dispatched/i)
      ).toBeInTheDocument();
    });

    // Verify appointments reloaded
    expect(appointmentService.getPatientAppointments).toHaveBeenCalled();
  });

  // 9b. Same-day appointments are locked from online cancellation
  it('prevents online cancellation for imminent appointments and displays the Locked indicator', async () => {
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000 + 330 * 60 * 1000);
    const todayStr = start.toISOString().slice(0, 10);
    const slotStart =
      `:`;

    const mockAppointments = [
      {
        id: 'apt-same-day',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate: todayStr,
        startTime: slotStart,
        timeSlot: ` - 23:59`,
        hospitalName: 'National Hospital Colombo',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointments);

    render(<AppointmentsTab />);

    // Wait for appointment to render
    await screen.findByText('COVID-19 mRNA Booster (Moderna)');

    // "Locked (Same-Day)" badge should be displayed
    expect(screen.getByText('Locked')).toBeInTheDocument();

    // Cancel button should NOT be present for same-day appointments
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument();
  });

  it('locks cancellation when the appointment start is less than 24 hours away', async () => {
    const appointmentStart = new Date(Date.now() + 12 * 60 * 60 * 1000 + 330 * 60 * 1000);
    const appointmentDate = appointmentStart.toISOString().slice(0, 10);
    const appointmentTime =
      `${String(appointmentStart.getUTCHours()).padStart(2, '0')}:` +
      `${String(appointmentStart.getUTCMinutes()).padStart(2, '0')}`;

    appointmentService.getPatientAppointments.mockResolvedValue([
      {
        id: 'apt-within-cutoff',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate,
        startTime: appointmentTime,
        timeSlot: `${appointmentTime} - 12:20`,
        hospitalName: 'National Hospital Colombo',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
    ]);

    render(<AppointmentsTab />);

    await screen.findByText('COVID-19 mRNA Booster (Moderna)');
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  // 9c. Cancellation API failure handling
  it('handles cancellation API error and displays alert', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const mockAppointments = [
      {
        id: 'apt-fail-cancel',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate: futureDateStr,
        timeSlot: '09:40 - 10:00',
        hospitalName: 'National Hospital Colombo',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointments);
    appointmentService.cancelAppointment.mockRejectedValue(
      new Error('Appointment has already been marked as in-progress.')
    );

    render(<AppointmentsTab />);

    const cancelBtn = await screen.findByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'Failed to cancel appointment: Appointment has already been marked as in-progress.'
      );
    });
  });

  // 9d. Cancellation dismissed when user declines confirmation dialog
  it('does not dispatch cancellation request if user cancels confirmation dialog', async () => {
    window.confirm = vi.fn(() => false); // User clicks "Cancel" on confirm prompt

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const mockAppointments = [
      {
        id: 'apt-keep',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate: futureDateStr,
        timeSlot: '09:00 - 09:20',
        hospitalName: 'National Hospital Colombo',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointments);

    render(<AppointmentsTab />);

    const cancelBtn = await screen.findByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(appointmentService.cancelAppointment).not.toHaveBeenCalled();
  });

  // 9e. Service layer updateAppointmentStatus test
  it('service layer correctly sends updateAppointmentStatus payload for hospital workflows', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h) => (h === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ id: 'apt-upd-1', status: 'Completed' }),
    });

    // Unmock appointmentService just for service invocation
    const { appointmentService: realService } = await vi.importActual(
      '../../src/features/patient/services/appointmentService'
    );

    const result = await realService.updateAppointmentStatus('apt-upd-1', { status: 'Completed' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/appointments/apt-upd-1/status'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'Completed' }),
      })
    );
    expect(result.status).toBe('Completed');
  });

  // 9f. Service layer cancelAppointment test
  it('service layer correctly sends cancelAppointment DELETE request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h) => (h === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ success: true }),
    });

    const { appointmentService: realService } = await vi.importActual(
      '../../src/features/patient/services/appointmentService'
    );

    const result = await realService.cancelAppointment('apt-del-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/appointments/apt-del-1/cancel'),
      expect.objectContaining({
        method: 'DELETE',
      })
    );
    expect(result.success).toBe(true);
  });

  it('service layer requests vaccines and hospitals from the configured API base', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h) => (h === 'content-type' ? 'application/json' : null),
      },
      json: async () => [],
    });

    const { appointmentService: realService } = await vi.importActual(
      '../../src/features/patient/services/appointmentService'
    );

    await realService.getVaccinesWithHospitals();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/inventory/vaccines-with-hospitals'),
      expect.objectContaining({ method: 'GET' })
    );
  });
});
