import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HospitalStaffTab from '../../src/features/hospital/components/HospitalStaffTab';
import HospitalRosterTab from '../../src/features/hospital/components/HospitalRosterTab';
import HospitalSessionsPage from '../../src/features/hospital/components/HospitalSessionsPage';
import HospitalAppointmentsPage from '../../src/features/hospital/components/HospitalAppointmentsPage';
import staffService from '../../src/features/hospital/services/staffService';

vi.mock('../../src/features/hospital/services/staffService', () => ({
  default: {
    getHospitalStaff: vi.fn(),
    getHospitalShiftSwaps: vi.fn(),
    inviteStaff: vi.fn(),
    removeAffiliation: vi.fn(),
  },
}));

vi.mock('../../src/features/hospital/components/HospitalShiftsPanel', () => ({
  default: () => <div data-testid="shifts-panel">Shifts Panel</div>,
}));

vi.mock('../../src/features/hospital/components/HospitalCoverRequestsPanel', () => ({
  default: () => <div data-testid="covers-panel">Cover Requests Panel</div>,
}));

vi.mock('../../src/features/hospital/components/HospitalBoothsPanel', () => ({
  default: () => <div data-testid="booths-panel">Booths Panel</div>,
}));

vi.mock('../../src/features/hospital/components/HospitalAppointmentsTab', () => ({
  default: ({ view }) => <div data-testid={`appointments-${view}`}>{view}</div>,
}));

vi.mock('../../src/features/hospital/components/HospitalDashboardOverview', () => ({
  default: ({ view }) => <div data-testid={`dashboard-${view}`}>{view}</div>,
}));

function renderInRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Staff Management - Hospital Staff Directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staffService.getHospitalShiftSwaps.mockResolvedValue([]);
  });

  it('renders staff directory hero, metrics, and roster cards', async () => {
    staffService.getHospitalStaff.mockResolvedValue([
      {
        affiliationId: 'aff-1',
        staffName: 'Dr Nimal Perera',
        staffRegistrationNumber: 'VAX-D-1001',
        staffRole: 'DOCTOR',
        specialization: 'Pediatrics',
        email: 'nimal@vaxora.lk',
        phoneNumber: '0771234567',
        status: 'Active',
        isOnDutyNow: true,
      },
      {
        affiliationId: 'aff-2',
        staffName: 'Nurse Amaya Fernando',
        staffRegistrationNumber: 'VAX-N-1002',
        staffRole: 'NURSE',
        specialization: null,
        email: 'amaya@vaxora.lk',
        phoneNumber: '0777654321',
        status: 'Pending',
        isOnDutyNow: false,
      },
    ]);

    renderInRouter(<HospitalStaffTab />);

    expect(await screen.findByRole('heading', { name: /medical staff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add new staff/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^directory$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pending invites/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /all \(/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /doctors \(/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nurses \(/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Dr Nimal Perera')).toBeInTheDocument();
    });
    expect(screen.queryByText('Nurse Amaya Fernando')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /pending invites/i }));
    expect(await screen.findByText('Nurse Amaya Fernando')).toBeInTheDocument();
    expect(screen.getByText('Pending Request')).toBeInTheDocument();

    expect(screen.getByText('Active Affiliated Staff')).toBeInTheDocument();
  });

  it('shows empty-state messaging when hospital has no affiliated staff', async () => {
    staffService.getHospitalStaff.mockResolvedValue([]);

    renderInRouter(<HospitalStaffTab />);

    expect(
      await screen.findByText(/no staff yet\. invite an approved doctor or nurse/i)
    ).toBeInTheDocument();
  });

  it('sessions page switches between Sessions and Booths views', () => {
    renderInRouter(<HospitalSessionsPage />);
    expect(screen.getByTestId('appointments-sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /booths/i }));
    expect(screen.getByTestId('booths-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /sessions/i }));
    expect(screen.getByTestId('appointments-sessions')).toBeInTheDocument();
  });

  it('appointments page opens on Today and switches to Bookings', () => {
    renderInRouter(<HospitalAppointmentsPage />);
    expect(screen.getByTestId('dashboard-queue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /bookings/i }));
    expect(screen.getByTestId('appointments-bookings')).toBeInTheDocument();
  });

  it('roster page switches between Shifts and Cover requests and badges pending covers', async () => {
    staffService.getHospitalShiftSwaps.mockResolvedValue([{ status: 'Pending' }, { status: 'Pending' }]);

    renderInRouter(<HospitalRosterTab />);
    expect(screen.getByTestId('shifts-panel')).toBeInTheDocument();

    const coverTab = screen.getByRole('tab', { name: /cover requests/i });
    await waitFor(() => expect(coverTab).toHaveTextContent('2'));

    fireEvent.click(coverTab);
    expect(screen.getByTestId('covers-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /shifts/i }));
    expect(screen.getByTestId('shifts-panel')).toBeInTheDocument();
  });

  it('opens the add-staff modal from the directory toolbar', async () => {
    staffService.getHospitalStaff.mockResolvedValue([]);

    renderInRouter(<HospitalStaffTab />);
    await waitFor(() => expect(staffService.getHospitalStaff).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /add new staff/i }));
    expect(screen.getByRole('heading', { name: /add new staff/i })).toBeInTheDocument();
  });
});
