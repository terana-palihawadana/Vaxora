import { describe, it, expect, vi, beforeEach } from 'vitest';

// localStorage shim (Vitest runs in Node, not a browser)


const importService = async () =>
  (await import('../../src/features/hospital/services/inventoryService.js')).inventoryService;

const mockOk = (data, status = 200) => ({
  ok: true,
  status,
  headers: { get: () => 'application/json' },
  json: async () => data,
});

describe('inventoryService — endpoint contracts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.clear();
  });

  // ----- Vaccines -----
  it('getGlobalVaccines calls GET /inventory/vaccines', async () => {
    global.fetch.mockResolvedValueOnce(mockOk([]));
    const svc = await importService();
    await svc.getGlobalVaccines();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/vaccines');
    expect(opts.method).toBe('GET');
  });

  // ----- Formulary -----
  it('getFormulary calls GET /inventory/formulary', async () => {
    global.fetch.mockResolvedValueOnce(mockOk([]));
    const svc = await importService();
    await svc.getFormulary();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/formulary');
    expect(opts.method).toBe('GET');
  });

  it('registerFormulary POSTs the payload', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({ id: 'f-1' }, 201));
    const svc = await importService();
    await svc.registerFormulary('Pfizer', 'BioNTech', 1500, 'mrna');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/formulary');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.vaccineName).toBe('Pfizer');
    expect(body.manufacturer).toBe('BioNTech');
    expect(body.price).toBe(1500);
    expect(body.category).toBe('mrna');
  });

  it('updateFormularyPrice PATCHes the price endpoint', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({}));
    const svc = await importService();
    await svc.updateFormularyPrice('f-1', 750, 'mrna');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/formulary/f-1/price');
    expect(opts.method).toBe('PATCH');
    const body = JSON.parse(opts.body);
    expect(body.price).toBe(750);
    expect(body.category).toBe('mrna');
  });

  it('removeFormulary DELETEs the formulary entry', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({}));
    const svc = await importService();
    await svc.removeFormulary('f-9');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/formulary/f-9');
    expect(opts.method).toBe('DELETE');
  });

  // ----- Batches -----
  it('getInventory without a hospital id adds no query string', async () => {
    global.fetch.mockResolvedValueOnce(mockOk([]));
    const svc = await importService();
    await svc.getInventory();
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/batches');
    expect(url).not.toContain('hospitalUserId');
  });

  it('getInventory with a hospital id adds the query string', async () => {
    global.fetch.mockResolvedValueOnce(mockOk([]));
    const svc = await importService();
    await svc.getInventory('hosp-123');
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('hospitalUserId=hosp-123');
  });

  it('restockBatch POSTs quantity coerced to a number', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({ id: 'b-1' }, 201));
    const svc = await importService();
    await svc.restockBatch({
      vaccineName: 'Pfizer',
      lotNumber: 'LOT-001',
      quantity: '100',
      storageUnit: 'Vault A',
      expiryDate: '2027-01-15',
      supplier: 'SPC',
    });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.quantity).toBe(100);
    expect(typeof body.quantity).toBe('number');
    expect(body.vaccineName).toBe('Pfizer');
    expect(body.lotNumber).toBe('LOT-001');
  });

  it('logWastage POSTs to the batch wastage endpoint', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({}));
    const svc = await importService();
    await svc.logWastage('batch-77', {
      quantity: 3,
      reason: 'vial_breakage',
      reportedBy: 'Nurse A',
      notes: 'Dropped',
      incidentDate: '2026-10-08',
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/batches/batch-77/wastage');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.quantity).toBe(3);
    expect(body.reason).toBe('vial_breakage');
  });

  it('adjustStock PUTs the delta to the adjust endpoint', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({}));
    const svc = await importService();
    await svc.adjustStock('batch-5', -25, 'Cycle count');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/batches/batch-5/adjust');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.delta).toBe(-25);
    expect(body.reason).toBe('Cycle count');
  });

  it('issueStock POSTs quantity and session reference', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({}));
    const svc = await importService();
    await svc.issueStock('batch-9', 5, 'CLINIC-A');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/batches/batch-9/issue');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.quantity).toBe(5);
    expect(body.sessionReference).toBe('CLINIC-A');
  });

  it('getBatchAudit GETs the audit endpoint', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({ entries: [] }));
    const svc = await importService();
    await svc.getBatchAudit('batch-2');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/batches/batch-2/audit');
    expect(opts.method).toBe('GET');
  });

  // ----- Vaults + Summary -----
  it('getColdVaults GETs /inventory/vaults', async () => {
    global.fetch.mockResolvedValueOnce(mockOk([]));
    const svc = await importService();
    await svc.getColdVaults();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/vaults');
    expect(opts.method).toBe('GET');
  });

  it('getSummary GETs /inventory/summary', async () => {
    global.fetch.mockResolvedValueOnce(mockOk({ totalVials: 0 }));
    const svc = await importService();
    await svc.getSummary();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/inventory/summary');
    expect(opts.method).toBe('GET');
  });
});

describe('inventoryService — error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.clear();
  });

  it('propagates the message field from a JSON error body', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Batch expired' }),
    });
    const svc = await importService();
    await expect(svc.getInventory()).rejects.toThrow('Batch expired');
  });

  it('joins validation errors from an ASP.NET problem-details body', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({ errors: { Field: ['Error one', 'Error two'] } }),
    });
    const svc = await importService();
    await expect(svc.getInventory()).rejects.toThrow(/Error one.*Error two/);
  });

  it('falls back to the title field when no message is present', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({ title: 'Server exploded' }),
    });
    const svc = await importService();
    await expect(svc.getInventory()).rejects.toThrow('Server exploded');
  });

  it('uses a generic message when the response has no useful fields', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({}),
    });
    const svc = await importService();
    await expect(svc.getInventory()).rejects.toThrow('Request failed');
  });
});