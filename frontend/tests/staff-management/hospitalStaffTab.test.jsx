import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HospitalStaffTab from '../../src/features/hospital/components/HospitalStaffTab';
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

    render(<HospitalStaffTab />);

    expect(await screen.findByRole('heading', { name: /hospital medical staff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add new staff/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Dr Nimal Perera')).toBeInTheDocument();
      expect(screen.getByText('Nurse Amaya Fernando')).toBeInTheDocument();
      expect(screen.getByText('Pending Request')).toBeInTheDocument();
    });

    expect(screen.getByText('Active Affiliated Staff')).toBeInTheDocument();
  });

  it('shows empty-state messaging when hospital has no affiliated staff', async () => {
    staffService.getHospitalStaff.mockResolvedValue([]);

    render(<HospitalStaffTab />);

    expect(
      await screen.findByText(/no staff yet\. invite an approved doctor or nurse/i)
    ).toBeInTheDocument();
  });

  it('switches between Directory, Shifts, and Cover requests views', async () => {
    staffService.getHospitalStaff.mockResolvedValue([]);

    render(<HospitalStaffTab />);
    await waitFor(() => expect(staffService.getHospitalStaff).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: /shifts/i }));
    expect(screen.getByTestId('shifts-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /cover requests/i }));
    expect(screen.getByTestId('covers-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /directory/i }));
    expect(screen.getByRole('button', { name: /add new staff/i })).toBeInTheDocument();
  });

  it('opens the add-staff modal from the directory toolbar', async () => {
    staffService.getHospitalStaff.mockResolvedValue([]);

    render(<HospitalStaffTab />);
    await waitFor(() => expect(staffService.getHospitalStaff).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /add new staff/i }));
    expect(screen.getByRole('heading', { name: /add new staff/i })).toBeInTheDocument();
  });
});
