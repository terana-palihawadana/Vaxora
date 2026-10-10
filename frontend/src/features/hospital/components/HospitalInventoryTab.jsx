import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useMemo, useCallback } from 'react';
import RestockVaccineModal from './RestockVaccineModal';
import VaccineWastageModal from './VaccineWastageModal';
import BatchAuditModal from './BatchAuditModal';
import inventoryService from '../services/inventoryService';
import InventoryAIInventoryWorkflow from './InventoryAIInventoryWorkflow';
import HospitalSubpageHero from './HospitalSubpageHero';
import {
  IconBot,
  IconClipboard,
  IconClock,
  IconClose,
  IconFile,
  IconPackage,
  IconSearch,
  IconShield,
  IconSnowflake,
  IconSyringe,
  IconThermometer,
  IconTrash,
} from './HospitalIcons';

export default function HospitalInventoryTab() {
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [isWastageOpen, setIsWastageOpen] = useState(false);
  const [selectedAuditVaccine, setSelectedAuditVaccine] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [isAIAgentOpen, setIsAIAgentOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [registeredVaccines, setRegisteredVaccines] = useState([]); // formulary rows {id,name,price,...}
  const [newVaccineInput, setNewVaccineInput] = useState('');
  const [newVaccineMfrInput, setNewVaccineMfrInput] = useState('');
  const [newVaccineCategoryInput, setNewVaccineCategoryInput] = useState('routine');
  const [newVaccinePriceInput, setNewVaccinePriceInput] = useState('0');
  const [showRegistryBox, setShowRegistryBox] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState('table');

  const [inventory, setInventory] = useState([]);
  const [coldVaults, setColdVaults] = useState([]);

  const uniqueFormulations = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const row of registeredVaccines) {
      const label = String(row?.name || row || '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
    return out;
  }, [registeredVaccines]);

  const formularyByName = useMemo(() => {
    const map = new Map();
    for (const row of registeredVaccines) {
      const key = String(row?.name || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, row);
    }
    return map;
  }, [registeredVaccines]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const loadAll = useCallback(async () => {
    try {
      setErrorMsg('');
      const [batches, formulary, vaults] = await Promise.all([
        inventoryService.getInventory(),
        inventoryService.getFormulary(),
        inventoryService.getColdVaults(),
      ]);
      setInventory(Array.isArray(batches) ? batches : []);
      const rows = Array.isArray(formulary)
        ? formulary.map((f) => ({
            id: f.id,
            vaccineId: f.vaccineId,
            name: String(f.vaccineName || f.name || '').trim(),
            manufacturer: f.manufacturer || '',
            category: String(f.category || 'routine').toLowerCase(),
            price: Number(f.price ?? f.Price ?? 0),
            isFree: Boolean(f.isFree ?? Number(f.price ?? 0) <= 0),
          })).filter((r) => r.name)
        : [];
      setRegisteredVaccines(rows);
      setColdVaults(Array.isArray(vaults) ? vaults : []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => { loadAll(); }), [loadAll]);

  const handleRegisterNewVaccine = async (vaccineName, mfr = '', price = 0, category = 'routine') => {
    const trimmed = vaccineName.trim();
    if (!trimmed) return;
    if (registeredVaccines.some((v) => String(v.name || '').toLowerCase() === trimmed.toLowerCase())) {
      // Already registered — treat as fee / category update
      const existing = registeredVaccines.find(
        (v) => String(v.name || '').toLowerCase() === trimmed.toLowerCase()
      );
      if (existing?.id) {
        try {
          await inventoryService.updateFormularyPrice(existing.id, price, category);
          await loadAll();
          showToast(`Updated "${trimmed}" (${category}${Number(price) <= 0 ? ', Free' : `, LKR ${Number(price).toFixed(2)}`}).`);
        } catch (err) {
          showToast(err.message);
        }
      }
      return;
    }
    try {
      await inventoryService.registerFormulary(trimmed, mfr, price, category);
      await loadAll();
      showToast(`Registered "${trimmed}" as ${category}${Number(price) <= 0 ? ' · Free' : ` · LKR ${Number(price).toFixed(2)}`}.`);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleRegisterFormSubmit = (e) => {
    e.preventDefault();
    if (!newVaccineInput.trim()) return;
    handleRegisterNewVaccine(
      newVaccineInput,
      newVaccineMfrInput,
      parseFloat(newVaccinePriceInput || 0),
      newVaccineCategoryInput
    );
    setNewVaccineInput('');
    setNewVaccineMfrInput('');
    setNewVaccineCategoryInput('routine');
    setNewVaccinePriceInput('0');
  };

  const handleRemoveFormulation = async (name) => {
    if (uniqueFormulations.length <= 1) {
      alert('You must keep at least one registered vaccine product.');
      return;
    }
    try {
      const formulary = await inventoryService.getFormulary();
      const matches = (Array.isArray(formulary) ? formulary : []).filter(
        (f) => String(f.vaccineName || f.name || '').trim().toLowerCase() === name.trim().toLowerCase()
      );
      if (matches.length === 0) {
        await loadAll();
        return;
      }
      for (const match of matches) {
        await inventoryService.removeFormulary(match.id);
      }
      await loadAll();
      showToast(`Removed "${name}" from registered formulary options.`);
    } catch (err) {
      showToast(err.message);
      await loadAll();
    }
  };

  const handleAddStock = async ({ vaccineName, lotNumber, quantity, storageUnit, expiryDate, supplier, category }) => {
    try {
      await inventoryService.restockBatch({
        vaccineName,
        lotNumber,
        quantity,
        storageUnit,
        expiryDate,
        supplier,
        category,
      });
      await loadAll();
      showToast(`Successfully logged restock of +${quantity} vials for ${vaccineName} (Lot ${lotNumber}).`);
    } catch (err) {
      showToast(err.message);
      throw err;
    }
  };

  const handleLogWastage = async ({ vaccineId, quantity, reason, reportedBy, notes, incidentDate }) => {
    try {
      await inventoryService.logWastage(vaccineId, { quantity, reason, reportedBy, notes, incidentDate });
      await loadAll();
      showToast(`Logged ${quantity} wasted vials.`);
    } catch (err) {
      showToast(err.message);
      throw err;
    }
  };

  const handleQuickAdjust = async (id, delta) => {
    try {
      await inventoryService.adjustStock(id, delta, `Quick ${delta > 0 ? '+' : ''}${delta} adjustment`);
      await loadAll();
    } catch (err) {
      showToast(err.message);
    }
  };

  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        item.name.toLowerCase().includes(q) ||
        item.lotNumber.toLowerCase().includes(q) ||
        (item.manufacturer || '').toLowerCase().includes(q) ||
        (item.storageUnit || '').toLowerCase().includes(q);
      if (!matchSearch) return false;
      if (statusFilter === 'low' && item.available > item.minThreshold) return false;
      if (statusFilter === 'sufficient' && item.available <= item.minThreshold) return false;
      if (statusFilter === 'expiring' && item.expiryStatus !== 'expiring_soon') return false;
      if (statusFilter === 'ultracold' && !(item.storageUnit || '').toLowerCase().includes('ultra-cold')) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      return true;
    });
  }, [inventory, searchQuery, statusFilter, categoryFilter]);

  const inventoryCategories = useMemo(
    () => [...new Set(inventory.map((item) => item.category).filter(Boolean))].sort(),
    [inventory]
  );

  const totalVials = inventory.reduce((acc, curr) => acc + curr.available, 0);
  const totalDoses = inventory.reduce(
    (acc, curr) => acc + (curr.availableDoses ?? curr.available * curr.dosesPerVial),
    0
  );
  const lowStockCount = inventory.filter((item) => item.available <= item.minThreshold).length;
  const healthyCount = inventory.filter((item) => item.available > item.minThreshold).length;
  const expiringCount = inventory.filter((item) => item.expiryStatus === 'expiring_soon').length;
  const ultracoldCount = inventory.filter((item) =>
    (item.storageUnit || '').toLowerCase().includes('ultra-cold')
  ).length;

  if (loading) {
    return (
      <div className="hospital-manage-appointments-wrapper">
        <HospitalSubpageHero
          eyebrow="Cold-chain operations"
          title="Vaccine inventory"
          subtitle="Monitor stock, cold storage, expiry risk, and restock activity from one operational workspace."
        />
        <div className="hospital-inventory-content hospital-inventory-loading">
          <h3>Loading inventory…</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="hospital-manage-appointments-wrapper">
      <HospitalSubpageHero
        eyebrow="Cold-chain operations"
        title="Vaccine inventory"
        subtitle="Monitor stock, cold storage, expiry risk, and restock activity from one operational workspace."
      />
      <div className="hospital-inventory-content">
        {toastMessage && (
          <div className="inventory-toast-banner">
            <span>{toastMessage}</span>
            <button type="button" onClick={() => setToastMessage('')}>&times;</button>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: 'var(--color-error-bg)', border: '1px solid var(--color-error-border)', color: 'var(--color-error)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
            ⚠️ {errorMsg}
          </div>
        )}

        <div className="hospital-metrics-grid hospital-metrics-grid--4">
          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-slate">
              <IconSyringe size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Total Vials In Stock</span>
              <span className="hospital-stat-value">{totalVials.toLocaleString()}</span>
              <span className="hospital-stat-meta">
                ≈ {totalDoses.toLocaleString()} patient doses available
              </span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-amber">
              <IconShield size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Low Stock Reorders</span>
              <span className={`hospital-stat-value${lowStockCount > 0 ? ' is-alert' : ''}`}>
                {lowStockCount}
              </span>
              <span className="hospital-stat-meta">
                {lowStockCount > 0
                  ? `${lowStockCount} formulation${lowStockCount === 1 ? '' : 's'} need reorder`
                  : 'All stocks above safety threshold'}
              </span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-amber">
              <IconClock size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Expiring in &lt; 60 Days</span>
              <span className={`hospital-stat-value${expiringCount > 0 ? ' is-warning' : ''}`}>
                {expiringCount}
              </span>
              <span className="hospital-stat-meta">
                {expiringCount > 0
                  ? `${expiringCount} batch${expiringCount === 1 ? '' : 'es'} to prioritize`
                  : 'Prioritize in clinic queue'}
              </span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-green">
              <IconSnowflake size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Cold Storage Status</span>
              <span className="hospital-stat-value">100%</span>
              <span className="hospital-stat-meta">
                <span className="meta-positive">
                  {coldVaults.length} units online · 0 excursions
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="inventory-header-row">
          <div className="inventory-action-buttons">
            <button type="button" className="btn-inventory-action btn-restock-primary" onClick={() => setIsRestockOpen(true)}>
              <IconPackage size={16} />
              Log restock
            </button>
            <button type="button" className="btn-inventory-action btn-wastage-secondary" onClick={() => setIsWastageOpen(true)} disabled={inventory.length === 0}>
              <IconTrash size={16} />
              Record wastage
            </button>
            <button
              type="button"
              className="btn-inventory-action btn-inventory-ai"
              onClick={() => setIsAIAgentOpen(true)}
            >
              <IconBot size={16} />
              Inventory assistant
            </button>
            <button type="button" className="btn-inventory-action btn-export-neutral" onClick={() => showToast('Exporting official MOH Vaccine Stock Ledger (.CSV)...')}>
              <IconFile size={16} />
              Export report
            </button>
          </div>
        </div>

        <div className="inventory-toolbar">
          <div className="inventory-search-group">
            <span className="search-icon" aria-hidden="true">
              <IconSearch size={16} />
            </span>
            <input type="text" className="inventory-search-input" placeholder="Search vaccine, lot, or vault..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && (
              <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <IconClose size={14} />
              </button>
            )}
          </div>
          <div className="inventory-filter-pills">
            <select
              className="inventory-category-select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Filter by vaccine category"
            >
              <option value="all">All categories</option>
              {inventoryCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <div className="filter-pill-group" role="group" aria-label="Stock filters">
              <button type="button" className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>All ({inventory.length})</button>
              <button type="button" className={`filter-pill ${statusFilter === 'low' ? 'active' : ''}`} onClick={() => setStatusFilter('low')}>Low stock ({lowStockCount})</button>
              <button type="button" className={`filter-pill ${statusFilter === 'sufficient' ? 'active' : ''}`} onClick={() => setStatusFilter('sufficient')}>Healthy ({healthyCount})</button>
              <button type="button" className={`filter-pill ${statusFilter === 'expiring' ? 'active' : ''}`} onClick={() => setStatusFilter('expiring')}>Expiring ({expiringCount})</button>
              <button type="button" className={`filter-pill ${statusFilter === 'ultracold' ? 'active' : ''}`} onClick={() => setStatusFilter('ultracold')}>Ultra-cold ({ultracoldCount})</button>
            </div>
            <div className="view-mode-toggles">
              <button type="button" className={`btn-view-toggle ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>Table</button>
              <button type="button" className={`btn-view-toggle ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setViewMode('cards')}>Cards</button>
            </div>
          </div>
        </div>

        {inventory.length === 0 ? (
          <div className="hospital-appointments-table-wrapper inventory-empty-state">
            <h3>No inventory yet</h3>
            <p>Log a restock shipment to add your first batch.</p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="hospital-appointments-table-wrapper">
            <table className="inventory-custom-table">
              <thead>
                <tr>
                  <th className="is-left">Vaccine &amp; lot</th>
                  <th>Category</th>
                  <th>Storage</th>
                  <th>Stock</th>
                  <th>Doses</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr><td colSpan="8" className="empty-table-cell">No vaccines match the selected criteria.</td></tr>
                ) : (
                  filteredInventory.map((item) => {
                    const received = Math.max(item.capacity || 0, item.available || 0);
                    const pct = received > 0
                      ? Math.min(100, Math.round((item.available / received) * 100))
                      : 0;
                    const doseCount = item.availableDoses ?? item.available * item.dosesPerVial;
                    const isLow = item.available <= item.minThreshold;
                    const isExpiring = item.expiryStatus === 'expiring_soon';
                    return (
                      <tr key={item.id} className={isLow ? 'row-highlight-low' : ''}>
                        <td className="is-left">
                          <div className="vaccine-title-cell">
                            <strong className="vaccine-name-text">{item.name}</strong>
                            <div className="vaccine-sub-meta">
                              <span className="lot-badge">Lot: {item.lotNumber}</span>
                              <span className="mfr-text">{item.manufacturer}</span>
                            </div>
                          </div>
                        </td>
                        <td><span className="category-tag">{item.category.toUpperCase()}</span></td>
                        <td>
                          <div className="storage-cell">
                            <span className="vault-label">{item.storageUnit}</span>
                            <span className="temp-badge">{item.temp}</span>
                          </div>
                        </td>
                        <td style={{ minWidth: '180px' }}>
                          <div className="stock-level-cell">
                            <div className="stock-numbers">
                              <strong>{item.available}</strong>
                              <span className="cap-total"> available / {item.capacity} received</span>
                              <span className="pct-text">({pct}%)</span>
                            </div>
                            <div className="stock-progress-track">
                              <div className={`stock-progress-fill ${item.statusColor}`} style={{ width: `${pct}%` }} />
                            </div>
                            {isLow && <span className="low-stock-alert-tag">Below threshold ({item.minThreshold} min)</span>}
                          </div>
                        </td>
                        <td>
                          <div className="doses-cell">
                            <strong>{doseCount.toLocaleString()}</strong>
                            <small>{item.dosesPerVial} dose/vial</small>
                          </div>
                        </td>
                        <td>
                          <div className="expiry-cell">
                            <span className={`expiry-date ${isExpiring ? 'text-amber' : ''}`}>{item.expiry}</span>
                            {isExpiring && <span className="exp-badge">Expiring Soon</span>}
                          </div>
                        </td>
                        <td>
                          {isLow ? <span className="stock-badge badge-reorder">Low Stock</span>
                            : isExpiring ? <span className="stock-badge badge-expiring">Action Due</span>
                            : <span className="stock-badge badge-healthy">In Stock</span>}
                        </td>
                        <td>
                          <div className="inventory-row-actions">
                            <button type="button" className="btn-quick-adjust btn-adjust-plus" onClick={() => handleQuickAdjust(item.id, 20)} title="Add +20 Vials">+20</button>
                            <button type="button" className="btn-quick-adjust btn-adjust-minus" onClick={() => handleQuickAdjust(item.id, -20)} title="Deduct -20 Vials">-20</button>
                            <button type="button" className="btn-table-audit" onClick={() => setSelectedAuditVaccine(item)} title="View batch audit">
                              <IconClipboard size={14} />
                              Audit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inventory-cards-grid">
            {filteredInventory.map((item) => {
              const received = Math.max(item.capacity || 0, item.available || 0);
              const pct = received > 0
                ? Math.min(100, Math.round((item.available / received) * 100))
                : 0;
              const doseCount = item.availableDoses ?? item.available * item.dosesPerVial;
              const isLow = item.available <= item.minThreshold;
              return (
                <div key={item.id} className={`inventory-card-item ${isLow ? 'card-low-stock' : ''}`}>
                  <div className="inv-card-top">
                    <span className="category-tag">{item.category.toUpperCase()}</span>
                    {isLow ? <span className="stock-badge badge-reorder">Low Stock</span> : <span className="stock-badge badge-healthy">Optimal</span>}
                  </div>
                  <h4 className="inv-card-name">{item.name}</h4>
                  <div className="inv-card-meta">
                    <span>Lot: <strong>{item.lotNumber}</strong></span>
                    <span>Expiry: <strong>{item.expiry}</strong></span>
                  </div>
                  <div className="inv-card-storage-box">
                    <div className="storage-row">
                      <span>{item.storageUnit}</span>
                      <span className="temp-badge">{item.temp}</span>
                    </div>
                  </div>
                  <div className="inv-card-stock-block">
                    <div className="stock-header-flex">
                      <span>On hand / received:</span>
                      <strong>{item.available} / {item.capacity} vials</strong>
                    </div>
                    <div className="stock-progress-track">
                      <div className={`stock-progress-fill ${item.statusColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="doses-sub-line">Provides &asymp; {doseCount.toLocaleString()} doses ({item.dosesPerVial}/vial)</div>
                  </div>
                  <div className="inv-card-actions">
                    <button type="button" className="btn-card-audit" onClick={() => setSelectedAuditVaccine(item)}>Audit Ledger</button>
                    <button type="button" className="btn-card-restock" onClick={() => handleQuickAdjust(item.id, 50)}>+ Quick 50</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="vaccine-formulary-card">
          <div className="formulary-card-header">
            <div className="formulary-header-main">
              <div className="hospital-stat-icon stat-icon-teal" aria-hidden="true">
                <IconPackage size={20} />
              </div>
              <div className="formulary-header-copy">
                <div className="formulary-title-row">
                  <h3 className="formulary-title">Vaccine formulary</h3>
                  <span className="formulary-count-badge">{uniqueFormulations.length}</span>
                </div>
                <p className="formulary-sub">
                  Register products once — they appear in the restock shipment dropdown.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-toggle-registry"
              onClick={() => setShowRegistryBox((prev) => !prev)}
              aria-expanded={showRegistryBox}
            >
              {showRegistryBox ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {showRegistryBox && (
            <div className="formulary-card-body">
              <form onSubmit={handleRegisterFormSubmit} className="formulary-input-row">
                <div className="formulary-input-group formulary-input-group--name">
                  <label className="formulary-label" htmlFor="formulary-vaccine-name">
                    Vaccine product name *
                  </label>
                  <input
                    id="formulary-vaccine-name"
                    type="text"
                    className="formulary-text-input"
                    placeholder="e.g. Hepatitis B Recombinant"
                    value={newVaccineInput}
                    onChange={(e) => setNewVaccineInput(e.target.value)}
                    required
                  />
                </div>
                <div className="formulary-input-group formulary-input-group--mfr">
                  <label className="formulary-label" htmlFor="formulary-vaccine-mfr">
                    Manufacturer / supplier
                  </label>
                  <input
                    id="formulary-vaccine-mfr"
                    type="text"
                    className="formulary-text-input"
                    placeholder="e.g. Serum Institute"
                    value={newVaccineMfrInput}
                    onChange={(e) => setNewVaccineMfrInput(e.target.value)}
                  />
                </div>
                <div className="formulary-input-group formulary-input-group--category">
                  <label className="formulary-label" htmlFor="formulary-vaccine-category">
                    Category
                  </label>
                  <select
                    id="formulary-vaccine-category"
                    className="formulary-text-input"
                    value={newVaccineCategoryInput}
                    onChange={(e) => setNewVaccineCategoryInput(e.target.value)}
                  >
                    <option value="routine">Routine</option>
                    <option value="mrna">mRNA</option>
                    <option value="seasonal">Seasonal</option>
                    <option value="pediatric">Pediatric</option>
                  </select>
                </div>
                <div className="formulary-input-group formulary-input-group--fee">
                  <label className="formulary-label" htmlFor="formulary-vaccine-price">
                    Fee / person (LKR)
                  </label>
                  <input
                    id="formulary-vaccine-price"
                    type="number"
                    min="0"
                    step="1"
                    className="formulary-text-input"
                    placeholder="0 = Free"
                    value={newVaccinePriceInput}
                    onChange={(e) => setNewVaccinePriceInput(e.target.value)}
                    title="Enter 0 for Free / MOH-subsidized vaccines"
                  />
                </div>
                <div className="formulary-input-group formulary-input-group--action">
                  <span className="formulary-label formulary-label--spacer" aria-hidden="true">
                    &nbsp;
                  </span>
                  <button type="submit" className="btn-register-vaccine">
                    Register product
                  </button>
                </div>
              </form>

              <div className="registered-pills-wrap">
                <div className="registered-pills-heading">
                  <span className="registered-pills-label">Registered products</span>
                </div>
                {uniqueFormulations.length === 0 ? (
                  <p className="formulary-empty">
                    No products registered yet. Add a vaccine name above to get started.
                  </p>
                ) : (
                  <div className="registered-pills-list">
                    {uniqueFormulations.map((vName) => {
                      const row = formularyByName.get(vName.toLowerCase());
                      const isFree = !row || Number(row.price) <= 0;
                      const category = (row?.category || 'routine').toLowerCase();
                      const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
                      return (
                      <span key={vName.toLowerCase()} className="registered-vaccine-pill">
                        <span className="pill-icon" aria-hidden="true">
                          <IconSyringe size={14} />
                        </span>
                        <strong className="pill-name">{vName}</strong>
                        <span className="pill-meta" title={`Category: ${categoryTitle}`}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M2.5 3.5h7.2L14 8.8l-5.2 5.2L2.5 7.7V3.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                            <circle cx="5.2" cy="6.2" r="1" fill="currentColor"/>
                          </svg>
                          <span className="pill-meta-text">{categoryTitle}</span>
                        </span>
                        <span
                          className="pill-meta"
                          title={isFree ? 'Free — schedules inherit this fee' : `Fee LKR ${Number(row.price).toLocaleString()} — schedules inherit this`}
                        >
                          {isFree ? (
                            <>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                                <path d="M5 8h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                              </svg>
                              <span className="pill-meta-text">Free</span>
                            </>
                          ) : (
                            <>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <path d="M4 4.5h6.5a2.5 2.5 0 010 5H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M6 4.5v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                              </svg>
                              <span className="pill-meta-text">LKR {Number(row.price).toLocaleString()}</span>
                            </>
                          )}
                        </span>
                        <button
                          type="button"
                          className="pill-remove-btn"
                          onClick={() => handleRemoveFormulation(vName)}
                          title={`Remove ${vName}`}
                          aria-label={`Remove ${vName}`}
                        >
                          <IconClose size={12} />
                        </button>
                      </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {coldVaults.length > 0 && (
          <div className="cold-vaults-section">
            <div className="cold-vaults-header">
              <div className="formulary-header-main">
                <div className="hospital-stat-icon stat-icon-teal" aria-hidden="true">
                  <IconSnowflake size={20} />
                </div>
                <div className="formulary-header-copy">
                  <div className="formulary-title-row">
                    <h3 className="cold-vaults-title">Cold chain vaults</h3>
                    <span className="formulary-count-badge">{coldVaults.length}</span>
                  </div>
                  <p className="cold-vaults-sub">Live temperature, humidity, and lot occupancy for each storage unit.</p>
                </div>
              </div>
              <span className="cold-vaults-live-tag">
                <span className="pulse-dot" />
                Sensors synced
              </span>
            </div>
            <div className="cold-vaults-grid">
              {coldVaults.map((vault) => {
                const ok = !vault.status || /optimal|ok|normal|safe|active/i.test(String(vault.status));
                return (
                  <article key={vault.id} className="cold-vault-card">
                    <div className="cold-vault-card-header">
                      <div className="hospital-stat-icon stat-icon-teal" aria-hidden="true">
                        <IconThermometer size={18} />
                      </div>
                      <div className="cold-vault-copy">
                        <h4 className="vault-name">{vault.name}</h4>
                        <span className="vault-type">{vault.type}</span>
                      </div>
                      <span className={`vault-status-badge${ok ? ' is-ok' : ' is-warn'}`}>
                        {vault.status || 'Monitored'}
                      </span>
                    </div>
                    <div className="cold-vault-temp-display">
                      <span className="temp-big">{vault.temp}</span>
                      <span className="temp-target">Target {vault.target}</span>
                    </div>
                    <div className="cold-vault-footer">
                      <span>Humidity <strong>{vault.humidity || 'N/A'}</strong></span>
                      <span>Lots <strong>{vault.assignedLots ?? 0}</strong></span>
                      <span className="sensor-tag">{vault.sensorStatus || 'Active'}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <div className="inventory-footer-notice">
          <div className="footer-notice-text">
            <IconShield size={16} />
            <span>Storage and lot records sync with the national immunization cold-chain registry.</span>
          </div>
          <button type="button" className="btn-sync-registry" onClick={() => showToast('Cold chain registry status: All batches verified.')}>
            Sync registry
          </button>
        </div>
      </div>

      {isRestockOpen && (
        <RestockVaccineModal
          isOpen={isRestockOpen}
          onClose={() => setIsRestockOpen(false)}
          onAddStock={handleAddStock}
          registeredVaccines={registeredVaccines}
        />
      )}

      <VaccineWastageModal
        isOpen={isWastageOpen}
        onClose={() => setIsWastageOpen(false)}
        inventoryItems={inventory}
        onLogWastage={handleLogWastage}
      />

      <BatchAuditModal
        isOpen={Boolean(selectedAuditVaccine)}
        onClose={() => setSelectedAuditVaccine(null)}
        vaccine={selectedAuditVaccine}
      />

      <InventoryAIInventoryWorkflow
        isOpen={isAIAgentOpen}
        onClose={() => setIsAIAgentOpen(false)}
        onApproved={loadAll}
      />
    </div>
  );
}
