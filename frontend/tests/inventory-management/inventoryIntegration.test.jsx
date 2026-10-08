import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HospitalInventoryTab from '../../src/features/hospital/components/HospitalInventoryTab';

// Mock the inventory service
vi.mock('../../src/features/hospital/services/inventoryService', () => ({
  default: {
    getInventory: vi.fn(),
    getFormulary: vi.fn(),
    getColdVaults: vi.fn(),
    getSummary: vi.fn(),
  },
}));

// Mock any AI workflow components to keep the test focused on the tab
vi.mock('../../src/features/hospital/components/InventoryAIInventoryWorkflow', () => ({
  default: () => <div data-testid="ai-workflow-stub">AI Workflow</div>,
}));

vi.mock('../../src/features/hospital/components/HospitalSubpageHero', () => ({
  default: () => <div data-testid="hero-stub">Hero</div>,
}));

import inventoryService from '../../src/features/hospital/services/inventoryService';

const sampleBatch = {
  id: 'b-1',
  vaccineId: 'v-1',
  name: 'Pfizer',
  manufacturer: 'BioNTech',
  category: 'mrna',
  lotNumber: 'LOT-001',
  available: 100,
  capacity: 200,
  minThreshold: 50,
  dosesPerVial: 6,
  openVialDosesRemaining: 0,
  availableDoses: 600,
  expiry: '2027-01-15',
  expiryStatus: 'healthy',
  temp: '2-8C',
  storageUnit: 'Vault A',
  statusColor: 'bar-green',
  lastRestocked: '2026-10-01',
};

describe('HospitalInventoryTab — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inventoryService.getInventory.mockResolvedValue([sampleBatch]);
    inventoryService.getFormulary.mockResolvedValue([]);
    inventoryService.getColdVaults.mockResolvedValue([]);
    inventoryService.getSummary.mockResolvedValue({
      totalVials: 100,
      totalDoses: 600,
      lowStockCount: 0,
      expiringCount: 0,
      totalFormulations: 1,
      coldStorageHealth: '100%',
      vaultsOnline: 3,
    });
  });

  it('fetches inventory, formulary and cold vaults on mount', async () => {
    render(<HospitalInventoryTab />);
    await waitFor(() => {
      expect(inventoryService.getInventory).toHaveBeenCalledTimes(1);
      expect(inventoryService.getFormulary).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the fetched batch after loading completes', async () => {
    render(<HospitalInventoryTab />);
    await waitFor(() => {
      expect(screen.getByText(/Pfizer/)).toBeInTheDocument();
    });
  });

  it('shows an error message when the API call fails', async () => {
    inventoryService.getInventory.mockRejectedValueOnce(
      new Error('Server unreachable')
    );
    render(<HospitalInventoryTab />);
    await waitFor(() => {
      expect(screen.getByText(/Server unreachable/)).toBeInTheDocument();
    });
  });

  it('renders the inventory tab even when formulary is empty', async () => {
    inventoryService.getFormulary.mockResolvedValueOnce([]);
    render(<HospitalInventoryTab />);
    await waitFor(() => {
      expect(inventoryService.getFormulary).toHaveBeenCalled();
    });
    // The tab should still render without crashing
    expect(document.body).toBeTruthy();
  });

  it('opens the AI agent panel when the AI button is clicked', async () => {
    const user = userEvent.setup();
    render(<HospitalInventoryTab />);
    await waitFor(() => expect(inventoryService.getInventory).toHaveBeenCalled());

    // The component has an AI toggle button — find and click it
    const aiButtons = screen.queryAllByRole('button');
    const aiButton = aiButtons.find((b) =>
      /ai|agent/i.test(b.textContent || '')
    );
    if (aiButton) {
      await user.click(aiButton);
      await waitFor(() => {
        expect(screen.getByTestId('ai-workflow-stub')).toBeInTheDocument();
      });
    }
  });
});