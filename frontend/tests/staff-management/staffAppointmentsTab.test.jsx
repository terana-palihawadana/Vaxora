import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StaffAppointmentsTab from '../../src/features/staff/components/StaffAppointmentsTab';
import staffService from '../../src/features/hospital/services/staffService';
import staffAppointmentService from '../../src/features/staff/services/staffAppointmentService';

vi.mock('../../src/features/hospital/services/staffService', () => ({
  default: { getMyAffiliations: vi.fn() },
}));

vi.mock('../../src/features/staff/services/staffAppointmentService', () => ({
  default: { getHospitalAppointments: vi.fn() },
}));

// Hospital calendar frozen on 2026-10-11.
vi.mock('../../src/features/hospital/utils/hospitalDate', async (importOriginal) => ({
  ...(await importOriginal()),
  hospitalToday: () => '2026-10-11',
}));

function appt(id, startTime, patientName, status, extra = {}) {
  return {
    id,
    startTime,
    timeSlot: `${startTime} AM`,
    patientName,
    vaccineName: 'Hepatitis B',
    boothLabel: 'B01 · Adult',
    status,
    ...extra,
  };
}

const day = [
  appt('a3', '10:40', 'Chamari', 'Administering'),
  appt('a1', '09:00', 'Anne', 'Completed'),
  appt('a2', '10:00', 'Bimal', 'Confirmed', { checkedInAt: '2026-10-11T04:00:00Z' }),
  appt('a4', '11:00', 'Dilan', 'PendingPayment'),
];

async function renderPage(path = '/nurse/appointments') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <StaffAppointmentsTab />
    </MemoryRouter>
  );
  await screen.findByRole('list', { name: 'Appointments' });
}

function patientNames() {
  const list = screen.getByRole('list', { name: 'Appointments' });
  return within(list)
    .getAllByRole('listitem') // the header row is aria-hidden
    .map((row) => row.querySelector('.staff-appt-name').textContent);
}

describe('Staff Management - Appointments page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staffService.getMyAffiliations.mockResolvedValue([
      { hospitalUserId: 'h1', hospitalName: 'Test Hospital', isOnDutyNow: false },
    ]);
    staffAppointmentService.getHospitalAppointments.mockResolvedValue(day);
  });

  it("lists today's bookings in time order with their status (normal)", async () => {
    await renderPage();

    expect(staffAppointmentService.getHospitalAppointments).toHaveBeenCalledWith('h1', '2026-10-11');
    expect(patientNames()).toEqual(['Anne', 'Bimal', 'Chamari', 'Dilan']);
    expect(screen.getByText('Checked in')).toBeTruthy();
    expect(screen.getByText('Awaiting payment')).toBeTruthy();
  });

  it('filters by status and shows a count on each filter (normal)', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Upcoming (3)' }));
    expect(patientNames()).toEqual(['Bimal', 'Chamari', 'Dilan']);

    fireEvent.click(screen.getByRole('button', { name: 'Completed (1)' }));
    expect(patientNames()).toEqual(['Anne']);

    // The API never returns cancelled bookings, so there is no filter for them.
    expect(screen.queryByRole('button', { name: /cancelled/i })).toBeNull();
  });

  it('searches by patient name (normal)', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Search appointments'), { target: { value: 'anne' } });
    expect(patientNames()).toEqual(['Anne']);
  });

  it('opens the day from ?date and stops at tomorrow (boundary)', async () => {
    await renderPage('/nurse/appointments?date=2026-10-12');
    expect(staffAppointmentService.getHospitalAppointments).toHaveBeenCalledWith('h1', '2026-10-12');
    expect(screen.getByText(/^Tomorrow ·/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() =>
      expect(staffAppointmentService.getHospitalAppointments).toHaveBeenCalledWith('h1', '2026-10-11')
    );
  });

  it('stops at yesterday (boundary)', async () => {
    await renderPage('/nurse/appointments?date=2026-10-10');
    expect(staffAppointmentService.getHospitalAppointments).toHaveBeenCalledWith('h1', '2026-10-10');
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
  });

  it('falls back to today for a ?date outside the session window (invalid)', async () => {
    await renderPage('/nurse/appointments?date=2026-10-14');
    expect(staffAppointmentService.getHospitalAppointments).toHaveBeenCalledWith('h1', '2026-10-11');
  });

  it('falls back to today for a malformed ?date (invalid)', async () => {
    await renderPage('/nurse/appointments?date=tomorrow');
    expect(staffAppointmentService.getHospitalAppointments).toHaveBeenCalledWith('h1', '2026-10-11');
  });

  it('shows an empty state for a day with no bookings (edge)', async () => {
    staffAppointmentService.getHospitalAppointments.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/nurse/appointments']}>
        <StaffAppointmentsTab />
      </MemoryRouter>
    );

    expect(await screen.findByText('No appointments booked for today.')).toBeTruthy();
  });
});
