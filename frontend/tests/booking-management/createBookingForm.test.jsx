import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppointmentsTab from '../../src/features/patient/components/AppointmentsTab';
import BookAppointmentModal from '../../src/features/patient/components/BookAppointmentModal';
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
    confirmPayment: vi.fn(),
    initPayHere: vi.fn(),
  },
}));

describe('Booking Management - Create Booking Form & Validation', () => {
  const mockVaccines = [
    {
      id: 'vac-1',
      name: 'COVID-19 mRNA Booster (Moderna)',
      hospitals: [
        {
          id: 'hosp-1',
          userId: 'hosp-user-1',
          name: 'National Hospital Colombo',
          location: 'Colombo 07',
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockVaccines,
    });

    appointmentService.getVaccinesWithHospitals.mockResolvedValue(mockVaccines);
    appointmentService.getPatientAppointments.mockResolvedValue([]);
  });

  // 3. Create booking form renders correctly
  it('loads vaccine choices through the appointment API service', async () => {
    render(<AppointmentsTab />);

    expect(await screen.findByRole('option', {
      name: 'COVID-19 mRNA Booster (Moderna) (Routine)',
    })).toBeInTheDocument();
    expect(appointmentService.getVaccinesWithHospitals).toHaveBeenCalledTimes(1);
  });

  it('renders booking form fields and disabled states according to workflow steps', async () => {
    const { container } = render(<AppointmentsTab />);

    // Vaccine dropdown should render
    const vaccineSelect = await waitFor(() => {
      const el = container.querySelector('#select-vaccine');
      expect(el).toBeInTheDocument();
      return el;
    });

    // Hospital dropdown should be disabled initially
    const hospitalSelect = container.querySelector('#select-hospital');
    expect(hospitalSelect).toBeDisabled();

    // Time slots are not offered until a date is chosen
    expect(container.querySelector('.slot-list')).not.toBeInTheDocument();

    // Book button should render and be disabled until form is complete
    const submitBtn = container.querySelector('.btn-book-appointment');
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();
  });

  // 4. Required-field validation works
  it('shows required field validation alert when form is submitted directly with incomplete steps', async () => {
    const { container } = render(<AppointmentsTab />);

    const form = await waitFor(() => {
      const el = container.querySelector('form.book-appointment-form');
      expect(el).toBeInTheDocument();
      return el;
    });

    fireEvent.submit(form);

    expect(window.alert).toHaveBeenCalledWith(
      'Please complete all steps (Vaccine, Hospital, Date, and Time).'
    );
    expect(appointmentService.bookAppointment).not.toHaveBeenCalled();
  });

  // 3 & 6. Form completes and submits correctly with API success handling
  it('renders and submits create booking form correctly and handles successful API response', async () => {
    const mockDates = [
      {
        date: '2026-11-20',
        dayOfWeek: 'Friday',
        startTime: '09:00',
        endTime: '11:00',
        doctorName: 'Sunil Perera',
        price: 0,
        scheduleId: 'sched-101',
      },
    ];

    const mockSlots = [
      { slot: '09:00 - 09:20', isBooked: false },
      { slot: '09:20 - 09:40', isBooked: false },
    ];

    appointmentService.getAvailableDates.mockResolvedValue(mockDates);
    appointmentService.getAvailableSlots.mockResolvedValue(mockSlots);
    appointmentService.bookAppointment.mockResolvedValue({
      id: 'new-apt-1',
      status: 'Confirmed',
      fee: 0,
    });

    const { container } = render(<AppointmentsTab />);

    // 1. Select Vaccine
    const vaccineSelect = await waitFor(() => {
      const el = container.querySelector('#select-vaccine');
      expect(el).toBeInTheDocument();
      return el;
    });
    fireEvent.change(vaccineSelect, { target: { value: 'COVID-19 mRNA Booster (Moderna)' } });

    // 2. Select Hospital
    const hospitalSelect = container.querySelector('#select-hospital');
    expect(hospitalSelect).not.toBeDisabled();
    fireEvent.change(hospitalSelect, { target: { value: 'hosp-user-1' } });

    // Verify getAvailableDates was called
    await waitFor(() => {
      expect(appointmentService.getAvailableDates).toHaveBeenCalledWith(
        'hosp-user-1',
        'COVID-19 mRNA Booster (Moderna)'
      );
    });

    // 3. Open Calendar popup and choose Date
    const calendarTrigger = await screen.findByText(/Click to select available date from calendar/i);
    fireEvent.click(calendarTrigger);

    const availableDateCell = await screen.findByTitle(/2026-11-20/i);
    fireEvent.click(availableDateCell);

    // Verify getAvailableSlots was called
    await waitFor(() => {
      expect(appointmentService.getAvailableSlots).toHaveBeenCalledWith(
        'hosp-user-1',
        'COVID-19 mRNA Booster (Moderna)',
        '2026-11-20'
      );
    });

    // 4. Wait for slots to finish loading into select
    const slotOption = await screen.findByRole('option', { name: /^09:00 - 09:20/ });
    fireEvent.click(slotOption);

    // 5. Submit Booking via enabled CTA button
    const submitBtn = container.querySelector('.btn-book-appointment');
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
      expect(submitBtn).toHaveTextContent('Confirm & Book Free Spot');
    });
    fireEvent.click(submitBtn);

    // Verify payload dispatched to bookAppointment
    await waitFor(() => {
      expect(appointmentService.bookAppointment).toHaveBeenCalledWith({
        hospitalUserId: 'hosp-user-1',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        vaccineId: 'vac-1',
        vaccineScheduleId: 'sched-101',
        appointmentDate: '2026-11-20',
        timeSlot: '09:00 - 09:20',
        notes: null,
        paymentMethod: 'Free',
      });
    });

    // 6. Verify successful booking toast appears
    await waitFor(() => {
      expect(
        screen.getByText(/Free appointment confirmed! Booking details sent to your email./i)
      ).toBeInTheDocument();
    });

    // Verify appointments list is reloaded
    expect(appointmentService.getPatientAppointments).toHaveBeenCalled();
  });

  // 5 & 7. Invalid booking data and API failure response handling
  it('handles API failure gracefully and displays error notification', async () => {
    const mockDates = [
      {
        date: '2026-11-20',
        dayOfWeek: 'Friday',
        startTime: '09:00',
        endTime: '11:00',
        price: 0,
        scheduleId: 'sched-101',
      },
    ];
    const mockSlots = [{ slot: '09:00 - 09:20', isBooked: false }];

    appointmentService.getAvailableDates.mockResolvedValue(mockDates);
    appointmentService.getAvailableSlots.mockResolvedValue(mockSlots);
    appointmentService.bookAppointment.mockRejectedValue(
      new Error('The requested time slot has just been reserved by another patient.')
    );

    const { container } = render(<AppointmentsTab />);

    // Select Vaccine, Hospital, Date, Time
    const vaccineSelect = await waitFor(() => {
      const el = container.querySelector('#select-vaccine');
      expect(el).toBeInTheDocument();
      return el;
    });
    fireEvent.change(vaccineSelect, { target: { value: 'COVID-19 mRNA Booster (Moderna)' } });

    const hospitalSelect = container.querySelector('#select-hospital');
    fireEvent.change(hospitalSelect, { target: { value: 'hosp-user-1' } });

    const calendarTrigger = await screen.findByText(/Click to select available date from calendar/i);
    fireEvent.click(calendarTrigger);

    const availableDateCell = await screen.findByTitle(/2026-11-20/i);
    fireEvent.click(availableDateCell);

    const slotOption = await screen.findByRole('option', { name: /^09:00 - 09:20/ });
    fireEvent.click(slotOption);

    // Submit
    const submitBtn = container.querySelector('.btn-book-appointment');
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'Booking failed: The requested time slot has just been reserved by another patient.'
      );
    });
  });

  // 8. Loading state while submitting
  it('displays loading state on submit button during appointment creation', async () => {
    const mockDates = [
      {
        date: '2026-11-20',
        dayOfWeek: 'Friday',
        startTime: '09:00',
        endTime: '11:00',
        price: 0,
        scheduleId: 'sched-101',
      },
    ];
    const mockSlots = [{ slot: '09:00 - 09:20', isBooked: false }];

    appointmentService.getAvailableDates.mockResolvedValue(mockDates);
    appointmentService.getAvailableSlots.mockResolvedValue(mockSlots);

    // Keep bookAppointment pending to inspect loading state
    let resolveBooking;
    appointmentService.bookAppointment.mockReturnValue(
      new Promise((resolve) => {
        resolveBooking = resolve;
      })
    );

    const { container } = render(<AppointmentsTab />);

    const vaccineSelect = await waitFor(() => {
      const el = container.querySelector('#select-vaccine');
      expect(el).toBeInTheDocument();
      return el;
    });
    fireEvent.change(vaccineSelect, { target: { value: 'COVID-19 mRNA Booster (Moderna)' } });

    const hospitalSelect = container.querySelector('#select-hospital');
    fireEvent.change(hospitalSelect, { target: { value: 'hosp-user-1' } });

    const calendarTrigger = await screen.findByText(/Click to select available date from calendar/i);
    fireEvent.click(calendarTrigger);

    const availableDateCell = await screen.findByTitle(/2026-11-20/i);
    fireEvent.click(availableDateCell);

    const slotOption = await screen.findByRole('option', { name: /^09:00 - 09:20/ });
    fireEvent.click(slotOption);

    const submitBtn = container.querySelector('.btn-book-appointment');
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });
    fireEvent.click(submitBtn);

    // Verify loading label is displayed while submitting
    await waitFor(() => {
      expect(submitBtn).toHaveTextContent('Processing Booking...');
      expect(submitBtn).toBeDisabled();
    });

    // Cleanup promise
    resolveBooking({ id: '1', status: 'Confirmed', fee: 0 });
  });

  // Modal Component test
  it('renders and submits BookAppointmentModal component with form data', async () => {
    vi.useFakeTimers();
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    const { container } = render(
      <BookAppointmentModal
        isOpen={true}
        onClose={handleClose}
        onBookSuccess={handleSuccess}
      />
    );

    expect(screen.getByText('Schedule Vaccination')).toBeInTheDocument();
    expect(container.querySelector('select[name="vaccine"]')).toBeInTheDocument();
    expect(container.querySelector('select[name="hospital"]')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Confirm Booking/i });
    fireEvent.click(submitBtn);

    // Shows success inside modal
    expect(screen.getByText(/Appointment Reserved!/i)).toBeInTheDocument();

    // Fast forward timer to trigger onBookSuccess and onClose
    vi.runAllTimers();
    expect(handleSuccess).toHaveBeenCalled();
    expect(handleClose).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
