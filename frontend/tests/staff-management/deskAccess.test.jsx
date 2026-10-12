import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../../src/routes/ProtectedRoute';
import DeskAccountsPanel from '../../src/features/desk/components/DeskAccountsPanel';
import deskService from '../../src/features/desk/services/deskService';

vi.mock('../../src/features/desk/services/deskService', () => ({
  default: {
    getDeskAccounts: vi.fn(),
    createDeskAccount: vi.fn(),
    removeDeskAccount: vi.fn(),
  },
}));

function signInAs(role) {
  localStorage.setItem('vaxora_token', 'valid-jwt');
  localStorage.setItem('vaxora_user', JSON.stringify({ id: 'user-1', role, status: 'Active' }));
}

function renderRoutes(initialRoute) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route
          path="/desk"
          element={
            <ProtectedRoute allowedRoles={['FRONT_DESK']}>
              <div data-testid="desk-portal">Desk Portal</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/hospital/staff"
          element={
            <ProtectedRoute allowedRoles={['HOSPITAL', 'ADMIN']}>
              <div data-testid="hospital-staff-content">Hospital Staff Page</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
        <Route path="/hospital/dashboard" element={<div data-testid="hospital-dashboard">Hospital Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Front Desk - Route Access', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lets a front desk user open the desk portal', () => {
    signInAs('FRONT_DESK');
    renderRoutes('/desk');

    expect(screen.getByTestId('desk-portal')).toBeInTheDocument();
  });

  it('sends a front desk user back to the desk portal from hospital management pages', () => {
    signInAs('FRONT_DESK');
    renderRoutes('/hospital/staff');

    expect(screen.queryByTestId('hospital-staff-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-portal')).toBeInTheDocument();
  });

  it('keeps a hospital manager out of the desk portal', () => {
    signInAs('HOSPITAL');
    renderRoutes('/desk');

    expect(screen.queryByTestId('desk-portal')).not.toBeInTheDocument();
    expect(screen.getByTestId('hospital-dashboard')).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor from the desk portal to login', () => {
    renderRoutes('/desk');

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });
});

describe('Front Desk - Desk Accounts Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the hospital desk accounts', async () => {
    deskService.getDeskAccounts.mockResolvedValue([
      { affiliationId: 'aff-1', userId: 'u-1', email: 'reception@hospital.lk', registrationNumber: 'VAX-F-A1B2C3', lastLoginAt: null },
    ]);

    render(<DeskAccountsPanel />);

    expect(await screen.findByText('reception@hospital.lk')).toBeInTheDocument();
    expect(screen.getByText('VAX-F-A1B2C3')).toBeInTheDocument();
    expect(screen.getByText('Never signed in')).toBeInTheDocument();
  });

  it('shows an empty state when there are no desk accounts', async () => {
    deskService.getDeskAccounts.mockResolvedValue([]);

    render(<DeskAccountsPanel />);

    expect(await screen.findByText('No front desk accounts yet.')).toBeInTheDocument();
  });

  it('creates a desk account and reloads the list', async () => {
    deskService.getDeskAccounts.mockResolvedValue([]);
    deskService.createDeskAccount.mockResolvedValue({ affiliationId: 'aff-2' });

    render(<DeskAccountsPanel />);
    await screen.findByText('No front desk accounts yet.');

    fireEvent.click(screen.getByRole('button', { name: /Add Desk Account/i }));
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: ' John Smith ' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0771234567' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: ' desk@hospital.lk ' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() =>
      expect(deskService.createDeskAccount).toHaveBeenCalledWith({
        fullName: 'John Smith',
        phoneNumber: '0771234567',
        email: 'desk@hospital.lk',
        password: 'secret12',
      })
    );
    await waitFor(() => expect(deskService.getDeskAccounts).toHaveBeenCalledTimes(2));
  });

  it('requires a full name before calling the API', async () => {
    deskService.getDeskAccounts.mockResolvedValue([]);

    render(<DeskAccountsPanel />);
    await screen.findByText('No front desk accounts yet.');

    fireEvent.click(screen.getByRole('button', { name: /Add Desk Account/i }));
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'desk@hospital.lk' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText("Enter the staff member's full name.")).toBeInTheDocument();
    expect(deskService.createDeskAccount).not.toHaveBeenCalled();
  });

  it('rejects a short password before calling the API', async () => {
    deskService.getDeskAccounts.mockResolvedValue([]);

    render(<DeskAccountsPanel />);
    await screen.findByText('No front desk accounts yet.');

    fireEvent.click(screen.getByRole('button', { name: /Add Desk Account/i }));
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'John Smith' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'desk@hospital.lk' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText('Password must be at least 6 characters.')).toBeInTheDocument();
    expect(deskService.createDeskAccount).not.toHaveBeenCalled();
  });

  it('shows the server message when creating an account fails', async () => {
    deskService.getDeskAccounts.mockResolvedValue([]);
    deskService.createDeskAccount.mockRejectedValue(new Error('An account with this email already exists.'));

    render(<DeskAccountsPanel />);
    await screen.findByText('No front desk accounts yet.');

    fireEvent.click(screen.getByRole('button', { name: /Add Desk Account/i }));
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'John Smith' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'taken@hospital.lk' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  });

  it('removes a desk account after confirmation', async () => {
    deskService.getDeskAccounts.mockResolvedValue([
      { affiliationId: 'aff-1', userId: 'u-1', email: 'reception@hospital.lk', registrationNumber: 'VAX-F-A1B2C3', lastLoginAt: null },
    ]);
    deskService.removeDeskAccount.mockResolvedValue({});

    render(<DeskAccountsPanel />);
    await screen.findByText('reception@hospital.lk');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByText(/They will be signed out/);
    fireEvent.click(document.querySelector('.confirm-modal-btn.confirm'));

    await waitFor(() => expect(deskService.removeDeskAccount).toHaveBeenCalledWith('aff-1'));
  });
});
