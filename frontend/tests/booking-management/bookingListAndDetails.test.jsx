import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    confirmPayment: vi.fn(),
    initPayHere: vi.fn(),
  },
}));

describe('Booking Management - Booking List and Details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointmentService.getVaccinesWithHospitals.mockResolvedValue([]);

    // Default mock for fetch vaccines
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'v1',
          name: 'COVID-19 mRNA Booster (Moderna)',
          hospitals: [
            {
              id: 'h1',
              userId: 'hosp-user-1',
              name: 'National Hospital Colombo',
              district: 'Colombo 07',
            },
          ],
        },
      ],
    });
  });

  // 1. Booking list renders correctly
  it('renders appointments list with items when patient has bookings', async () => {
    const mockAppointments = [
      {
        id: 'apt-1',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate: '2026-11-15',
        timeSlot: '09:00 - 09:20',
        hospitalName: 'National Hospital Colombo',
        doctorName: 'Kamal Perera',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
      {
        id: 'apt-2',
        vaccineName: 'Hepatitis B (Recombinant)',
        appointmentDate: '2026-11-20',
        timeSlot: '10:30 - 10:50',
        hospitalName: 'Asiri Central Hospital',
        doctorName: 'Nimali Fernando',
        fee: 2500,
        paymentStatus: 'PendingPayment',
        status: 'PendingPayment',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointments);

    render(<AppointmentsTab />);

    // Table header should be visible
    expect(screen.getByText('Appointments', { selector: 'h2' })).toBeInTheDocument();

    // Verify appointments appear in list
    await waitFor(() => {
      expect(screen.getByText('COVID-19 mRNA Booster (Moderna)')).toBeInTheDocument();
      expect(screen.getByText('Hepatitis B (Recombinant)')).toBeInTheDocument();
    });

    // Check count of table rows
    const rows = screen.getAllByRole('row');
    // 1 header row + 2 appointment rows = 3 rows
    expect(rows.length).toBe(3);
  });

  it('renders empty state message when patient has zero bookings', async () => {
    appointmentService.getPatientAppointments.mockResolvedValue([]);

    render(<AppointmentsTab />);

    await waitFor(() => {
      expect(
        screen.getByText('No current appointments scheduled. Select a vaccine above to book your slot.')
      ).toBeInTheDocument();
    });
  });

  // 2. Booking details display correctly
  it('displays all booking details accurately including doctor, date, time slot, hospital, and fees', async () => {
    const mockAppointment = [
      {
        id: 'apt-detail-1',
        vaccineName: 'COVID-19 mRNA Booster (Moderna)',
        appointmentDate: '2026-12-05',
        timeSlot: '10:00 - 10:20',
        hospitalName: 'Teaching Hospital Kandy',
        doctorName: 'Anura Bandara',
        fee: 1500,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointment);

    render(<AppointmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('COVID-19 mRNA Booster (Moderna)')).toBeInTheDocument();
    });

    // Verify Doctor Name
    expect(screen.getByText('Dr. Anura Bandara')).toBeInTheDocument();

    // Verify Date
    expect(screen.getByText('2026-12-05')).toBeInTheDocument();

    // Verify Time Slot
    expect(screen.getByText('10:00 - 10:20')).toBeInTheDocument();

    // Verify Hospital Location
    expect(screen.getByText('Teaching Hospital Kandy')).toBeInTheDocument();

    // Verify Fee and Payment Badge
    expect(screen.getByText('LKR 1,500.00')).toBeInTheDocument();
    expect(screen.getByText('✓ Paid Online')).toBeInTheDocument();

    // Verify Status badge
    expect(document.querySelector('.apt-status-pill')).toHaveTextContent('Confirmed');
  });

  it('displays subsidized badge when fee is zero and payment due badge when unpaid', async () => {
    const mockAppointments = [
      {
        id: 'apt-free',
        vaccineName: 'Tetanus, Reduced Diphtheria (Td)',
        appointmentDate: '2026-12-10',
        timeSlot: '08:40 - 09:00',
        hospitalName: 'District General Hospital Galle',
        fee: 0,
        paymentStatus: 'Paid',
        status: 'Confirmed',
      },
      {
        id: 'apt-due',
        vaccineName: 'HPV 9-Valent (Gardasil 9)',
        appointmentDate: '2026-12-12',
        timeSlot: '11:00 - 11:20',
        hospitalName: 'Durdans Hospital',
        fee: 4500,
        paymentStatus: 'PendingPayment',
        status: 'PendingPayment',
      },
    ];

    appointmentService.getPatientAppointments.mockResolvedValue(mockAppointments);

    render(<AppointmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('✓ Subsidized')).toBeInTheDocument();
      expect(screen.getByText('Payment Due')).toBeInTheDocument();
      expect(screen.getByText('Free')).toBeInTheDocument();
      expect(screen.getByText('LKR 4,500.00')).toBeInTheDocument();
    });
  });

  // 8. Loading state is displayed while fetching
  it('displays loading state indicator while fetching appointments from database', async () => {
    // Return a promise that does not resolve immediately
    appointmentService.getPatientAppointments.mockReturnValue(new Promise(() => {}));

    render(<AppointmentsTab />);

    expect(
      screen.getByText('Loading your appointments from database...')
    ).toBeInTheDocument();
  });
});
