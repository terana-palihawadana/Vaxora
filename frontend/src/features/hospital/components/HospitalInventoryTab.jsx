import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import RestockVaccineModal from './RestockVaccineModal';
import VaccineWastageModal from './VaccineWastageModal';
import BatchAuditModal from './BatchAuditModal';
import ReceiveOrderModal from './ReceiveOrderModal';
import inventoryService from '../services/inventoryService';
import InventoryAIInventoryWorkflow from './InventoryAIInventoryWorkflow';
import HospitalSubpageHero from './HospitalSubpageHero';
import HeroTabs from '../../../components/HeroTabs';
import useViewParam from '../../../shared/hooks/useViewParam';
import {
  IconBot,
  IconClipboard,
  IconClock,
  IconClose,
  IconFile,
  IconPackage,
  IconPencil,
  IconSearch,
  IconShield,
  IconSnowflake,
  IconSyringe,
  IconThermometer,
  IconTrash,
} from './HospitalIcons';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';
import { downloadCsv } from '../../../shared/utils/downloadCsv';
import { hospitalToday } from '../utils/hospitalDate';

const INVENTORY_VIEWS = ['stock', 'formulary', 'vaults'];

// "routine" -> "Routine"; "mrna" -> "mRNA"; other mixed-case names stay as they are
function formatCategory(category) {
  const c = String(category || '');
  if (c.toLowerCase() === 'mrna') return 'mRNA';
  return c === c.toLowerCase() || c === c.toUpperCase()
    ? c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
    : c;
}

// Low stock is per vaccine (all unexpired lots together), as flagged by the API
function isLowStock(item) {
  return item.isLowStock ?? item.available <= item.minThreshold;
}

// A purchase order awaiting delivery: listed, but holds no usable stock yet
function isOnOrder(item) {
  return item.status === 'ordered';
}

export default function HospitalInventoryTab() {
  const [confirm, confirmDialog] = useConfirmDialog();
  const [view, setView] = useViewParam(INVENTORY_VIEWS);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [isWastageOpen, setIsWastageOpen] = useState(false);
  const [selectedAuditVaccine, setSelectedAuditVaccine] = useState(null);
  const [receivingBatch, setReceivingBatch] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastTone, setToastTone] = useState('success'); // success | error
  const toastTimerRef = useRef(null);
  const [isAIAgentOpen, setIsAIAgentOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [registeredVaccines, setRegisteredVaccines] = useState([]); // formulary rows {id,name,price,...}
  const [newVaccineInput, setNewVaccineInput] = useState('');
  const [newVaccineMfrInput, setNewVaccineMfrInput] = useState('');
  const [newVaccineCategoryInput, setNewVaccineCategoryInput] = useState('routine');
  const [newVaccinePriceInput, setNewVaccinePriceInput] = useState('0');
  const [newVaccineCostInput, setNewVaccineCostInput] = useState('0');
  const [newSupplierNameInput, setNewSupplierNameInput] = useState('');
  const [newSupplierEmailInput, setNewSupplierEmailInput] = useState('');
  const [editingFormularyId, setEditingFormularyId] = useState(null);
  const [showRegistryBox, setShowRegistryBox] = useState(() => view === 'formulary');
  // Opening the formulary view expands the registry box (adjusted during render, not in an effect).
  const [registryView, setRegistryView] = useState(view);
  if (view !== registryView) {
    setRegistryView(view);
    if (view === 'formulary') setShowRegistryBox(true);
  }
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

  const showToast = (msg, tone = 'success') => {
    setToastMessage(msg);
    setToastTone(tone);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 4000);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

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
            supplierCost: Number(f.supplierCost ?? 0),
            supplierName: f.supplierName || '',
            supplierEmail: f.supplierEmail || '',
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

  const resetFormularyForm = () => {
    setEditingFormularyId(null);
    setNewVaccineInput('');
    setNewVaccineMfrInput('');
    setNewVaccineCategoryInput('routine');
    setNewVaccinePriceInput('0');
    setNewVaccineCostInput('0');
    setNewSupplierNameInput('');
    setNewSupplierEmailInput('');
  };

  // Load a registered product into the form so its category, fee, cost and supplier can be changed
  const handleEditFormulation = (row) => {
    setEditingFormularyId(row.id);
    setNewVaccineInput(row.name);
    setNewVaccineMfrInput(row.manufacturer || '');
    setNewVaccineCategoryInput(row.category || 'routine');
    setNewVaccinePriceInput(String(row.price ?? 0));
    setNewVaccineCostInput(String(row.supplierCost ?? 0));
    setNewSupplierNameInput(row.supplierName || '');
    setNewSupplierEmailInput(row.supplierEmail || '');
  };

  const handleRegisterNewVaccine = async (vaccineName, mfr = '', price = 0, category = 'routine', supplierCost = 0, supplier = {}) => {
    const trimmed = vaccineName.trim();
    if (!trimmed) return;
    if (registeredVaccines.some((v) => String(v.name || '').toLowerCase() === trimmed.toLowerCase())) {
      // Already registered — treat as fee / cost / category / supplier update
      const existing = registeredVaccines.find(
        (v) => String(v.name || '').toLowerCase() === trimmed.toLowerCase()
      );
      if (existing?.id) {
        try {
          await inventoryService.updateFormularyPrice(existing.id, price, category, supplierCost, supplier);
          await loadAll();
          showToast(`Updated "${trimmed}" (${category}${Number(price) <= 0 ? ', Free' : `, LKR ${Number(price).toFixed(2)}`}).`);
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
      return;
    }
    try {
      await inventoryService.registerFormulary(trimmed, mfr, price, category, supplierCost, supplier);
      await loadAll();
      showToast(`Registered "${trimmed}" as ${category}${Number(price) <= 0 ? ' · Free' : ` · LKR ${Number(price).toFixed(2)}`}.`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRegisterFormSubmit = (e) => {
    e.preventDefault();
    if (!newVaccineInput.trim()) return;
    handleRegisterNewVaccine(
      newVaccineInput,
      newVaccineMfrInput,
      parseFloat(newVaccinePriceInput || 0),
      newVaccineCategoryInput,
      parseFloat(newVaccineCostInput || 0),
      { name: newSupplierNameInput.trim(), email: newSupplierEmailInput.trim() }
    );
    resetFormularyForm();
  };

  const handleRemoveFormulation = async (name) => {
    if (uniqueFormulations.length <= 1) {
      showToast('You must keep at least one registered vaccine product.', 'error');
      return;
    }
    const ok = await confirm({
      title: 'Remove product?',
      message: `Remove "${name}" from the hospital formulary?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
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
      showToast(err.message, 'error');
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
      showToast(err.message, 'error');
      throw err;
    }
  };

  const handleReceiveOrder = async (batch, { lotNumber, quantity, expiryDate, storageUnit }) => {
    try {
      await inventoryService.receiveOrderedBatch(batch.id, { lotNumber, quantity, expiryDate, storageUnit });
      await loadAll();
      showToast(`Received ${quantity} vials of ${batch.name} (Lot ${lotNumber}).`);
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  const handleLogWastage = async ({ vaccineId, quantity, reason, reportedBy, notes, incidentDate }) => {
    try {
      await inventoryService.logWastage(vaccineId, { quantity, reason, reportedBy, notes, incidentDate });
      await loadAll();
      showToast(`Logged ${quantity} wasted vials.`);
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  const handleQuickAdjust = async (id, delta) => {
    try {
      await inventoryService.adjustStock(id, delta, `Quick ${delta > 0 ? '+' : ''}${delta} adjustment`);
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRefreshRecords = async () => {
    await loadAll();
    showToast('Stock records refreshed.');
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
      if (statusFilter === 'low' && !isLowStock(item)) return false;
      if (statusFilter === 'sufficient' && isLowStock(item)) return false;
      if (statusFilter === 'expiring' && item.expiryStatus !== 'expiring_soon') return false;
      if (statusFilter === 'ultracold' && !(item.storageUnit || '').toLowerCase().includes('ultra-cold')) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      return true;
    });
  }, [inventory, searchQuery, statusFilter, categoryFilter]);

  const handleExportReport = () => {
    if (filteredInventory.length === 0) {
      showToast('There are no batches to export.', 'error');
      return;
    }
    downloadCsv(`Vaxora_Stock_Ledger_${hospitalToday()}.csv`, [
      ['Vaccine', 'Lot', 'Manufacturer', 'Category', 'Storage', 'Vials on hand', 'Vials received', 'Doses', 'Expiry', 'Status'],
      ...filteredInventory.map((item) => [
        item.name,
        item.lotNumber,
        item.manufacturer || '',
        formatCategory(item.category),
        item.storageUnit || '',
        item.available,
        item.capacity,
        item.availableDoses ?? item.available * item.dosesPerVial,
        isOnOrder(item) ? '' : item.expiry,
        isOnOrder(item)
          ? 'On order'
          : isLowStock(item)
            ? 'Low stock'
            : item.expiryStatus === 'expiring_soon'
              ? 'Expiring soon'
              : 'In stock',
      ]),
    ]);
    showToast(`Exported ${filteredInventory.length} batch${filteredInventory.length === 1 ? '' : 'es'} to CSV.`);
  };

  const inventoryCategories = useMemo(
    () => [...new Set(inventory.map((item) => item.category).filter(Boolean))].sort(),
    [inventory]
  );

  const totalVials = inventory.reduce((acc, curr) => acc + curr.available, 0);
  const totalDoses = inventory.reduce(
    (acc, curr) => acc + (curr.availableDoses ?? curr.available * curr.dosesPerVial),
    0
  );
  const lowStockCount = inventory.filter(isLowStock).length;
  const lowVaccineCount = new Set(
    inventory.filter(isLowStock).map((item) => item.vaccineId ?? item.name)
  ).size;
  const healthyCount = inventory.length - lowStockCount;
  const expiringCount = inventory.filter((item) => item.expiryStatus === 'expiring_soon').length;
  const ultracoldCount = inventory.filter((item) =>
    (item.storageUnit || '').toLowerCase().includes('ultra-cold')
  ).length;
  const vaultsOk = coldVaults.filter(
    (vault) => !vault.status || /optimal|ok|normal|safe|active/i.test(String(vault.status))
  ).length;
  const vaultsNeedingAttention = coldVaults.length - vaultsOk;

  const inventorySubtitle =
    view === 'formulary'
      ? 'Register vaccine products once — they appear in restock and session fee dropdowns.'
      : view === 'vaults'
        ? 'Live temperature, humidity, and lot occupancy for each cold-chain storage unit.'
        : 'Monitor stock levels, expiry risk, and restock activity from one operational workspace.';

  const inventoryHero = (
    <HospitalSubpageHero
      eyebrow="Cold-chain operations"
      title="Vaccine inventory"
      subtitle={inventorySubtitle}
    >
      <HeroTabs
        label="Inventory views"
        tabs={[
          { key: 'stock', label: 'Stock' },
          { key: 'formulary', label: 'Formulary' },
          { key: 'vaults', label: 'Cold vaults' },
        ]}
        active={view}
        onChange={setView}
      />
    </HospitalSubpageHero>
  );

  if (loading) {
    return (
      <div className="hospital-manage-appointments-wrapper">
        {inventoryHero}
        <div className="hospital-inventory-content hospital-inventory-loading">
          <h3>Loading inventory…</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="hospital-manage-appointments-wrapper">
      {inventoryHero}
      <div className="hospital-inventory-content">
        {toastMessage && (
          <div
            className="inventory-toast-banner"
            role={toastTone === 'error' ? 'alert' : 'status'}
            style={toastTone === 'error' ? { background: 'var(--color-error)' } : undefined}
          >
            <span>{toastMessage}</span>
            <button type="button" onClick={() => setToastMessage('')}>&times;</button>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: 'var(--color-error-bg)', border: '1px solid var(--color-error-border)', color: 'var(--color-error)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {view === 'stock' && (
        <>
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
              <span className={`hospital-stat-value${lowVaccineCount > 0 ? ' is-alert' : ''}`}>
                {lowVaccineCount}
              </span>
              <span className="hospital-stat-meta">
                {lowVaccineCount > 0
                  ? `${lowVaccineCount} formulation${lowVaccineCount === 1 ? '' : 's'} need reorder`
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
            <div className={`hospital-stat-icon ${vaultsNeedingAttention === 0 ? 'stat-icon-green' : 'stat-icon-amber'}`}>
              <IconSnowflake size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Cold Storage Status</span>
              <span className="hospital-stat-value">
                {coldVaults.length > 0 ? `${vaultsOk}/${coldVaults.length}` : '—'}
              </span>
              <span className="hospital-stat-meta">
                {coldVaults.length === 0 ? (
                  'No cold vaults linked'
                ) : (
                  <span className={vaultsNeedingAttention === 0 ? 'meta-positive' : 'meta-warning'}>
                    {vaultsNeedingAttention === 0
                      ? `${coldVaults.length} vault${coldVaults.length === 1 ? '' : 's'} optimal`
                      : `${vaultsNeedingAttention} need${vaultsNeedingAttention === 1 ? 's' : ''} attention`}
                  </span>
                )}
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
            <button type="button" className="btn-inventory-action btn-export-neutral" onClick={handleExportReport}>
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
            <table className="inventory-custom-table inv-clean">
              <thead>
                <tr>
                  <th className="is-left">Vaccine &amp; lot</th>
                  <th className="is-left">Category</th>
                  <th className="is-left">Storage</th>
                  <th className="is-left">Stock</th>
                  <th className="is-left">Doses</th>
                  <th className="is-left">Expiry</th>
                  <th className="is-left">Status</th>
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
                    const isLow = isLowStock(item);
                    const isExpiring = item.expiryStatus === 'expiring_soon';
                    if (isOnOrder(item)) {
                      return (
                        <tr key={item.id}>
                          <td className="is-left">
                            <div className="inv-name">{item.name}</div>
                            <div className="inv-sub">Order {item.lotNumber}{item.manufacturer ? ` · ${item.manufacturer}` : ''}</div>
                          </td>
                          <td className="is-left"><span className="inv-category">{formatCategory(item.category)}</span></td>
                          <td className="is-left"><div className="inv-sub">Assigned on receipt</div></td>
                          <td className="is-left">
                            <div className="inv-main"><strong>{item.capacity}</strong> ordered</div>
                            <div className="inv-sub">Not in stock yet</div>
                          </td>
                          <td className="is-left"><div className="inv-sub">—</div></td>
                          <td className="is-left"><div className="inv-sub">Set on receipt</div></td>
                          <td className="is-left"><span className="inv-status is-due">On order</span></td>
                          <td>
                            <div className="inv-actions">
                              <button type="button" className="inv-action is-primary" onClick={() => setReceivingBatch(item)} title="Record the delivery and add it to stock">
                                <IconPackage size={14} />
                                Receive
                              </button>
                              <button type="button" className="inv-action" onClick={() => setSelectedAuditVaccine(item)} title="View batch audit">
                                <IconClipboard size={14} />
                                Audit
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={item.id} className={isLow ? 'row-highlight-low' : ''}>
                        <td className="is-left">
                          <div className="inv-name">{item.name}</div>
                          <div className="inv-sub">Lot {item.lotNumber}{item.manufacturer ? ` · ${item.manufacturer}` : ''}</div>
                        </td>
                        <td className="is-left"><span className="inv-category">{formatCategory(item.category)}</span></td>
                        <td className="is-left">
                          <div className="inv-main">{item.storageUnit}</div>
                          <div className="inv-sub">{item.temp}</div>
                        </td>
                        <td className="is-left">
                          <div className="inv-stock-line">
                            <span className="inv-main"><strong>{item.available}</strong> / {item.capacity}</span>
                            <span className="inv-sub">{pct}%</span>
                          </div>
                          <div className="stock-progress-track inv-bar">
                            <div className={`stock-progress-fill ${item.statusColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          {isLow && <div className="inv-alert">Below {item.minThreshold} minimum</div>}
                          {!isLow && item.vaccineOnOrder > 0 && item.vaccineAvailable <= item.minThreshold && (
                            <div className="inv-sub">{item.vaccineOnOrder} more on order</div>
                          )}
                        </td>
                        <td className="is-left">
                          <div className="inv-main"><strong>{doseCount.toLocaleString()}</strong></div>
                          <div className="inv-sub">{item.dosesPerVial} per vial</div>
                        </td>
                        <td className="is-left">
                          <div className={`inv-main inv-nowrap${isExpiring ? ' is-warning' : ''}`}>{item.expiry}</div>
                          {isExpiring && <div className="inv-sub is-warning">Expiring soon</div>}
                        </td>
                        <td className="is-left">
                          {isLow ? <span className="inv-status is-low">Low stock</span>
                            : isExpiring ? <span className="inv-status is-due">Action due</span>
                            : <span className="inv-status is-ok">In stock</span>}
                        </td>
                        <td>
                          <div className="inv-actions">
                            <button type="button" className="inv-action" onClick={() => handleQuickAdjust(item.id, 20)} title="Add 20 vials">+20</button>
                            <button type="button" className="inv-action" onClick={() => handleQuickAdjust(item.id, -20)} title="Remove 20 vials">−20</button>
                            <button type="button" className="inv-action is-primary" onClick={() => setSelectedAuditVaccine(item)} title="View batch audit">
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
            {filteredInventory.length === 0 && (
              <p className="empty-state-text" style={{ gridColumn: '1 / -1' }}>
                No vaccines match the selected criteria.
              </p>
            )}
            {filteredInventory.map((item) => {
              const received = Math.max(item.capacity || 0, item.available || 0);
              const pct = received > 0
                ? Math.min(100, Math.round((item.available / received) * 100))
                : 0;
              const doseCount = item.availableDoses ?? item.available * item.dosesPerVial;
              const isLow = isLowStock(item);
              if (isOnOrder(item)) {
                return (
                  <div key={item.id} className="inventory-card-item">
                    <div className="inv-card-top">
                      <span className="category-tag">{String(item.category || 'routine').toUpperCase()}</span>
                      <span className="stock-badge badge-expiring">On order</span>
                    </div>
                    <h4 className="inv-card-name">{item.name}</h4>
                    <div className="inv-card-meta">
                      <span>Order: <strong>{item.lotNumber}</strong></span>
                      <span>Expiry: <strong>Set on receipt</strong></span>
                    </div>
                    <div className="inv-card-stock-block">
                      <div className="stock-header-flex">
                        <span>Ordered:</span>
                        <strong>{item.capacity} vials</strong>
                      </div>
                      <div className="doses-sub-line">Not in stock yet. Receive it when the delivery arrives.</div>
                    </div>
                    <div className="inv-card-actions">
                      <button type="button" className="btn-card-audit" onClick={() => setSelectedAuditVaccine(item)}>Audit Ledger</button>
                      <button type="button" className="btn-card-restock" onClick={() => setReceivingBatch(item)}>Receive</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={item.id} className={`inventory-card-item ${isLow ? 'card-low-stock' : ''}`}>
                  <div className="inv-card-top">
                    <span className="category-tag">{String(item.category || 'routine').toUpperCase()}</span>
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
        </>
        )}

        {view === 'formulary' && (
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
              <form onSubmit={handleRegisterFormSubmit} className="formulary-form">
                <div className="formulary-input-row">
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
                      disabled={Boolean(editingFormularyId)}
                      required
                    />
                  </div>
                  <div className="formulary-input-group formulary-input-group--mfr">
                    <label className="formulary-label" htmlFor="formulary-vaccine-mfr">
                      Manufacturer
                    </label>
                    <input
                      id="formulary-vaccine-mfr"
                      type="text"
                      className="formulary-text-input"
                      placeholder="e.g. Serum Institute"
                      value={newVaccineMfrInput}
                      onChange={(e) => setNewVaccineMfrInput(e.target.value)}
                      disabled={Boolean(editingFormularyId)}
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
                    <label className="formulary-label" htmlFor="formulary-vaccine-cost">
                      Cost / vial (LKR)
                    </label>
                    <input
                      id="formulary-vaccine-cost"
                      type="number"
                      min="0"
                      step="1"
                      className="formulary-text-input"
                      placeholder="Supplier cost"
                      value={newVaccineCostInput}
                      onChange={(e) => setNewVaccineCostInput(e.target.value)}
                      title="What the supplier charges per vial. Used on purchase orders."
                    />
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
                </div>
                <div className="formulary-input-row formulary-input-row--supplier">
                  <div className="formulary-input-group">
                    <label className="formulary-label" htmlFor="formulary-supplier-name">
                      Supplier
                    </label>
                    <input
                      id="formulary-supplier-name"
                      type="text"
                      className="formulary-text-input"
                      placeholder="e.g. State Pharmaceuticals Corporation"
                      value={newSupplierNameInput}
                      onChange={(e) => setNewSupplierNameInput(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <div className="formulary-input-group">
                    <label className="formulary-label" htmlFor="formulary-supplier-email">
                      Supplier email
                    </label>
                    <input
                      id="formulary-supplier-email"
                      type="email"
                      className="formulary-text-input"
                      placeholder="orders@supplier.lk"
                      value={newSupplierEmailInput}
                      onChange={(e) => setNewSupplierEmailInput(e.target.value)}
                      maxLength={200}
                      title="Purchase orders for this product are emailed here"
                    />
                  </div>
                  <div className="formulary-input-group formulary-input-group--action">
                    <span className="formulary-label formulary-label--spacer" aria-hidden="true">
                      &nbsp;
                    </span>
                    <div className="formulary-action-row">
                      <button type="submit" className="btn-register-vaccine">
                        {editingFormularyId ? 'Save changes' : 'Register product'}
                      </button>
                      {editingFormularyId && (
                        <button type="button" className="btn-toggle-registry" onClick={resetFormularyForm}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
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
                        {Number(row?.supplierCost) > 0 && (
                          <span className="pill-meta" title="Supplier cost per vial, used on purchase orders">
                            <span className="pill-meta-text">Cost LKR {Number(row.supplierCost).toLocaleString()}</span>
                          </span>
                        )}
                        {row?.supplierName && (
                          <span
                            className="pill-meta"
                            title={row.supplierEmail ? `Orders go to ${row.supplierEmail}` : 'No supplier email saved'}
                          >
                            <span className="pill-meta-text">{row.supplierName}</span>
                          </span>
                        )}
                        {row?.id && (
                          <button
                            type="button"
                            className="pill-remove-btn pill-edit-btn"
                            onClick={() => handleEditFormulation(row)}
                            title={`Edit ${vName}`}
                            aria-label={`Edit ${vName}`}
                          >
                            <IconPencil size={12} />
                          </button>
                        )}
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
        )}

        {view === 'vaults' && (
          coldVaults.length > 0 ? (
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
          ) : (
            <div className="hospital-appointments-table-wrapper inventory-empty-state">
              <h3>No cold vaults yet</h3>
              <p>Vault telemetry will appear here once storage units are linked.</p>
            </div>
          )
        )}

        {view === 'stock' && (
        <div className="inventory-footer-notice">
          <div className="footer-notice-text">
            <IconShield size={16} />
            <span>Stock, lot and vault records shown here come live from the hospital database.</span>
          </div>
          <button type="button" className="btn-sync-registry" onClick={handleRefreshRecords}>
            Refresh records
          </button>
        </div>
        )}
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
        inventoryItems={inventory.filter((item) => !isOnOrder(item))}
        onLogWastage={handleLogWastage}
      />

      <BatchAuditModal
        isOpen={Boolean(selectedAuditVaccine)}
        onClose={() => setSelectedAuditVaccine(null)}
        vaccine={selectedAuditVaccine}
      />

      <ReceiveOrderModal
        batch={receivingBatch}
        onClose={() => setReceivingBatch(null)}
        onReceive={handleReceiveOrder}
      />

      <InventoryAIInventoryWorkflow
        isOpen={isAIAgentOpen}
        onClose={() => setIsAIAgentOpen(false)}
        onApproved={loadAll}
      />
      {confirmDialog}
    </div>
  );
}
