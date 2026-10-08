import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RestockVaccineModal from '../../src/features/hospital/components/RestockVaccineModal';

describe('RestockVaccineModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onAddStock: vi.fn(),
    registeredVaccines: ['Pfizer', 'Moderna'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <RestockVaccineModal {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the shipment heading when open', () => {
    render(<RestockVaccineModal {...defaultProps} />);
    expect(screen.getByText('Log Vaccine Restock Shipment')).toBeInTheDocument();
  });

  it('renders the vaccine product label', () => {
    render(<RestockVaccineModal {...defaultProps} />);
    expect(screen.getByText('Vaccine product *')).toBeInTheDocument();
  });

  it('renders the batch / lot number label', () => {
    render(<RestockVaccineModal {...defaultProps} />);
    expect(screen.getByText(/Batch \/ lot number/i)).toBeInTheDocument();
  });

  it('renders the quantity received label', () => {
    render(<RestockVaccineModal {...defaultProps} />);
    expect(screen.getByText(/Quantity received/i)).toBeInTheDocument();
  });

  it('renders the assigned cold vault label', () => {
    render(<RestockVaccineModal {...defaultProps} />);
    expect(screen.getByText(/Assigned cold vault/i)).toBeInTheDocument();
  });

  it('alerts when vaccine product name is empty on submit', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RestockVaccineModal {...defaultProps} />);

    const form = document.querySelector('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringMatching(/vaccine product name/i)
      );
    });
    alertSpy.mockRestore();
  });

  it('alerts when lot number is empty on submit', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RestockVaccineModal {...defaultProps} />);

    // Set the vaccine name via the select
    const select = document.querySelector('select[name="vaccineName"]');
    fireEvent.change(select, { target: { value: 'Pfizer' } });

    const form = document.querySelector('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Lot Number and Quantity/i)
      );
    });
    alertSpy.mockRestore();
  });

  it('alerts when storage unit is empty on submit', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RestockVaccineModal {...defaultProps} />);

    const select = document.querySelector('select[name="vaccineName"]');
    fireEvent.change(select, { target: { value: 'Pfizer' } });

    const lotInput = document.querySelector('input[name="lotNumber"]');
    fireEvent.change(lotInput, { target: { value: 'LOT-001' } });

    const qtyInput = document.querySelector('input[name="quantity"]');
    fireEvent.change(qtyInput, { target: { value: '100' } });

    const form = document.querySelector('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringMatching(/cold vault/i)
      );
    });
    alertSpy.mockRestore();
  });

  it('calls onAddStock with parsed quantity when the form is valid', async () => {
    const onAddStock = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <RestockVaccineModal
        {...defaultProps}
        onAddStock={onAddStock}
        onClose={onClose}
      />
    );

    fireEvent.change(document.querySelector('select[name="vaccineName"]'), {
      target: { value: 'Pfizer' },
    });
    fireEvent.change(document.querySelector('input[name="lotNumber"]'), {
      target: { value: 'LOT-001' },
    });
    fireEvent.change(document.querySelector('input[name="quantity"]'), {
      target: { value: '250' },
    });
    fireEvent.change(document.querySelector('select[name="storageUnit"]'), {
      target: { value: 'Chiller Unit B (2-8°C)' },
    });

    fireEvent.submit(document.querySelector('form'));

    await waitFor(() => {
      expect(onAddStock).toHaveBeenCalledTimes(1);
    });

    const payload = onAddStock.mock.calls[0][0];
    expect(payload.vaccineName).toBe('Pfizer');
    expect(payload.lotNumber).toBe('LOT-001');
    expect(payload.quantity).toBe(250);
    expect(typeof payload.quantity).toBe('number');
    expect(payload.storageUnit).toContain('Chiller');
  });

  it('calls onClose after a successful submit', async () => {
    const onAddStock = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <RestockVaccineModal
        {...defaultProps}
        onAddStock={onAddStock}
        onClose={onClose}
      />
    );

    fireEvent.change(document.querySelector('select[name="vaccineName"]'), {
      target: { value: 'Pfizer' },
    });
    fireEvent.change(document.querySelector('input[name="lotNumber"]'), {
      target: { value: 'LOT-X' },
    });
    fireEvent.change(document.querySelector('input[name="quantity"]'), {
      target: { value: '10' },
    });
    fireEvent.change(document.querySelector('select[name="storageUnit"]'), {
      target: { value: 'Chiller Unit B (2-8°C)' },
    });

    fireEvent.submit(document.querySelector('form'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});