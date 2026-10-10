import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import HospitalCoverRequestsPanel from '../../src/features/hospital/components/HospitalCoverRequestsPanel';
import staffService from '../../src/features/hospital/services/staffService';

vi.mock('../../src/features/hospital/services/staffService', () => ({
  default: {
    getHospitalShiftSwaps: vi.fn(),
    rankShiftSwap: vi.fn(),
    decideShiftSwap: vi.fn(),
  },
}));

// Freeze the hospital clock at 2026-10-07 10:00 so "has the shift started?" is deterministic.
vi.mock('../../src/features/hospital/utils/hospitalDate', () => ({
  hospitalToday: () => '2026-10-07',
  hospitalMinutesNow: () => 10 * 60,
}));

const suggestions = [
  { affiliationId: 'aff-a', staffName: 'Dr. Alwis', staffRole: 'DOCTOR', why: 'Same role · free', available: true },
  { affiliationId: 'aff-b', staffName: 'Dr. Bandara', staffRole: 'DOCTOR', why: 'Same role · free', available: true },
];

function request(overrides = {}) {
  return {
    id: 'req-1',
    requesterName: 'Dr. Silva',
    requesterRole: 'DOCTOR',
    shiftDate: '2026-10-09',
    shiftWindow: '09:00–12:00',
    status: 'Pending',
    suggestions,
    ...overrides,
  };
}

async function renderWith(requests) {
  staffService.getHospitalShiftSwaps.mockResolvedValue(requests);
  render(<HospitalCoverRequestsPanel />);
  await screen.findByText('Dr. Silva');
}

describe('Staff Management - Hospital cover requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps Assign disabled until a replacement is picked (normal)', async () => {
    staffService.decideShiftSwap.mockResolvedValue(request({ status: 'Approved', replacementName: 'Dr. Alwis' }));
    await renderWith([request()]);

    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(assign).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /Dr\. Alwis/ }));
    expect(assign).toBeEnabled();

    fireEvent.click(assign);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign cover' }));
    await waitFor(() =>
      expect(staffService.decideShiftSwap).toHaveBeenCalledWith('req-1', {
        approved: true,
        replacementAffiliationId: 'aff-a',
      })
    );
  });

  it('blocks assigning a shift that starts exactly now (boundary)', async () => {
    await renderWith([request({ shiftDate: '2026-10-07', shiftWindow: '10:00–13:00' })]);

    fireEvent.click(screen.getByRole('radio', { name: /Dr\. Alwis/ }));

    expect(screen.getByRole('button', { name: 'Shift started' })).toBeDisabled();
    expect(screen.getByText(/already started/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rank with AI' })).not.toBeInTheDocument();
  });

  it('still allows assigning one minute before the shift starts (boundary)', async () => {
    await renderWith([request({ shiftDate: '2026-10-07', shiftWindow: '10:01–13:00' })]);

    fireEvent.click(screen.getByRole('radio', { name: /Dr\. Alwis/ }));

    expect(screen.getByRole('button', { name: 'Assign' })).toBeEnabled();
  });

  it('re-orders replacements and shows the chip after Rank with AI (normal)', async () => {
    staffService.rankShiftSwap.mockResolvedValue(
      request({
        aiRanked: true,
        suggestions: [
          { ...suggestions[1], why: 'Pediatrics match, lightest day' },
          suggestions[0],
        ],
      })
    );
    await renderWith([request()]);

    fireEvent.click(screen.getByRole('button', { name: 'Rank with AI' }));

    expect(await screen.findByText('Ranked by AI')).toBeInTheDocument();
    const options = screen.getAllByRole('radio');
    expect(within(options[0]).getByText('Dr. Bandara')).toBeInTheDocument();
    expect(screen.getByText('Pediatrics match, lightest day')).toBeInTheDocument();
  });

  it('keeps roster order with a note when the AI cannot rank (failure)', async () => {
    staffService.rankShiftSwap.mockRejectedValue(new Error('Failed to rank replacements.'));
    await renderWith([request()]);

    fireEvent.click(screen.getByRole('button', { name: 'Rank with AI' }));

    expect(await screen.findByText('Failed to rank replacements.')).toBeInTheDocument();
    expect(screen.queryByText('Ranked by AI')).not.toBeInTheDocument();
    const options = screen.getAllByRole('radio');
    expect(within(options[0]).getByText('Dr. Alwis')).toBeInTheDocument();
  });

  it('explains when the agent answers but could not rank (invalid AI output)', async () => {
    staffService.rankShiftSwap.mockResolvedValue(request({ aiRanked: false }));
    await renderWith([request()]);

    fireEvent.click(screen.getByRole('button', { name: 'Rank with AI' }));

    expect(await screen.findByText(/showing roster order/i)).toBeInTheDocument();
  });

  it('hides Rank with AI when there is only one possible replacement (edge)', async () => {
    await renderWith([request({ suggestions: [suggestions[0]] })]);

    expect(screen.queryByRole('button', { name: 'Rank with AI' })).not.toBeInTheDocument();
  });

  it('shows a Cancelled badge for requests closed by a removed shift', async () => {
    await renderWith([request(), request({ id: 'req-2', requesterName: 'Dr. Perera', status: 'Cancelled' })]);

    fireEvent.click(screen.getByRole('button', { name: /^All \(/ }));

    const cancelledCard = (await screen.findByText('Dr. Perera')).closest('article');
    expect(within(cancelledCard).getByText('Cancelled')).toBeInTheDocument();
    expect(within(cancelledCard).queryByText('Needs review')).not.toBeInTheDocument();
  });

  it('shows an error when the inbox cannot load (failure)', async () => {
    staffService.getHospitalShiftSwaps.mockRejectedValue(new Error('Session expired. Please log in again.'));
    render(<HospitalCoverRequestsPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  });
});
