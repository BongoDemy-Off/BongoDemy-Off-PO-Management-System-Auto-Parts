/**
 * Zaman Auto — PO Management System
 * app.js — All application logic
 */

'use strict';

/* =============================================
   STORAGE MODULE
   ============================================= */
const Storage = (() => {
  const PO_KEY = 'zamanAuto_pos';
  const CFG_KEY = 'zamanAuto_config';

  const defaultConfig = {
    vatPct: 10,
    taxPct: 3,
    paymentDays: 15,
    companyName: 'Zaman Auto',
    companyAddress: 'Dhaka, Bangladesh',
  };

  function getConfig() {
    try {
      return Object.assign({}, defaultConfig, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
    } catch { return defaultConfig; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(Object.assign(getConfig(), cfg)));
  }

  function getAll() {
    try { return JSON.parse(localStorage.getItem(PO_KEY) || '[]'); }
    catch { return []; }
  }

  function save(record) {
    const all = getAll();
    all.unshift(record);
    localStorage.setItem(PO_KEY, JSON.stringify(all));
  }

  function update(id, fields) {
    const all = getAll().map(r => r.id === id ? Object.assign(r, fields) : r);
    localStorage.setItem(PO_KEY, JSON.stringify(all));
  }

  function remove(id) {
    const all = getAll().filter(r => r.id !== id);
    localStorage.setItem(PO_KEY, JSON.stringify(all));
  }

  function getById(id) {
    return getAll().find(r => r.id === id) || null;
  }

  return { getConfig, saveConfig, getAll, save, update, remove, getById };
})();


/* =============================================
   TAX ENGINE
   ============================================= */
const TaxEngine = {
  /**
   * Including Tax: The unit price ALREADY includes the tax.
   * Back-calculate: base = unitPrice / (1 + taxPct/100)
   * taxAmount = unitPrice - base
   */
  includingTax(unitPrice, taxPct, vatPct, qty) {
    const factor = 1 + taxPct / 100;
    const basePrice = unitPrice / factor; // excl. tax
    const taxAmount = unitPrice - basePrice;
    const vatAmount = basePrice * (vatPct / 100);
    const totalBeforeVAT = unitPrice * qty;
    const totalVAT = vatAmount * qty;
    const totalTax = taxAmount * qty;
    const grandTotal = totalBeforeVAT + totalVAT;
    return { basePrice, taxAmount, vatAmount, totalBeforeVAT, totalVAT, totalTax, grandTotal, mode: 'including' };
  },

  /**
   * Excluding VAT: The unit price does NOT include VAT.
   * totalReceivable = unitPrice + (unitPrice * vatPct/100)
   * Tax is deducted: TDS = unitPrice * taxPct/100
   */
  excludingVAT(unitPrice, taxPct, vatPct, qty) {
    const vatAmount = unitPrice * (vatPct / 100);
    const taxAmount = unitPrice * (taxPct / 100);
    const priceWithVAT = unitPrice + vatAmount;
    const grandTotal = priceWithVAT * qty;
    const totalVAT = vatAmount * qty;
    const totalTax = taxAmount * qty;
    return { basePrice: unitPrice, taxAmount, vatAmount, priceWithVAT, grandTotal, totalVAT, totalTax, mode: 'excluding' };
  },

  fmt(n) { return Number(n).toFixed(2); },
  currency(n) { return '৳ ' + Number(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
};


/* =============================================
   WORKING DAYS CALCULATOR
   Fri/Sat = weekend (Bangladesh)
   ============================================= */
const PaymentCalc = {
  isWeekend(date) {
    const d = date.getDay();
    return d === 5 || d === 6; // 5=Friday, 6=Saturday
  },

  addWorkingDays(startDate, days) {
    const d = new Date(startDate);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      if (!this.isWeekend(d)) added++;
    }
    return d;
  },

  countWorkingDays(startDate, endDate) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    let count = 0;
    const cur = new Date(s);
    cur.setDate(cur.getDate() + 1);
    while (cur <= e) {
      if (!this.isWeekend(cur)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  },

  formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  toInputDate(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }
};


/* =============================================
   BILL GENERATOR
   ============================================= */
const BillGenerator = {
  generate(po) {
    const cfg = Storage.getConfig();
    const qty = po.deliveryStatus === 'partial' ? (po.partialQty || po.quantity) : po.quantity;
    const tax = po.taxMode === 'including'
      ? TaxEngine.includingTax(po.unitPrice, po.taxPct, po.vatPct, qty)
      : TaxEngine.excludingVAT(po.unitPrice, po.taxPct, po.vatPct, qty);

    const billDate = po.deliveryDate || po.poDate;
    const payDate = po.deliveryDate
      ? PaymentCalc.addWorkingDays(new Date(po.deliveryDate), po.paymentDays || 15)
      : null;

    return `
    <div class="bill-header-print">
      <div class="bill-company-name">${cfg.companyName}</div>
      <div class="bill-company-sub">${cfg.companyAddress}</div>
    </div>

    <div class="bill-title-line">
      <span>📄 PURCHASE ORDER — BILL</span>
      <span>Bill Date: ${PaymentCalc.formatDate(billDate)}</span>
    </div>

    <div class="bill-meta">
      <div class="bill-meta-row"><span class="lbl">Client Name:</span><span class="val">${po.clientName}</span></div>
      <div class="bill-meta-row"><span class="lbl">PO Number:</span><span class="val">${po.poNumber}</span></div>
      <div class="bill-meta-row"><span class="lbl">Client Info:</span><span class="val">${po.clientInfo || '—'}</span></div>
      <div class="bill-meta-row"><span class="lbl">PO Date:</span><span class="val">${PaymentCalc.formatDate(po.poDate)}</span></div>
      <div class="bill-meta-row"><span class="lbl">Delivery Status:</span><span class="val">${this.statusLabel(po.deliveryStatus)}</span></div>
      <div class="bill-meta-row"><span class="lbl">Delivery Date:</span><span class="val">${PaymentCalc.formatDate(po.deliveryDate)}</span></div>
      ${payDate ? `<div class="bill-meta-row"><span class="lbl">Payment Due:</span><span class="val">${PaymentCalc.formatDate(payDate)} (${po.paymentDays || 15} working days)</span></div>` : ''}
    </div>

    <table class="bill-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Product Description</th>
          <th>Qty</th>
          <th>Unit Price (৳)</th>
          <th>Amount (৳)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>${po.productDetails}</td>
          <td>${qty}</td>
          <td>${TaxEngine.currency(po.unitPrice)}</td>
          <td>${TaxEngine.currency(po.unitPrice * qty)}</td>
        </tr>
      </tbody>
    </table>

    <div class="bill-totals">
      <div class="bill-totals-row">
        <span>Sub Total (${qty} × ${TaxEngine.currency(po.unitPrice)})</span>
        <span>${TaxEngine.currency(po.unitPrice * qty)}</span>
      </div>
      ${po.taxMode === 'excluding' ? `
      <div class="bill-totals-row">
        <span>VAT @ ${po.vatPct}%</span>
        <span>+ ${TaxEngine.currency(tax.totalVAT)}</span>
      </div>
      <div class="bill-totals-row">
        <span>TDS (Tax @ ${po.taxPct}%) — Deducted at Source</span>
        <span>- ${TaxEngine.currency(tax.totalTax)}</span>
      </div>
      ` : `
      <div class="bill-totals-row">
        <span>VAT @ ${po.vatPct}% (on base price)</span>
        <span>+ ${TaxEngine.currency(tax.totalVAT)}</span>
      </div>
      <div class="bill-totals-row">
        <span>Tax ${po.taxPct}% (included in unit price)</span>
        <span>TDS: ${TaxEngine.currency(tax.totalTax)}</span>
      </div>
      `}
      <div class="bill-totals-row grand-total">
        <span>Total Receivable Amount</span>
        <span>${TaxEngine.currency(tax.grandTotal)}</span>
      </div>
    </div>

    <div class="bill-footer-print">
      <div class="sign-block"><div class="sign-line"></div>Prepared By</div>
      <div class="sign-block"><div class="sign-line"></div>Authorized Signatory</div>
      <div class="sign-block"><div class="sign-line"></div>Client Signature</div>
    </div>
    `;
  },

  statusLabel(s) {
    return { pending: 'Pending', partial: 'Partially Delivered', full: 'Fully Delivered' }[s] || s;
  }
};


/* =============================================
   UI HELPERS
   ============================================= */
function $(id) { return document.getElementById(id); }
function qsa(sel) { return document.querySelectorAll(sel); }

function showToast(msg, type = 'success') {
  const cont = $('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type] || '✅'}</span><span>${msg}</span>`;
  cont.appendChild(t);
  t.addEventListener('click', () => t.remove());
  setTimeout(() => t && t.remove(), 4000);
}

function genId() { return 'PO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }

function switchTab(name) {
  qsa('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  qsa('.section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + name));
}


/* =============================================
   LIVE CALCULATION (form page)
   ============================================= */
function recalculate() {
  const unitPrice = parseFloat($('unitPrice').value) || 0;
  const qty = parseFloat($('quantity').value) || 0;
  const vatPct = parseFloat($('vatPct').value) || 0;
  const taxPct = parseFloat($('taxPct').value) || 0;
  const mode = $('taxMode').value; // 'including' or 'excluding'

  if (unitPrice <= 0 || qty <= 0) {
    $('calcIncTax').textContent = '৳ 0.00';
    $('calcExcVAT').textContent = '৳ 0.00';
    $('calcVAT').textContent = '৳ 0.00';
    $('calcTDS').textContent = '৳ 0.00';
    $('calcTotal').textContent = '৳ 0.00';
    return;
  }

  let res;
  if (mode === 'including') {
    res = TaxEngine.includingTax(unitPrice, taxPct, vatPct, qty);
    $('calcIncTax').textContent = TaxEngine.currency(res.basePrice); // base after removing tax
    $('calcExcVAT').textContent = TaxEngine.currency(res.basePrice + res.vatAmount); // base + VAT
  } else {
    res = TaxEngine.excludingVAT(unitPrice, taxPct, vatPct, qty);
    $('calcIncTax').textContent = TaxEngine.currency(unitPrice / (1 + taxPct / 100)); // hypothetical base
    $('calcExcVAT').textContent = TaxEngine.currency(res.priceWithVAT); // unit + VAT
  }

  $('calcVAT').textContent = TaxEngine.currency(res.totalVAT);
  $('calcTDS').textContent = TaxEngine.currency(res.totalTax);
  $('calcTotal').textContent = TaxEngine.currency(res.grandTotal);
}

function updateDeliveryUI() {
  const status = $('deliveryStatus').value;
  const partialPanel = $('partialPanel');
  if (status === 'partial') {
    partialPanel.classList.add('visible');
  } else {
    partialPanel.classList.remove('visible');
  }
}

function updatePaymentDate() {
  const deliveryDate = $('deliveryDate').value;
  const days = parseInt($('paymentDays').value) || 15;

  if (!deliveryDate) {
    $('estimatedPayDate').textContent = '— (set delivery date)';
    $('workingDaysCount').textContent = '—';
    return;
  }

  const estimated = PaymentCalc.addWorkingDays(new Date(deliveryDate), days);
  $('estimatedPayDate').textContent = PaymentCalc.formatDate(estimated);

  const today = new Date();
  if (new Date(deliveryDate) <= today) {
    const count = PaymentCalc.countWorkingDays(new Date(deliveryDate), today);
    $('workingDaysCount').textContent = count + ' working days since delivery';
  } else {
    $('workingDaysCount').textContent = '—';
  }
}


/* =============================================
   SAVE PO
   ============================================= */
function savePO() {
  // Validate required fields
  const required = ['clientName', 'poNumber', 'poDate', 'productDetails', 'quantity', 'unitPrice'];
  let valid = true;
  required.forEach(id => {
    const el = $(id);
    if (!el.value.trim()) {
      el.style.borderColor = 'var(--danger)';
      valid = false;
    } else {
      el.style.borderColor = '';
    }
  });

  if (!valid) { showToast('Please fill all required fields.', 'error'); return; }

  const cfg = Storage.getConfig();
  const record = {
    id: genId(),
    createdAt: new Date().toISOString(),
    clientName: $('clientName').value.trim(),
    clientInfo: $('clientInfo').value.trim(),
    poNumber: $('poNumber').value.trim(),
    poDate: $('poDate').value,
    productDetails: $('productDetails').value.trim(),
    quantity: parseFloat($('quantity').value),
    unitPrice: parseFloat($('unitPrice').value),
    vatPct: parseFloat($('vatPct').value) || cfg.vatPct,
    taxPct: parseFloat($('taxPct').value) || cfg.taxPct,
    taxMode: $('taxMode').value,
    deliveryStatus: $('deliveryStatus').value,
    partialQty: parseFloat($('partialQty').value) || null,
    deliveryDate: $('deliveryDate').value || null,
    paymentDays: parseInt($('paymentDays').value) || cfg.paymentDays,
    chequeNumber: $('chequeNumber').value.trim(),
    chequeDate: $('chequeDate').value,
    notes: $('notes').value.trim(),
  };

  Storage.save(record);
  showToast(`PO ${record.poNumber} saved successfully! ✅`);
  resetForm();
  renderRecords();
  updateStats();
  switchTab('records');
}


/* =============================================
   RESET FORM
   ============================================= */
function resetForm() {
  const cfg = Storage.getConfig();
  $('poForm').reset();
  $('vatPct').value = cfg.vatPct;
  $('taxPct').value = cfg.taxPct;
  $('paymentDays').value = cfg.paymentDays;
  $('poDate').value = new Date().toISOString().split('T')[0];
  $('partialPanel').classList.remove('visible');
  recalculate();
}


/* =============================================
   RENDER RECORDS TABLE
   ============================================= */
function renderRecords(filter = '') {
  const all = Storage.getAll();
  const tbody = $('recordsTbody');

  let rows = all;
  if (filter) {
    const q = filter.toLowerCase();
    rows = all.filter(r =>
      r.clientName.toLowerCase().includes(q) ||
      r.poNumber.toLowerCase().includes(q) ||
      r.productDetails.toLowerCase().includes(q)
    );
  }

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">📭 No PO records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const qty = r.deliveryStatus === 'partial' ? (r.partialQty || r.quantity) : r.quantity;
    const tax = r.taxMode === 'including'
      ? TaxEngine.includingTax(r.unitPrice, r.taxPct, r.vatPct, qty)
      : TaxEngine.excludingVAT(r.unitPrice, r.taxPct, r.vatPct, qty);

    const statusBadge = {
      pending: '<span class="delivery-badge pending">⏳ Pending</span>',
      partial: '<span class="delivery-badge partial">📦 Partial</span>',
      full:    '<span class="delivery-badge full">✅ Full</span>',
    }[r.deliveryStatus] || r.deliveryStatus;

    return `
    <tr>
      <td>${r.poNumber}</td>
      <td>${PaymentCalc.formatDate(r.poDate)}</td>
      <td>${r.clientName}</td>
      <td>${r.productDetails.substring(0, 30)}${r.productDetails.length > 30 ? '…' : ''}</td>
      <td>${qty}</td>
      <td>${TaxEngine.currency(r.unitPrice)}</td>
      <td>${TaxEngine.currency(tax.grandTotal)}</td>
      <td>${statusBadge}</td>
      <td>${r.chequeNumber || '—'}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm btn-icon" onclick="viewBill('${r.id}')" title="View Bill">🧾</button>
          <button class="btn btn-accent btn-sm btn-icon" onclick="editRecord('${r.id}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteRecord('${r.id}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Update badge count
  $('recordsBadge').textContent = all.length;
}


/* =============================================
   RENDER VAT/TAX TABLE
   ============================================= */
function renderVATTable() {
  const all = Storage.getAll();
  const tbody = $('vatTbody');

  if (all.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">📭 No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = all.map(r => {
    const qty = r.deliveryStatus === 'partial' ? (r.partialQty || r.quantity) : r.quantity;
    const tax = r.taxMode === 'including'
      ? TaxEngine.includingTax(r.unitPrice, r.taxPct, r.vatPct, qty)
      : TaxEngine.excludingVAT(r.unitPrice, r.taxPct, r.vatPct, qty);

    return `
    <tr>
      <td>${r.poNumber}</td>
      <td>${PaymentCalc.formatDate(r.poDate)}</td>
      <td>${r.chequeNumber || '—'}</td>
      <td>${PaymentCalc.formatDate(r.chequeDate)}</td>
      <td>${TaxEngine.currency(r.unitPrice * qty)}</td>
      <td>${TaxEngine.currency(tax.grandTotal)}</td>
      <td>${TaxEngine.currency(tax.totalVAT)}</td>
      <td>${TaxEngine.currency(tax.totalTax)}</td>
      <td><span class="tag">${r.taxMode === 'including' ? 'Inc. Tax' : 'Excl. VAT'}</span></td>
    </tr>`;
  }).join('');
}


/* =============================================
   BILL VIEW
   ============================================= */
function viewBill(id) {
  const po = Storage.getById(id);
  if (!po) return;
  $('printArea').innerHTML = BillGenerator.generate(po);
  $('billView').classList.add('open');
}

function closeBill() {
  $('billView').classList.remove('open');
}

function printBill() { window.print(); }


/* =============================================
   DELETE & EDIT
   ============================================= */
function deleteRecord(id) {
  if (!confirm('Delete this PO record? This cannot be undone.')) return;
  Storage.remove(id);
  renderRecords();
  renderVATTable();
  updateStats();
  showToast('Record deleted.', 'warning');
}

function editRecord(id) {
  const r = Storage.getById(id);
  if (!r) return;

  // Populate form
  $('clientName').value = r.clientName || '';
  $('clientInfo').value = r.clientInfo || '';
  $('poNumber').value = r.poNumber || '';
  $('poDate').value = r.poDate || '';
  $('productDetails').value = r.productDetails || '';
  $('quantity').value = r.quantity || '';
  $('unitPrice').value = r.unitPrice || '';
  $('vatPct').value = r.vatPct || 10;
  $('taxPct').value = r.taxPct || 3;
  $('taxMode').value = r.taxMode || 'including';
  $('deliveryStatus').value = r.deliveryStatus || 'pending';
  $('partialQty').value = r.partialQty || '';
  $('deliveryDate').value = r.deliveryDate || '';
  $('paymentDays').value = r.paymentDays || 15;
  $('chequeNumber').value = r.chequeNumber || '';
  $('chequeDate').value = r.chequeDate || '';
  $('notes').value = r.notes || '';

  updateDeliveryUI();
  recalculate();
  updatePaymentDate();

  // Delete old, re-save on next save
  Storage.remove(id);
  switchTab('new-po');
  showToast(`Editing PO: ${r.poNumber}. Save to update.`, 'info');
}


/* =============================================
   STATS
   ============================================= */
function updateStats() {
  const all = Storage.getAll();
  $('statTotal').textContent = all.length;
  $('statPending').textContent = all.filter(r => r.deliveryStatus === 'pending').length;
  $('statPartial').textContent = all.filter(r => r.deliveryStatus === 'partial').length;
  $('statFull').textContent = all.filter(r => r.deliveryStatus === 'full').length;

  const totalVal = all.reduce((sum, r) => {
    const qty = r.deliveryStatus === 'partial' ? (r.partialQty || r.quantity) : r.quantity;
    const tax = r.taxMode === 'including'
      ? TaxEngine.includingTax(r.unitPrice, r.taxPct, r.vatPct, qty)
      : TaxEngine.excludingVAT(r.unitPrice, r.taxPct, r.vatPct, qty);
    return sum + tax.grandTotal;
  }, 0);
  $('statValue').textContent = TaxEngine.currency(totalVal);
}


/* =============================================
   SETTINGS
   ============================================= */
function saveSettings() {
  const cfg = {
    vatPct: parseFloat($('sVat').value) || 10,
    taxPct: parseFloat($('sTax').value) || 3,
    paymentDays: parseInt($('sDays').value) || 15,
    companyName: $('sCompany').value.trim() || 'Zaman Auto',
    companyAddress: $('sAddress').value.trim() || 'Dhaka, Bangladesh',
  };
  Storage.saveConfig(cfg);

  // Update header
  document.querySelector('.header-title').textContent = cfg.companyName;

  showToast('Settings saved!');
  loadSettings();
}

function loadSettings() {
  const cfg = Storage.getConfig();
  $('sVat').value = cfg.vatPct;
  $('sTax').value = cfg.taxPct;
  $('sDays').value = cfg.paymentDays;
  $('sCompany').value = cfg.companyName;
  $('sAddress').value = cfg.companyAddress;

  // Also update form defaults
  $('vatPct').value = cfg.vatPct;
  $('taxPct').value = cfg.taxPct;
  $('paymentDays').value = cfg.paymentDays;
}


/* =============================================
   EXPORT CSV
   ============================================= */
function exportCSV() {
  const all = Storage.getAll();
  if (!all.length) { showToast('No records to export.', 'warning'); return; }

  const headers = ['PO Number','Client Name','PO Date','Product','Qty','Unit Price','Bill Amount','VAT','TDS','Status','Cheque No','Cheque Date','Delivery Date'];
  const rows = all.map(r => {
    const qty = r.deliveryStatus === 'partial' ? (r.partialQty || r.quantity) : r.quantity;
    const tax = r.taxMode === 'including'
      ? TaxEngine.includingTax(r.unitPrice, r.taxPct, r.vatPct, qty)
      : TaxEngine.excludingVAT(r.unitPrice, r.taxPct, r.vatPct, qty);
    return [
      r.poNumber, r.clientName, r.poDate, r.productDetails, qty,
      r.unitPrice, tax.grandTotal.toFixed(2), tax.totalVAT.toFixed(2), tax.totalTax.toFixed(2),
      BillGenerator.statusLabel(r.deliveryStatus), r.chequeNumber || '', r.chequeDate || '', r.deliveryDate || ''
    ].map(c => `"${String(c).replace(/"/g,'""')}"`).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ZamanAuto_PO_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  showToast('CSV exported!');
}


/* =============================================
   INIT
   ============================================= */
document.addEventListener('DOMContentLoaded', () => {
  // Set today's date
  $('poDate').value = new Date().toISOString().split('T')[0];

  // Load config
  loadSettings();
  renderRecords();
  renderVATTable();
  updateStats();

  // Header date
  $('headerDate').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });

  // Form events
  ['unitPrice', 'quantity', 'vatPct', 'taxPct', 'taxMode'].forEach(id => {
    $(id)?.addEventListener('input', recalculate);
    $(id)?.addEventListener('change', recalculate);
  });

  $('deliveryStatus').addEventListener('change', updateDeliveryUI);
  $('deliveryDate').addEventListener('change', updatePaymentDate);
  $('paymentDays').addEventListener('input', updatePaymentDate);

  // Search
  $('searchInput').addEventListener('input', e => renderRecords(e.target.value));

  // Tab nav
  qsa('.nav-tab').forEach(t => {
    t.addEventListener('click', () => {
      switchTab(t.dataset.tab);
      if (t.dataset.tab === 'vat') renderVATTable();
    });
  });

  // Close bill on backdrop click
  $('billView').addEventListener('click', e => {
    if (e.target === $('billView')) closeBill();
  });

  recalculate();
});
