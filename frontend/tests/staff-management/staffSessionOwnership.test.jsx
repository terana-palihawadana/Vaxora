import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StaffClinicalDashboard from '../../src/features/staff/components/StaffClinicalDashboard';
import staffService from '../../src/features/hospital/services/staffService';
import staffAppointmentService from '../../src/features/staff/services/staffAppointmentService';

vi.mock('../../src/features/hospital/services/staffService', () => ({
  default: {
    getMyAffiliations: vi.fn(),
    getMyShifts: vi.fn(),
    updateDutyStatus: vi.fn(),
  },
}));

vi.mock('../../src/features/hospital/services/inventoryService', () => ({
  default: { getInventory: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/features/staff/services/staffAppointmentService', () => ({
  default: {
    getHospitalAppointments: vi.fn(),
    getPatientContact: vi.fn().mockResolvedValue({ patientNic: '199912345678' }),
    takeOverSession: vi.fn(),
    updateAppointmentStatus: vi.fn(),
    checkIn: vi.fn(),
    reportAefi: vi.fn(),
  },
}));

vi.mock('../../src/features/auth/services/authService', () => ({
  getUser: () => ({ id: 'me', role: 'NURSE', name: 'Me' }),
}));

// Hospital clock frozen at 10:00 so the 08:00-17:00 shift is live.
vi.mock('../../src/features/hospital/utils/hospitalDate', () => ({
  hospitalToday: () => '2026-10-11',
  hospitalMinutesNow: () => 10 * 60,
  addHospitalDays: (d) => d,
}));

const Stub = () => null;

function affiliation(onDuty) {
  return {
    affiliationId: 'aff-1',
    hospitalUserId: 'h1',
    hospitalName: 'Test Hospital',
    isOnDutyNow: onDuty,
    isClockedIn: onDuty,
    dutyStatus: onDuty ? 'OnDuty' : 'OffDuty',
  };
}

function shiftAt(boothId, label) {
  return { affiliationId: 'aff-1', startTime: '08:00', endTime: '17:00', boothId, boothOrStation: label };
}

// Anne is being administered at B01, called in by a colleague.
const colleagueSession = {
  id: 'appt-1',
  patientName: 'Anne Smith',
  vaccineName: 'Hepatitis B',
  status: 'Administering',
  paymentStatus: 'Paid',
  prescribedDosage: '0.5ml',
  checkedInAt: '2026-10-11T04:00:00Z',
  boothId: 'b01',
  boothLabel: 'B01 · Adult',
  sessionStaffUserId: 'colleague',
  sessionStaffName: 'Nurse Kavindi',
  timeSlot: '10:00 AM - 10:20 AM',
};

async function renderDashboard({ onDuty, shifts }) {
  staffService.getMyAffiliations.mockResolvedValue([affiliation(onDuty)]);
  staffService.getMyShifts.mockResolvedValue(shifts);
  staffAppointmentService.getHospitalAppointments.mockResolvedValue([colleagueSession]);
  render(
    <MemoryRouter>
      <StaffClinicalDashboard
        formatTitle={() => 'Nurse Me'}
        heroImage=""
        spotlightBadge="Active Immunization Station"
        AdministerModal={Stub}
        AefiModal={Stub}
      />
    </MemoryRouter>
  );
  // Summary card counts appear once today's appointments have loaded.
  await screen.findByText('1 booked · 1 left');
}

describe('Staff Management - Live session ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows no spotlight to off-duty staff and offers no take over (edge)', async () => {
    await renderDashboard({ onDuty: false, shifts: [] });

    expect(screen.queryByText('Active Immunization Station')).toBeNull();
    expect(screen.getByText('With B01 · Nurse Kavindi')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
    expect(staffAppointmentService.getPatientContact).not.toHaveBeenCalled();
  });

  it("hides a colleague's session from staff at another booth (normal)", async () => {
    await renderDashboard({ onDuty: true, shifts: [shiftAt('b02', 'B02 · Child')] });
    fireEvent.click(screen.getByRole('button', { name: 'All booths' }));

    expect(screen.queryByText('Active Immunization Station')).toBeNull();
    expect(screen.getByText('With B01 · Nurse Kavindi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take over' })).toBeTruthy();
  });

  it('shares the session with the booth partner (normal)', async () => {
    await renderDashboard({ onDuty: true, shifts: [shiftAt('b01', 'B01 · Adult')] });

    expect(await screen.findByText('Active Immunization Station')).toBeTruthy();
    expect(screen.queryByText('With B01 · Nurse Kavindi')).toBeNull();
  });

  it('takes over after confirmation, keeping the current status (normal)', async () => {
    staffAppointmentService.takeOverSession.mockResolvedValue({});
    await renderDashboard({ onDuty: true, shifts: [shiftAt('b02', 'B02 · Child')] });
    fireEvent.click(screen.getByRole('button', { name: 'All booths' }));

    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take over' }));

    await waitFor(() =>
      expect(staffAppointmentService.takeOverSession).toHaveBeenCalledWith('appt-1', 'Administering')
    );
  });
});
