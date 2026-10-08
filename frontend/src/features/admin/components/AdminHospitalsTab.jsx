import { useState } from 'react';
import { IconHospital, IconPackage, IconSearch, IconSnowflake } from '../../../shared/icons/AppIcons';

export default function AdminHospitalsTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('all');
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isAllocateModalOpen, setIsAllocateModalOpen] = useState(false);
  const [allocateData, setAllocateData] = useState({
    vaccine: 'Pfizer Bivalent mRNA',
    batchLot: 'PF-2026-X8',
    quantity: 500,
    dispatchNotes: 'Routine monthly quota replenishment under National Cold-Chain Logistics.',
  });
  const [notification, setNotification] = useState('');

  const showToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3500);
  };

  // Hospital directory with rich performance and vaccine inventory telemetry
  const [hospitals, setHospitals] = useState([
    {
      id: 'HOSP-001',
      name: 'Lanka Hospital Colombo',
      code: 'MOH-PVT-0042',
      province: 'Western',
      city: 'Colombo 05',
      director: 'Dr. Prasad Senanayake',
      phone: '011 543 0000',
      activeBooths: 6,
      totalDoses: '48,920',
      todayAppointments: 160,
      todayCompleted: 142,
      completionRate: '97.2%',
      avgWaitTime: '8.4 mins',
      coldChainTemp: '3.8°C',
      tempStatus: 'Optimal',
      wastageRate: '0.32%',
      staffDoctors: 14,
      staffNurses: 22,
      vaccinesProvided: [
        { name: 'Pfizer Bivalent mRNA', stock: 1200, allocatedTotal: 18000, lot: 'PF-9082', exp: 'Nov 2027', temp: '-80°C' },
        { name: 'Hepatitis B Recombinant', stock: 850, allocatedTotal: 14200, lot: 'HB-8821', exp: 'Oct 2027', temp: '+4°C' },
        { name: 'Influenza (Quadrivalent)', stock: 950, allocatedTotal: 12000, lot: 'INF-7012', exp: 'May 2027', temp: '+4°C' },
        { name: 'Moderna Spikevax', stock: 400, allocatedTotal: 6500, lot: 'MD-4419', exp: 'Aug 2027', temp: '-20°C' },
        { name: 'MMR Live Attenuated', stock: 320, allocatedTotal: 4800, lot: 'MMR-3301', exp: 'Jan 2028', temp: '+4°C' },
      ],
    },
    {
      id: 'HOSP-002',
      name: 'Asiri Central Hospital',
      code: 'MOH-PVT-0089',
      province: 'Western',
      city: 'Norris Canal Rd, Colombo 10',
      director: 'Dr. Manjula Wijeratne',
      phone: '011 458 0000',
      activeBooths: 5,
      totalDoses: '36,450',
      todayAppointments: 110,
      todayCompleted: 98,
      completionRate: '96.5%',
      avgWaitTime: '9.2 mins',
      coldChainTemp: '4.1°C',
      tempStatus: 'Optimal',
      wastageRate: '0.41%',
      staffDoctors: 10,
      staffNurses: 16,
      vaccinesProvided: [
        { name: 'Pfizer Bivalent mRNA', stock: 900, allocatedTotal: 14000, lot: 'PF-9082', exp: 'Nov 2027', temp: '-80°C' },
        { name: 'Hepatitis B Recombinant', stock: 600, allocatedTotal: 10500, lot: 'HB-8821', exp: 'Oct 2027', temp: '+4°C' },
        { name: 'Influenza (Quadrivalent)', stock: 750, allocatedTotal: 8900, lot: 'INF-7012', exp: 'May 2027', temp: '+4°C' },
        { name: 'Moderna Spikevax', stock: 300, allocatedTotal: 4200, lot: 'MD-4419', exp: 'Aug 2027', temp: '-20°C' },
      ],
    },
    {
      id: 'HOSP-003',
      name: 'Delmon Hospital',
      code: 'MOH-PVT-0112',
      province: 'Western',
      city: 'Wellawatte, Colombo 06',
      director: 'Dr. C. Jayawardena',
      phone: '011 255 8800',
      activeBooths: 3,
      totalDoses: '21,180',
      todayAppointments: 85,
      todayCompleted: 74,
      completionRate: '95.8%',
      avgWaitTime: '11.0 mins',
      coldChainTemp: '3.6°C',
      tempStatus: 'Optimal',
      wastageRate: '0.38%',
      staffDoctors: 6,
      staffNurses: 10,
      vaccinesProvided: [
        { name: 'Pfizer Bivalent mRNA', stock: 450, allocatedTotal: 8200, lot: 'PF-9082', exp: 'Nov 2027', temp: '-80°C' },
        { name: 'Hepatitis B Recombinant', stock: 520, allocatedTotal: 7100, lot: 'HB-8821', exp: 'Oct 2027', temp: '+4°C' },
        { name: 'Influenza (Quadrivalent)', stock: 400, allocatedTotal: 5800, lot: 'INF-7012', exp: 'May 2027', temp: '+4°C' },
      ],
    },
    {
      id: 'HOSP-004',
      name: 'Teaching Hospital Kandy',
      code: 'MOH-GOV-0012',
      province: 'Central',
      city: 'William Gopallawa Mawatha, Kandy',
      director: 'Dr. S. K. Ekanayake',
      phone: '081 222 2261',
      activeBooths: 6,
      totalDoses: '54,120',
      todayAppointments: 130,
      todayCompleted: 110,
      completionRate: '98.1%',
      avgWaitTime: '7.8 mins',
      coldChainTemp: '4.0°C',
      tempStatus: 'Optimal',
      wastageRate: '0.29%',
      staffDoctors: 16,
      staffNurses: 28,
      vaccinesProvided: [
        { name: 'Pfizer Bivalent mRNA', stock: 1500, allocatedTotal: 22000, lot: 'PF-9082', exp: 'Nov 2027', temp: '-80°C' },
        { name: 'Hepatitis B Recombinant', stock: 1100, allocatedTotal: 16400, lot: 'HB-8821', exp: 'Oct 2027', temp: '+4°C' },
        { name: 'Influenza (Quadrivalent)', stock: 1300, allocatedTotal: 14200, lot: 'INF-7012', exp: 'May 2027', temp: '+4°C' },
        { name: 'MMR Live Attenuated', stock: 650, allocatedTotal: 7200, lot: 'MMR-3301', exp: 'Jan 2028', temp: '+4°C' },
      ],
    },
    {
      id: 'HOSP-005',
      name: 'Karapitiya National Hospital',
      code: 'MOH-GOV-0028',
      province: 'Southern',
      city: 'Karapitiya, Galle',
      director: 'Dr. Shelton De Silva',
      phone: '091 223 2176',
      activeBooths: 4,
      totalDoses: '32,840',
      todayAppointments: 95,
      todayCompleted: 88,
      completionRate: '97.0%',
      avgWaitTime: '8.8 mins',
      coldChainTemp: '3.9°C',
      tempStatus: 'Optimal',
      wastageRate: '0.35%',
      staffDoctors: 8,
      staffNurses: 14,
      vaccinesProvided: [
        { name: 'Pfizer Bivalent mRNA', stock: 800, allocatedTotal: 12500, lot: 'PF-9082', exp: 'Nov 2027', temp: '-80°C' },
        { name: 'Hepatitis B Recombinant', stock: 750, allocatedTotal: 11000, lot: 'HB-8821', exp: 'Oct 2027', temp: '+4°C' },
        { name: 'Influenza (Quadrivalent)', stock: 620, allocatedTotal: 7800, lot: 'INF-7012', exp: 'May 2027', temp: '+4°C' },
      ],
    },
  ]);

  // Handle Vaccine Allocation Dispatch
  const handleAllocateSubmit = (e) => {
    e.preventDefault();
    if (!selectedHospital) return;

    const qty = parseInt(allocateData.quantity, 10) || 100;
    setHospitals((prev) =>
      prev.map((h) => {
        if (h.id !== selectedHospital.id) return h;
        const existingIdx = h.vaccinesProvided.findIndex((v) => v.name === allocateData.vaccine);
        let updatedVaccines = [...h.vaccinesProvided];
        if (existingIdx >= 0) {
          updatedVaccines[existingIdx] = {
            ...updatedVaccines[existingIdx],
            stock: updatedVaccines[existingIdx].stock + qty,
            allocatedTotal: updatedVaccines[existingIdx].allocatedTotal + qty,
            lot: allocateData.batchLot,
          };
        } else {
          updatedVaccines.push({
            name: allocateData.vaccine,
            stock: qty,
            allocatedTotal: qty,
            lot: allocateData.batchLot,
            exp: 'Dec 2027',
            temp: '+4°C',
          });
        }
        return { ...h, vaccinesProvided: updatedVaccines };
      })
    );

    // Also update selectedHospital
    setSelectedHospital((prev) => {
      if (!prev) return null;
      const existingIdx = prev.vaccinesProvided.findIndex((v) => v.name === allocateData.vaccine);
      let updatedVaccines = [...prev.vaccinesProvided];
      if (existingIdx >= 0) {
        updatedVaccines[existingIdx] = {
          ...updatedVaccines[existingIdx],
          stock: updatedVaccines[existingIdx].stock + qty,
          allocatedTotal: updatedVaccines[existingIdx].allocatedTotal + qty,
          lot: allocateData.batchLot,
        };
      } else {
        updatedVaccines.push({
          name: allocateData.vaccine,
          stock: qty,
          allocatedTotal: qty,
          lot: allocateData.batchLot,
          exp: 'Dec 2027',
          temp: '+4°C',
        });
      }
      return { ...prev, vaccinesProvided: updatedVaccines };
    });

    showToast(`✅ Dispatched ${qty} doses of ${allocateData.vaccine} to ${selectedHospital.name}`);
    setIsAllocateModalOpen(false);
  };

  // Filter Hospitals
  const filteredHospitals = hospitals.filter((h) => {
    if (provinceFilter !== 'all' && h.province !== provinceFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        h.name.toLowerCase().includes(q) ||
        h.code.toLowerCase().includes(q) ||
        h.city.toLowerCase().includes(q) ||
        h.director.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="admin-hospitals-page">
      {/* Toast Notification */}
      {notification && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{ maxWidth: '1060px', margin: '0 auto 20px', width: '100%' }}
        >
          {notification}
        </div>
      )}

      {/* Main Container Card */}
      <div className="doctor-card admin-main-card">
        <div className="doctor-card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div className="doctor-card-title">
              <span style={{ display: 'inline-flex' }}><IconHospital size={22} /></span>
              Hospital Centers Performance &amp; Vaccine Supply
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
              Track hospital immunization metrics, cold-chain compliance, wastage rates, and manage vaccine batch allocations.
            </p>
          </div>

          {/* Province Filter */}
          <div className="doctor-filter-pills">
            <button
              type="button"
              className={`doctor-filter-btn ${provinceFilter === 'all' ? 'active' : ''}`}
              onClick={() => setProvinceFilter('all')}
            >
              All Regions ({hospitals.length})
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${provinceFilter === 'Western' ? 'active' : ''}`}
              onClick={() => setProvinceFilter('Western')}
            >
              Western
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${provinceFilter === 'Central' ? 'active' : ''}`}
              onClick={() => setProvinceFilter('Central')}
            >
              Central
            </button>
            <button
              type="button"
              className={`doctor-filter-btn ${provinceFilter === 'Southern' ? 'active' : ''}`}
              onClick={() => setProvinceFilter('Southern')}
            >
              Southern
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="doctor-search-bar">
          <span className="doctor-search-icon" style={{ display: 'inline-flex' }}><IconSearch size={16} /></span>
          <input
            type="text"
            className="doctor-search-input"
            placeholder="Search hospitals by name, MOH hospital code, district, or medical director..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Hospitals Table */}
        <div className="doctor-table-wrapper">
          <table className="doctor-table">
            <thead>
              <tr>
                <th>Hospital Center</th>
                <th>Location / Code</th>
                <th>Active Booths</th>
                <th>Doses Today</th>
                <th>Completion Rate</th>
                <th>Cold Chain Temp</th>
                <th>Wastage %</th>
                <th>Performance &amp; Supply</th>
              </tr>
            </thead>
            <tbody>
              {filteredHospitals.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: '#94a3b8' }}>
                    No hospitals found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredHospitals.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <div className="doctor-patient-cell">
                        <span
                          className="doctor-patient-name-link"
                          onClick={() => {
                            setSelectedHospital(h);
                            setIsDetailModalOpen(true);
                          }}
                        >
                          {h.name}
                        </span>
                        <span className="doctor-patient-sub" style={{ color: '#94a3b8' }}>
                          Director: {h.director} • Tel: {h.phone}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.85rem' }}>
                        <strong style={{ color: '#ffffff' }}>{h.city}</strong>
                        <div style={{ color: '#38bdf8', fontWeight: 600, marginTop: '2px' }}>{h.code}</div>
                      </div>
                    </td>
                    <td>
                      <span className="admin-pill-badge blue">
                        {h.activeBooths} Booths
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: '#34d399' }}>
                        {h.todayCompleted} / {h.todayAppointments}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 800, color: '#34d399' }}>{h.completionRate}</span>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>({h.avgWaitTime})</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: '#38bdf8' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <IconSnowflake size={14} /> {h.coldChainTemp}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: parseFloat(h.wastageRate) < 0.5 ? '#34d399' : '#fbbf24' }}>
                        {h.wastageRate}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="doctor-table-btn"
                        style={{ background: '#0369a1', color: '#ffffff', borderColor: '#38bdf8' }}
                        onClick={() => {
                          setSelectedHospital(h);
                          setIsDetailModalOpen(true);
                        }}
                      >
                        📊 Inspect Performance
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hospital Full Performance & Vaccine Supply Modal */}
      {isDetailModalOpen && selectedHospital && (
        <div className="doctor-modal-overlay" onClick={() => setIsDetailModalOpen(false)}>
          <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '820px' }}>
            <div className="doctor-modal-header" style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0369a1 100%)' }}>
              <div>
                <h3 className="doctor-modal-title">{selectedHospital.name}</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
                  Hospital ID: {selectedHospital.code} • {selectedHospital.city} ({selectedHospital.province} Province)
                </p>
              </div>
              <button type="button" className="doctor-modal-close-btn" onClick={() => setIsDetailModalOpen(false)}>
                &times;
              </button>
            </div>

            <div className="doctor-modal-body">
              {/* Performance Metrics Quad Ribbon */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '18px' }}>
                <div style={{ background: '#111a2e', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '10px', padding: '12px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#34d399', fontWeight: 700 }}>Total Doses</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>{selectedHospital.totalDoses}</div>
                </div>

                <div style={{ background: '#111a2e', border: '1px solid rgba(2, 132, 199, 0.3)', borderRadius: '10px', padding: '12px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#38bdf8', fontWeight: 700 }}>On-Time Rate</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>{selectedHospital.completionRate}</div>
                </div>

                <div style={{ background: '#111a2e', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '10px', padding: '12px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#38bdf8', fontWeight: 700 }}>Cold Chain Vault</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>{selectedHospital.coldChainTemp}</div>
                </div>

                <div style={{ background: '#111a2e', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '10px', padding: '12px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#fbbf24', fontWeight: 700 }}>Wastage Rate</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>{selectedHospital.wastageRate}</div>
                </div>
              </div>

              {/* Hospital Metadata */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', background: '#111a2e', border: '1px solid rgba(255, 255, 255, 0.08)', padding: '14px 16px', borderRadius: '10px', marginBottom: '18px', fontSize: '0.84rem' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>Medical Director:</span>
                  <div style={{ fontWeight: 700, color: '#ffffff', marginTop: '2px' }}>{selectedHospital.director}</div>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Active Clinical Staff:</span>
                  <div style={{ fontWeight: 700, color: '#ffffff', marginTop: '2px' }}>{selectedHospital.staffDoctors} Doctors • {selectedHospital.staffNurses} Nurses</div>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Average Patient Wait Time:</span>
                  <div style={{ fontWeight: 700, color: '#34d399', marginTop: '2px' }}>{selectedHospital.avgWaitTime}</div>
                </div>
              </div>

              {/* Vaccines Provided & Stock Allocation Table */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, color: '#ffffff', fontSize: '1rem', fontWeight: 800 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <IconPackage size={16} /> Vaccines Provided &amp; Live Stock Levels
                    </span>
                  </h4>
                  <button
                    type="button"
                    className="doctor-table-btn"
                    style={{ background: '#0369a1', color: '#fff', borderColor: '#38bdf8', fontSize: '0.82rem' }}
                    onClick={() => setIsAllocateModalOpen(true)}
                  >
                    + Provide / Allocate Vaccines
                  </button>
                </div>

                <div className="doctor-table-wrapper" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                  <table className="doctor-table" style={{ fontSize: '0.84rem' }}>
                    <thead>
                      <tr>
                        <th>Vaccine Name</th>
                        <th>Current Vault Stock</th>
                        <th>Total Doses Supplied</th>
                        <th>Batch Lot #</th>
                        <th>Expiry Date</th>
                        <th>Storage Temp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedHospital.vaccinesProvided.map((v, idx) => (
                        <tr key={idx}>
                          <td>
                            <strong style={{ color: '#ffffff' }}>{v.name}</strong>
                          </td>
                          <td>
                            <span style={{ fontWeight: 800, color: v.stock < 500 ? '#fbbf24' : '#34d399' }}>
                              {v.stock} doses
                            </span>
                          </td>
                          <td style={{ color: '#cbd5e1' }}>{v.allocatedTotal} doses</td>
                          <td>
                            <span className="admin-id-pill" style={{ fontSize: '0.75rem', color: '#38bdf8' }}>{v.lot}</span>
                          </td>
                          <td style={{ color: '#94a3b8' }}>{v.exp}</td>
                          <td>
                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>{v.temp}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="doctor-modal-footer">
              <button
                type="button"
                className="doctor-btn-cancel"
                onClick={() => setIsDetailModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="doctor-btn-submit"
                style={{ background: '#0369a1' }}
                onClick={() => setIsAllocateModalOpen(true)}
              >
                + Allocate Vaccine Quota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vaccine Allocation / Dispatch Modal */}
      {isAllocateModalOpen && selectedHospital && (
        <div className="doctor-modal-overlay" onClick={() => setIsAllocateModalOpen(false)}>
          <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="doctor-modal-header" style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)' }}>
              <div>
                <h3 className="doctor-modal-title">Provide Vaccine Stock</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.9)' }}>
                  Dispatch to {selectedHospital.name} ({selectedHospital.code})
                </p>
              </div>
              <button type="button" className="doctor-modal-close-btn" onClick={() => setIsAllocateModalOpen(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleAllocateSubmit}>
              <div className="doctor-modal-body">
                <div className="doctor-form-group">
                  <label className="doctor-form-label">Vaccine Formulation</label>
                  <select
                    className="doctor-form-select"
                    value={allocateData.vaccine}
                    onChange={(e) => setAllocateData({ ...allocateData, vaccine: e.target.value })}
                  >
                    <option value="Pfizer Bivalent mRNA">Pfizer Bivalent mRNA (Ultra-Cold -80°C)</option>
                    <option value="Hepatitis B Recombinant">Hepatitis B Recombinant (+2°C to +8°C)</option>
                    <option value="Influenza (Quadrivalent)">Influenza Quadrivalent (+2°C to +8°C)</option>
                    <option value="Moderna Spikevax">Moderna Spikevax (-20°C)</option>
                    <option value="MMR Live Attenuated">MMR Live Attenuated (+2°C to +8°C)</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="doctor-form-group">
                    <label className="doctor-form-label">Manufacturer Batch Lot #</label>
                    <input
                      type="text"
                      className="doctor-form-input"
                      value={allocateData.batchLot}
                      onChange={(e) => setAllocateData({ ...allocateData, batchLot: e.target.value })}
                      required
                    />
                  </div>

                  <div className="doctor-form-group">
                    <label className="doctor-form-label">Quantity (Doses)</label>
                    <input
                      type="number"
                      min="50"
                      step="50"
                      className="doctor-form-input"
                      value={allocateData.quantity}
                      onChange={(e) => setAllocateData({ ...allocateData, quantity: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="doctor-form-group">
                  <label className="doctor-form-label">National Logistics Notes</label>
                  <textarea
                    className="doctor-form-textarea"
                    rows={3}
                    value={allocateData.dispatchNotes}
                    onChange={(e) => setAllocateData({ ...allocateData, dispatchNotes: e.target.value })}
                  />
                </div>
              </div>

              <div className="doctor-modal-footer">
                <button
                  type="button"
                  className="doctor-btn-cancel"
                  onClick={() => setIsAllocateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="doctor-btn-submit"
                  style={{ background: '#059669' }}
                >
                  Confirm Dispatch &amp; Log Quota
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
