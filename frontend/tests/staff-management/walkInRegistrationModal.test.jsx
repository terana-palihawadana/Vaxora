import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WalkInRegistrationModal from '../../src/features/hospital/components/WalkInRegistrationModal';

// The modal resets itself just after opening, so let that settle before typing.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function renderModal(props = {}) {
  return (
    <WalkInRegistrationModal
      isOpen
      onClose={vi.fn()}
      onAddPatient={vi.fn()}
      vaccines={['Influenza Quadrivalent', 'Hepatitis B Recombinant']}
      vaccinePrices={{}}
      booths={[]}
      {...props}
    />
  );
}

describe('Staff Management - Walk-In Registration Modal', () => {
  it('keeps typed details when the queue page re-renders', async () => {
    const { rerender } = render(renderModal());
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/kasun chamara/i), { target: { value: 'Nimal Perera' } });

    // The parent builds a fresh vaccine array on every render.
    rerender(renderModal());
    await settle();

    expect(screen.getByPlaceholderText(/kasun chamara/i)).toHaveValue('Nimal Perera');
  });

  it('clears the form when it is reopened', async () => {
    const { rerender } = render(renderModal());
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/kasun chamara/i), { target: { value: 'Nimal Perera' } });

    rerender(renderModal({ isOpen: false }));
    await settle();
    rerender(renderModal());

    await waitFor(() => expect(screen.getByPlaceholderText(/kasun chamara/i)).toHaveValue(''));
  });
});
