// =============================================================
// CRM MODULE — SIEC (Aquilon ERP)  ·  API-connected version
// Dashboard · Lead Registration · Contacted Leads · Deals · Closed Won · Activities Log
// Set window.CRM_API_BASE in crm.html before loading this file.
// =============================================================

// ---------- icons used by the shared helpers ----------
function iconX() { return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>`; }
function iconSave() { return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>`; }
function iconTruck() { return `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`; }
function iconChevronLeft() { return `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>`; }
function iconChevronRight() { return `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>`; }

// =============================================================
// API LAYER
// =============================================================
var API_BASE = String(window.CRM_API_BASE || '').replace(/\/$/, '');
var LEAD_API = API_BASE + '/api/crm/v1/lead';
var CRM_API = API_BASE + '/api/crm/v1';
var STAFF_API = API_BASE + '/api/crm/v1/staff/dropdown';

// JWT: reads the token your ERP login stored. Override with window.CRM_TOKEN_KEY = 'yourKey'
// or window.CRM_GET_TOKEN = function () { return ...; } in crm.html before this file.
function authToken() {
  try {
    if (typeof window.CRM_GET_TOKEN === 'function') return window.CRM_GET_TOKEN() || '';
    return localStorage.getItem(window.CRM_TOKEN_KEY || 'token') || '';
  } catch (e) { return ''; }
}

async function api(method, url, body, formData) {
  var opt = { method: method, headers: {} };
  var tok = authToken();
  if (tok) opt.headers['Authorization'] = 'Bearer ' + tok;
  if (formData) opt.body = formData;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  var res;
  try { res = await fetch(url, opt); }
  catch (e) { throw new Error('Cannot reach the server. Please check your connection.'); }
  if (res.status === 401) throw new Error('Session expired. Please log in again.');
  if (res.status === 403) throw new Error('You do not have permission for this action.');
  if (res.status === 204) return null;
  var text = await res.text(), data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    var msg = (data && typeof data === 'object' && (data.message || data.error)) || (typeof data === 'string' && data.slice(0, 160)) || '';
    throw new Error(msg || ('Request failed (' + res.status + ')'));
  }
  return data;
}
function qs(o) {
  return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null && o[k] !== 'all'; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
}

// one write at a time: blocks double-clicks, shows server errors as toasts, never leaves the UI half-updated
var saving = false;
async function run(fn) {
  if (saving) return;
  saving = true;
  var btns = document.querySelectorAll('#modalRoot button[onclick*="save"], #modalRoot button[onclick*="confirm"]');
  btns.forEach(function (b) { b.disabled = true; b.style.opacity = '.6'; });
  try { await fn(); }
  catch (e) { showToast(e.message || 'Something went wrong', 'error'); }
  finally {
    // re-enable (modal stays open after a validation or server error; after success it is already gone)
    btns.forEach(function (b) { b.disabled = false; b.style.opacity = ''; });
    saving = false;
  }
}
function bad(msg) { showToast(msg, 'error'); }

// =============================================================
// UI HELPERS (toast, modal, table, pagination)
// =============================================================
function showToast(message, kind) {
  kind = kind || 'success';
  var wrap = document.getElementById('toastWrap');
  var colors = { success: 'bg-green-600', info: 'bg-primary', warning: 'bg-amber-600', error: 'bg-red-600' };
  var el = document.createElement('div');
  el.className = 'toast ' + colors[kind] + ' text-white text-sm font-semibold px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-xs';
  var s = document.createElement('span'); s.textContent = message; el.appendChild(s);
  wrap.appendChild(el);
  setTimeout(function () { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, kind === 'error' ? 4200 : 2600);
}

function openModal(innerHtml, opts) {
  opts = opts || {};
  document.getElementById('modalRoot').innerHTML = `
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4" id="modalOverlay">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" id="modalBackdrop"></div>
      <div class="relative bg-white rounded-2xl shadow-2xl w-full ${opts.width || 'max-w-2xl'} max-h-[92vh] overflow-hidden animate-modal">${innerHtml}</div>
    </div>`;
  document.getElementById('modalBackdrop').addEventListener('click', closeModal);
  document.body.style.overflow = 'hidden';
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; document.body.style.overflow = ''; }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('modalOverlay')) closeModal(); });

function modalHeader(title, subtitle) {
  return `
    <div class="flex items-start justify-between px-6 py-5 border-b border-gray-100 sticky top-0 bg-white z-10">
      <div><h3 class="text-lg font-bold text-gray-900">${title}</h3>${subtitle ? '<p class="text-xs text-gray-500 mt-0.5">' + subtitle + '</p>' : ''}</div>
      <button onclick="closeModal()" class="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition">${iconX()}</button>
    </div>`;
}
function modalFooter(saveLabel, onSaveAttr, extraBtns) {
  return `
    <div class="flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl sticky bottom-0">
      <div>${extraBtns || ''}</div>
      <div class="flex gap-2">
        <button onclick="closeModal()" class="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-white transition">Cancel</button>
        <button ${onSaveAttr} class="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-dark transition shadow-sm flex items-center gap-1.5">${iconSave()} ${saveLabel}</button>
      </div>
    </div>`;
}
function fld(label, inputHtml, hint) {
  return `<div class="mb-3"><label class="form-label">${label}</label>${inputHtml}${hint ? '<div class="form-hint">' + hint + '</div>' : ''}</div>`;
}
function modalForm(title, sub, body, saveLabel, saveFn, width) {
  openModal(modalHeader(title, sub) + '<div class="px-6 py-4 modal-scroll">' + body + '</div>' + modalFooter(saveLabel, 'onclick="' + saveFn + '"'), { width: width || 'max-w-lg' });
}

function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function badge(text, color) {
  var map = { green: 'badge-green', amber: 'badge-amber', red: 'badge-red', gray: 'badge-gray', blue: 'badge-blue' };
  var dot = { green: 'badge-dot-green', amber: 'badge-dot-amber', red: 'badge-dot-red', gray: 'badge-dot-gray', blue: 'badge-dot-blue' };
  return '<span class="badge ' + map[color] + '"><span class="badge-dot ' + dot[color] + '"></span>' + esc(text) + '</span>';
}
function panelWrap(titleHtml, bodyHtml) {
  return `<div class="panel-card"><div class="panel-card-head"><div class="panel-card-title">${titleHtml}</div></div><div>${bodyHtml}</div></div>`;
}
function tableHtml(cols, rowsHtml) {
  var h = cols.map(function (c) { return '<th class="text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 px-4 py-3 whitespace-nowrap">' + c + '</th>'; }).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-[13px]"><thead><tr class="bg-gray-50 border-b border-gray-200">${h}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}
function emptyRow(colspan, label, addFnLabel, addFn) {
  return `<tr><td colspan="${colspan}" class="text-center py-10 text-gray-400 text-sm">
      <div class="flex justify-center mb-2 empty-icon-svg">${iconTruck()}</div>
      ${label} Try adjusting your filters or <button onclick="${addFn}" class="text-primary font-semibold hover:underline">${addFnLabel}</button>.</td></tr>`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function tomorrowIso() { var d = new Date(); d.setDate(d.getDate() + 1); return keyOf(d); }

function paginateInfo(totalItems, state) { return { totalPages: Math.max(1, Math.ceil(totalItems / state.pageSize)) }; }
function paginationBarHtml(module, totalItems, state) {
  var totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  var start = totalItems === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  var end = Math.min(totalItems, state.page * state.pageSize);
  return `
    <div class="pagination-bar">
      <div class="pagination-info">Showing ${start}–${end} of ${totalItems}</div>
      <div class="pagination-controls">
        <select class="pagination-size-select" onchange="changePMPageSize('${module}', this.value)">
          ${[5, 10, 25, 50].map(function (n) { return '<option value="' + n + '" ' + (state.pageSize === n ? 'selected' : '') + '>' + n + '</option>'; }).join('')}
        </select>
        <button type="button" class="pagination-btn" onclick="goToPMPage('${module}', ${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''} title="Previous page">${iconChevronLeft()}</button>
        <span class="pagination-page-label">Page ${state.page} of ${totalPages}</span>
        <button type="button" class="pagination-btn" onclick="goToPMPage('${module}', ${state.page + 1})" ${state.page >= totalPages ? 'disabled' : ''} title="Next page">${iconChevronRight()}</button>
      </div>
    </div>`;
}

function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function $v(id) { return (document.getElementById(id) || {}).value || ''; }
function optionsHtml(list, sel, blank) { return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function (o) { return '<option ' + (o === sel ? 'selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }
function fa(n) { return '<i class="fa-solid fa-' + n + ' text-[12px]"></i>'; }
function actBtn(fn, icon, title, cls) { return '<button onclick="' + fn + '" class="btn-icon-action' + (cls ? ' ' + cls : '') + '" title="' + title + '">' + fa(icon) + '</button>'; }
function journeyBtn(no) { return '<button onclick="openJourney(\'' + esc(no) + '\')" class="px-4 py-2 rounded-lg text-sm font-semibold text-primary border border-primary/40 hover:bg-primary-soft transition">View Journey</button>'; }
function setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
function setHtml(id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; }
function busy(id, on) { var e = document.getElementById(id); if (e) e.style.opacity = on ? '.55' : ''; }
function panelError(panelId, mod, e) {
  setHtml(panelId, '<div class="panel-card"><div class="text-center py-10 text-sm text-red-600">' + esc(e.message) +
    '<div class="mt-3"><button class="inline-filter-reset" onclick="renderPMModule(\'' + mod + '\', true)"><i class="fa-solid fa-rotate-right text-[11px]"></i> Retry</button></div></div></div>');
}

// =============================================================
// MASTERS (dropdown lists) + STAFF (from backend)
// =============================================================
var leadSources = ['Website', 'Referral', 'Exhibition', 'Cold Call', 'Social Media', 'Other'];
var serviceList = ['ETP', 'STP', 'WTP', 'Environmental Audit', 'Consultancy', 'Other'];
var lostReasons = ['Price too high', 'Chose competitor', 'No response', 'Project cancelled', 'Other'];
var meetingTypes = ['In-office', 'Online', 'Phone call', 'Client visit'];
var OPEN_STAGES = ['Qualification', 'Site Visit', 'Proposal', 'Negotiation'];
var STAGE_PROB = { 'Qualification': 10, 'Site Visit': 30, 'Proposal': 50, 'Negotiation': 75, 'Closed Won': 100, 'Closed Lost': 0 };

var staff = [];
function staffName(s) { return ((s.staffFirstName || '') + ' ' + (s.staffLastName || '')).trim(); }
function staffOptions(sel, blank) {
  return '<option value="">' + blank + '</option>' + staff.map(function (s) {
    return '<option value="' + s.staffPrimeId + '" ' + (String(s.staffPrimeId) === String(sel) ? 'selected' : '') + '>' + esc(staffName(s) + (s.staffRole ? ' (' + s.staffRole + ')' : '')) + '</option>';
  }).join('');
}
async function loadStaff() {
  try { staff = (await api('GET', STAFF_API)) || []; } catch (e) { staff = []; showToast('Could not load staff list', 'warning'); }
}

// =============================================================
// DATA ADAPTERS (backend DTO -> UI object)
// =============================================================
var leadIndex = {}, dealIndex = {};
function adaptLead(r) {
  var status = r.pipelineStatus || 'registered';
  var open = status === 'registered' || status === 'contacted';
  var l = {
    id: r.leadPrimeId, number: r.leadStrId,
    name: ((r.firstName || '') + ' ' + (r.lastName || '')).trim(),
    company: r.company || '', designation: r.designation || '', city: r.city || '',
    mobile: r.phone || '', email: r.email || '', source: r.source || '',
    categories: r.requirementCategory || [], service: (r.requirementCategory || [])[0] || '',
    status: status, temp: r.status || '', priority: r.priority || '',
    assignedTo: r.assignedStaffName ? r.assignedStaffName.trim() : '', assignedStaffId: r.assignedStaffId || '',
    notes: r.notes || '', lostReason: r.lostReason || '', createdAt: (r.createdAt || '').slice(0, 10),
    followupStatus: r.followupStatus || '', rawFollow: r.followUpDate || '',
    nextFollowup: open && r.followupStatus !== 'done' && r.followUpDate ? r.followUpDate : '',
    tags: r.tags || '', referralDetails: r.referralDetails || ''
  };
  leadIndex[l.id] = l;
  return l;
}
function adaptDeal(d) {
  var o = {
    id: d.dealPrimeId, number: d.dealNumber, leadNo: d.leadNo, leadId: d.leadPrimeId, title: d.title, company: d.company || '',
    contact: d.contact || '', amount: d.amount || 0, stage: d.stage, prob: d.probability, expectedClose: d.expectedClose || '',
    closedAt: d.closedAt || '', notes: d.notes || '', lostReason: d.lostReason || ''
  };
  dealIndex[o.id] = o;
  return o;
}
function findLead(id) { return leadIndex[id]; }
function findDeal(id) { return dealIndex[id]; }

// =============================================================
// LOADING / TAB SWITCHING
// =============================================================
var pmPageState = { lr: { page: 1, pageSize: 10 }, cl: { page: 1, pageSize: 10 }, dl: { page: 1, pageSize: 10 }, cw: { page: 1, pageSize: 10 }, al: { page: 1, pageSize: 10 } };
var currentMod = 'db', seq = {}, timers = {};
function nextSeq(m) { seq[m] = (seq[m] || 0) + 1; return seq[m]; }
var LOADERS = {
  db: function () { return loadDB(); }, lr: function () { return loadLeads('lr'); }, cl: function () { return loadLeads('cl'); },
  dl: function () { return loadDeals('dl'); }, cw: function () { return loadDeals('cw'); }, al: function () { return loadAL(); }
};
function schedule(mod, delay) { clearTimeout(timers[mod]); timers[mod] = setTimeout(function () { LOADERS[mod](); }, delay); }
function renderPMModule(m, keep) { if (m === 'db') schedule('db', 0); else { if (!keep) pmPageState[m].page = 1; schedule(m, keep ? 0 : 250); } }
function goToPMPage(m, p) { pmPageState[m].page = p; schedule(m, 0); }
function changePMPageSize(m, s) { pmPageState[m].pageSize = Number(s); pmPageState[m].page = 1; schedule(m, 0); }
function refreshAll() { renderPMModule(currentMod, true); }
function renderLR(keep) { renderPMModule('lr', keep); }
function renderCL(keep) { renderPMModule('cl', keep); }
function renderDL(keep) { renderPMModule('dl', keep); }
function renderCW(keep) { renderPMModule('cw', keep); }
function renderAL(keep) { renderPMModule('al', keep); }
function renderDB() { renderPMModule('db', true); }

var CRM_TABS = { 'dashboard': 'db', 'lead-registration': 'lr', 'contacted-leads': 'cl', 'deals': 'dl', 'closed-won': 'cw', 'activities-log': 'al' };
function crmTabName(mod) { return Object.keys(CRM_TABS).find(function (k) { return CRM_TABS[k] === mod; }); }
function syncCrmSidebar(mod) {
  var name = crmTabName(mod);
  document.querySelectorAll('.sidebar-nav-link[data-page^="crm-"]').forEach(function (a) {
    var on = a.dataset.page === 'crm-' + name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  try { history.replaceState(null, '', '?tab=' + name); } catch (e) {}
}
function switchModuleTab(mod) {
  currentMod = mod;
  syncCrmSidebar(mod);
  document.querySelectorAll('.module-tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.module === mod); });
  document.querySelectorAll('.module-tab-panel').forEach(function (p) { p.classList.toggle('hidden', p.dataset.module !== mod); });
  renderPMModule(mod, true);
}
function openJourney(no) { closeModal(); document.getElementById('search-al').value = no; document.getElementById('filterType-al').value = 'all'; document.getElementById('filterAction-al').value = 'all'; pmPageState.al.page = 1; switchModuleTab('al'); }

// =============================================================
// LEADS (Lead Registration + Contacted Leads)
// =============================================================
function leadStatusBadge(s) { var m = { registered: ['Registered', 'blue'], contacted: ['Contacted', 'amber'], converted: ['Converted', 'green'], lost: ['Lost', 'red'] }[s] || ['—', 'gray']; return badge(m[0], m[1]); }
function isOverdue(l) { return l.status === 'contacted' && l.nextFollowup && l.nextFollowup < todayIso(); }

async function loadLeads(mod) {
  var my = nextSeq(mod), st = pmPageState[mod], panel = mod + 'Panel';
  busy(panel, true);
  try {
    var params = { stage: mod === 'cl' ? 'contacted' : $v('filterStatus-lr'), source: $v('filterSource-' + mod), q: $v('search-' + mod).trim(), page: st.page - 1, size: st.pageSize };
    var r = await Promise.all([api('GET', CRM_API + '/leads?' + qs(params)), api('GET', CRM_API + '/leads/counts')]);
    if (my !== seq[mod]) return;
    var data = r[0], c = r[1];
    if (!data.items.length && data.totalItems > 0 && st.page > 1) { st.page = data.totalPages; return loadLeads(mod); }
    var items = data.items.map(adaptLead);
    if (mod === 'lr') {
      drawLeadsPanel('lr', 'lrPanel', 'Leads', items, data.totalItems, leadActsLR, 'No leads found.', 'register a new lead', 'openAddLead()');
      setText('totalLR', c.total); setText('regLR', c.registered); setText('contLR', c.contacted); setText('convLR', c.converted);
    } else {
      drawLeadsPanel('cl', 'clPanel', 'Contacted Leads', items, data.totalItems, leadActsCL, 'No contacted leads yet.', 'register a lead', "switchModuleTab('lr')");
      setText('totalCL', c.contacted); setText('overdueCL', c.overdue); setText('convCL', c.converted); setText('lostCL', c.lost);
    }
  } catch (e) { if (my === seq[mod]) panelError(panel, mod, e); }
  finally { if (my === seq[mod]) busy(panel, false); }
}

function drawLeadsPanel(mod, panel, title, items, total, actFn, empty, emptyLabel, emptyFn) {
  var rows = items.length ? items.map(function (l) {
    var od = isOverdue(l);
    return `
      <tr class="border-b border-gray-100 table-row-hover">
        <td class="px-4 py-3 font-mono text-[12.5px] font-semibold text-gray-700">${esc(l.number)}</td>
        <td class="px-4 py-3"><div class="font-semibold text-gray-800">${esc(l.name)} ${tempPill(l.temp)}</div><div class="text-[11px] text-gray-400">${esc(l.company)}</div></td>
        <td class="px-4 py-3 text-gray-600">${esc(l.mobile)}<div class="text-[11px] text-gray-400">${esc(l.email)}</div></td>
        <td class="px-4 py-3 text-gray-600">${esc(l.source) || '—'}<div class="text-[11px] text-gray-400">${esc(l.service)}</div></td>
        <td class="px-4 py-3">${leadStatusBadge(l.status)}</td>
        <td class="px-4 py-3 ${od ? 'text-red-600 font-semibold' : 'text-gray-600'}">${fmtDate(l.nextFollowup)}${od ? '<div class="text-[11px]">Overdue</div>' : ''}</td>
        <td class="px-4 py-3">${actFn(l)}</td>
      </tr>`;
  }).join('') : emptyRow(7, empty, emptyLabel, emptyFn);
  setHtml(panel, panelWrap(title + ' <span class="panel-count-chip">' + total + '</span>',
    tableHtml(['Lead No', 'Lead', 'Contact', 'Source / Service', 'Status', 'Follow-up', 'Actions'], rows) + paginationBarHtml(mod, total, pmPageState[mod])));
}

function leadActsLR(l) {
  var a = actBtn("viewLead(" + l.id + ")", 'eye', 'View') + actBtn("editLead(" + l.id + ")", 'pen', 'Edit');
  if (l.status === 'registered') a += actBtn("openContacted(" + l.id + ")", 'phone', 'Mark as contacted') + actBtn("delLead(" + l.id + ")", 'trash', 'Delete', 'danger');
  return '<div class="flex gap-1">' + a + '</div>';
}
function leadActsCL(l) {
  return '<div class="flex gap-1">' + actBtn("viewLead(" + l.id + ")", 'eye', 'View') + actBtn("openFollowup(" + l.id + ")", 'calendar-check', 'Log follow-up') +
    actBtn("openConvert(" + l.id + ")", 'handshake', 'Convert to deal') + actBtn("openLost('lead'," + l.id + ")", 'ban', 'Mark lost', 'danger') + '</div>';
}
function filterLR() { renderLR(); }
function clearFiltersLR() { ['filterStatus-lr', 'filterSource-lr'].forEach(function (i) { document.getElementById(i).value = 'all'; }); document.getElementById('search-lr').value = ''; renderLR(); }
function filterCL() { renderCL(); }
function clearFiltersCL() { document.getElementById('filterSource-cl').value = 'all'; document.getElementById('search-cl').value = ''; renderCL(); }

// ---------- add / edit lead ----------
function tempOptions(sel) { return ['hot', 'warm', 'cold'].map(function (v) { return '<option value="' + v + '" ' + (v === sel ? 'selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>'; }).join(''); }
function openAddLead() { openLeadModal(null); }
function editLead(id) { var l = findLead(id); if (l) openLeadModal(l); }
function openLeadModal(existing) {
  var isEdit = !!existing;
  var e = existing || { id: '', name: '', company: '', designation: '', mobile: '', email: '', city: '', source: '', service: '', notes: '', temp: 'warm', priority: 'P2', assignedStaffId: '', nextFollowup: tomorrowIso(), number: '' };
  modalForm(isEdit ? 'Edit Lead' : 'Register New Lead', isEdit ? esc(e.number) : 'Add a new lead record',
    '<div class="grid grid-cols-2 gap-3">' +
    fld('Contact Person <span class="required">*</span>', '<input id="ld_name" value="' + esc(e.name) + '" placeholder="e.g. Rajesh Kulkarni" class="form-input">') +
    fld('Company / Organisation', '<input id="ld_company" value="' + esc(e.company) + '" class="form-input">') +
    fld('Designation', '<input id="ld_desig" value="' + esc(e.designation) + '" class="form-input">') +
    fld('Mobile <span class="required">*</span>', '<input id="ld_mobile" value="' + esc(e.mobile) + '" placeholder="10-digit mobile" maxlength="10" inputmode="numeric" class="form-input" oninput="this.value=this.value.replace(/\\D/g,\'\')" onblur="checkPhoneDup(' + (e.id || 0) + ')">', '<span id="ld_phone_hint"></span>') +
    fld('Email', '<input id="ld_email" type="email" value="' + esc(e.email) + '" class="form-input">') +
    fld('City', '<input id="ld_city" value="' + esc(e.city) + '" class="form-input">') +
    fld('Lead Source', '<select id="ld_source" class="form-input">' + optionsHtml(leadSources, e.source, 'Select source') + '</select>') +
    fld('Service Interested In', '<select id="ld_service" class="form-input">' + optionsHtml(serviceList, e.service, 'Select service') + '</select>') +
    fld('Temperature', '<select id="ld_temp" class="form-input">' + tempOptions(e.temp) + '</select>') +
    fld('Priority', '<select id="ld_prio" class="form-input">' + optionsHtml(['P1', 'P2', 'P3'], e.priority) + '</select>') +
    fld('Assign to', '<select id="ld_staff" class="form-input">' + staffOptions(e.assignedStaffId, 'Unassigned') + '</select>') +
    fld('Follow-up date', '<input id="ld_follow" type="date" value="' + esc(e.nextFollowup || '') + '" class="form-input">') +
    '</div>' + fld('Notes', '<textarea id="ld_notes" rows="2" class="form-input">' + esc(e.notes) + '</textarea>'),
    isEdit ? 'Update Lead' : 'Register Lead', "saveLead(" + (isEdit ? e.id : 0) + ")", 'max-w-2xl');
}
async function checkPhoneDup(selfId) {
  var p = $v('ld_mobile').trim(), hint = document.getElementById('ld_phone_hint');
  if (!hint) return;
  hint.textContent = '';
  if (!/^[6-9]\d{9}$/.test(p)) return;
  try {
    var ex = await api('GET', LEAD_API + '/check-phone?phone=' + encodeURIComponent(p));
    if (ex && ex.leadPrimeId !== selfId) { hint.style.color = '#dc2626'; hint.textContent = 'Already exists — ' + ((ex.firstName || '') + ' ' + (ex.lastName || '')).trim() + ' (' + ex.leadStrId + ')'; }
  } catch (e) { /* the server re-checks on save */ }
}
function saveLead(id) {
  return run(async function () {
    var name = $v('ld_name').trim(), mobile = $v('ld_mobile').trim();
    if (!name) return bad('Contact person name is required');
    if (!/^[6-9]\d{9}$/.test(mobile)) return bad('Enter a valid 10-digit mobile number');
    var email = $v('ld_email').trim();
    if (email && !/\S+@\S+\.\S+/.test(email)) return bad('Enter a valid email address');
    var old = id ? findLead(id) : null, parts = name.split(/\s+/), first = parts.shift(), service = $v('ld_service'), follow = $v('ld_follow');
    // keep extra categories on edit if the service dropdown was left unchanged
    var cats = old && old.categories.length && service === old.service ? old.categories : (service ? [service] : []);
    var payload = {
      firstName: first, lastName: parts.join(' '), email: email, phone: mobile, company: $v('ld_company').trim(),
      designation: $v('ld_desig').trim(), city: $v('ld_city').trim(), status: $v('ld_temp'), priority: $v('ld_prio'),
      source: $v('ld_source'), referralDetails: old ? old.referralDetails : '', requirementCategory: cats, tags: old ? old.tags : '',
      followUpDate: follow || null,
      followupStatus: follow ? (old && old.followupStatus && follow === old.rawFollow ? old.followupStatus : 'pending') : null,
      notes: $v('ld_notes').trim(), assignedStaffId: $v('ld_staff') ? Number($v('ld_staff')) : null
    };
    var fd = new FormData();
    fd.append('lead', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    await api(id ? 'PATCH' : 'POST', id ? LEAD_API + '/' + id : LEAD_API, undefined, fd);
    closeModal(); showToast(id ? 'Lead updated' : 'Lead registered', 'success'); refreshAll();
  });
}

// ---------- delete ----------
function delLead(id) {
  var l = findLead(id); if (!l) return;
  openModal(modalHeader('Delete Lead', esc(l.number)) +
    '<div class="px-6 py-4 text-sm text-gray-600">Delete <b class="text-gray-800">' + esc(l.name) + '</b> (' + esc(l.company) + ')? Its activity history will also be removed.</div>' +
    modalFooter('Delete', 'onclick="confirmDelLead(' + id + ')"'), { width: 'max-w-md' });
}
function confirmDelLead(id) {
  return run(async function () { await api('DELETE', LEAD_API + '/delete-lead/' + id); closeModal(); showToast('Lead deleted', 'warning'); refreshAll(); });
}

// ---------- view ----------
function viewLead(id) {
  var l = findLead(id); if (!l) return;
  openModal(`
    ${modalHeader('Lead — ' + esc(l.number), esc(l.name) + ' · ' + esc(l.company))}
    <div class="px-6 py-4 modal-scroll"><div class="grid grid-cols-2 gap-3 text-sm">
      <div><span class="text-gray-500">Status</span><br>${leadStatusBadge(l.status)}</div>
      <div><span class="text-gray-500">Registered On</span><br>${fmtDate(l.createdAt)}</div>
      <div><span class="text-gray-500">Designation</span><br>${esc(l.designation) || '—'}</div>
      <div><span class="text-gray-500">City</span><br>${esc(l.city) || '—'}</div>
      <div><span class="text-gray-500">Mobile</span><br>${esc(l.mobile)}</div>
      <div><span class="text-gray-500">Email</span><br>${esc(l.email) || '—'}</div>
      <div><span class="text-gray-500">Source</span><br>${esc(l.source) || '—'}</div>
      <div><span class="text-gray-500">Service</span><br>${esc(l.categories.join(', ')) || '—'}</div>
      <div><span class="text-gray-500">Next Follow-up</span><br>${fmtDate(l.nextFollowup)}</div>
      <div><span class="text-gray-500">Temperature</span><br>${tempPill(l.temp) || '—'}</div>
      <div><span class="text-gray-500">Priority</span><br>${prioPill(l.priority)}</div>
      <div><span class="text-gray-500">Assigned to</span><br>${esc(l.assignedTo) || 'Unassigned'}</div>
      ${l.lostReason ? '<div class="col-span-2"><span class="text-gray-500">Lost Reason</span><br>' + esc(l.lostReason) + '</div>' : ''}
      <div class="col-span-2"><span class="text-gray-500">Notes</span><br>${esc(l.notes) || '—'}</div>
      <div class="col-span-2"><span class="text-gray-500">Follow-up history</span><div id="vl_hist" class="mt-1 text-[12.5px] text-gray-500">Loading…</div></div>
    </div></div>
    ${modalFooter('Close', 'onclick="closeModal()"', journeyBtn(l.number))}
  `, { width: 'max-w-xl' });
  api('GET', LEAD_API + '/history/' + id + '/followup').then(function (h) {
    var el = document.getElementById('vl_hist'); if (!el) return;
    el.innerHTML = h && h.length ? h.map(function (f) {
      return '<div class="border-b border-gray-100 py-1.5"><b class="text-gray-700">' + fmtDate(f.followupDate) + '</b> · ' + esc(f.followupStatus || '') +
        (f.meetingType ? ' · ' + esc(f.meetingType) : '') + (f.takenByStaffName && f.takenByStaffName.trim() ? ' · ' + esc(f.takenByStaffName.trim()) : '') +
        (f.followupNotes ? '<div>' + esc(f.followupNotes) + '</div>' : '') + '</div>';
    }).join('') : 'No follow-ups logged yet.';
  }).catch(function () { var el = document.getElementById('vl_hist'); if (el) el.textContent = 'Could not load history.'; });
}

// ---------- mark contacted ----------
function openContacted(id) {
  var l = findLead(id); if (!l) return;
  modalForm('Mark as Contacted', esc(l.number) + ' · ' + esc(l.name),
    fld('How was the lead contacted? <span class="required">*</span>', '<textarea id="ct_note" rows="2" class="form-input" placeholder="e.g. Phone call, discussed ETP requirement"></textarea>') +
    fld('Next Follow-up Date', '<input id="ct_next" type="date" min="' + todayIso() + '" class="form-input">'), 'Save', "saveContacted(" + id + ")");
}
function saveContacted(id) {
  return run(async function () {
    var note = $v('ct_note').trim();
    if (!note) return bad('Please add how the lead was contacted');
    await api('PATCH', CRM_API + '/leads/' + id + '/contacted', { note: note, nextFollowup: $v('ct_next') || null });
    closeModal(); showToast('Lead moved to Contacted Leads', 'success'); refreshAll();
  });
}

// ---------- follow-ups ----------
function fuCommon() {
  return fld('Taken by <span class="required">*</span>', '<select id="fu_by" class="form-input">' + staffOptions('', 'Select staff') + '</select>') +
    fld('Meeting type <span class="required">*</span>', '<select id="fu_mt" class="form-input">' + optionsHtml(meetingTypes, '', 'Select type') + '</select>');
}
function fuValid() { if (!$v('fu_by') || !$v('fu_mt')) { bad('Select who took the follow-up and the meeting type'); return false; } return true; }
function fuBody(status, date, note) { return { followupDate: date, followupStatus: status, followupNotes: note, meetingType: $v('fu_mt'), takenByStaffId: Number($v('fu_by')) }; }
function postFollowup(id, body) { return api('POST', LEAD_API + '/add/' + id + '/followup', body); }

// Contacted Leads -> "Log follow-up": done today + optional next date
function openFollowup(id) {
  var l = findLead(id); if (!l) return;
  modalForm('Log Follow-up', esc(l.number) + ' · ' + esc(l.name),
    fld('Follow-up details <span class="required">*</span>', '<textarea id="fu_note" rows="2" class="form-input" placeholder="What happened on this call or meeting?"></textarea>') + fuCommon() +
    fld('Next follow-up date', '<input id="fu_next" type="date" min="' + todayIso() + '" class="form-input">'), 'Save', "saveFollowup(" + id + ")");
}
function saveFollowup(id) {
  return run(async function () {
    var note = $v('fu_note').trim(), next = $v('fu_next');
    if (!note) return bad('Please enter the follow-up details');
    if (!fuValid()) return;
    await postFollowup(id, fuBody('done', todayIso(), note));
    if (next) await postFollowup(id, fuBody('pending', next, ''));
    closeModal(); showToast('Follow-up logged', 'success'); refreshAll();
  });
}
// Dashboard overlay -> "Mark done"
function openFuDone(id) {
  var l = findLead(id); if (!l) return;
  modalForm('Mark follow-up as done', esc(l.number) + ' · ' + esc(l.name), fld('Follow-up note <span class="required">*</span>', '<textarea id="fu_note" rows="3" class="form-input" placeholder="What happened on this call or meeting?"></textarea>') + fuCommon(), 'Submit', "saveFuDone(" + id + ")");
}
function saveFuDone(id) {
  return run(async function () {
    var note = $v('fu_note').trim();
    if (!note) return bad('Please add a follow-up note');
    if (!fuValid()) return;
    await postFollowup(id, fuBody('done', todayIso(), note));
    closeModal(); showToast('Follow-up marked as done', 'success'); refreshAll();
  });
}
// Dashboard overlay -> "Next follow-up"
function openFuNext(id) {
  var l = findLead(id); if (!l) return;
  modalForm('Schedule next follow-up', esc(l.number) + ' · ' + esc(l.name), fld('Next follow-up date <span class="required">*</span>', '<input id="fu_date" type="date" min="' + todayIso() + '" class="form-input">') + fuCommon(), 'Submit', "saveFuNext(" + id + ")");
}
function saveFuNext(id) {
  return run(async function () {
    var d = $v('fu_date');
    if (!d) return bad('Pick the next follow-up date');
    if (d < todayIso()) return bad('Pick today or a future date');
    if (!fuValid()) return;
    await postFollowup(id, fuBody('pending', d, ''));
    closeModal(); showToast('Next follow-up scheduled', 'success'); refreshAll();
  });
}

// ---------- convert / lost ----------
function openConvert(id) {
  var l = findLead(id); if (!l) return;
  modalForm('Convert to Deal', esc(l.number) + ' · ' + esc(l.name),
    fld('Deal Title <span class="required">*</span>', '<input id="cv_title" value="' + esc((l.service || 'Project') + ' – ' + (l.company || l.name)) + '" class="form-input">') +
    '<div class="grid grid-cols-2 gap-3">' + fld('Expected Amount (₹)', '<input id="cv_amt" type="number" min="0" value="0" class="form-input">') + fld('Expected Close Date', '<input id="cv_close" type="date" class="form-input">') + '</div>' +
    fld('Initial Stage', '<select id="cv_stage" class="form-input">' + optionsHtml(OPEN_STAGES) + '</select>'), 'Create Deal', "saveConvert(" + id + ")");
}
function saveConvert(id) {
  return run(async function () {
    var t = $v('cv_title').trim();
    if (!t) return bad('Deal title is required');
    var d = await api('POST', CRM_API + '/deals/convert/' + id, { title: t, amount: Number($v('cv_amt')) || 0, expectedClose: $v('cv_close') || null, stage: $v('cv_stage') });
    closeModal(); showToast('Lead converted to deal ' + d.dealNumber, 'success'); refreshAll();
  });
}
function openLost(kind, id) {
  var o = kind === 'lead' ? findLead(id) : findDeal(id); if (!o) return;
  modalForm(kind === 'lead' ? 'Mark Lead as Lost' : 'Mark Deal as Lost', esc(o.number) + ' · ' + esc(o.title || o.name),
    fld('Reason <span class="required">*</span>', '<select id="ls_reason" class="form-input">' + optionsHtml(lostReasons, '', 'Select reason') + '</select>') +
    fld('Remarks', '<textarea id="ls_note" rows="2" class="form-input"></textarea>'), 'Mark Lost', "saveLost('" + kind + "'," + id + ")");
}
function saveLost(kind, id) {
  return run(async function () {
    var reason = $v('ls_reason'), note = $v('ls_note').trim();
    if (!reason) return bad('Please select a reason');
    if (kind === 'lead') await api('PATCH', LEAD_API + '/' + id + '/outcome', { leadOutcome: 'lost', lostReason: reason + (note ? ' — ' + note : '') });
    else await api('PATCH', CRM_API + '/deals/' + id + '/lost', { reason: reason, remarks: note });
    closeModal(); showToast('Marked as lost', 'warning'); refreshAll();
  });
}

// =============================================================
// DEALS (open pipeline) + CLOSED WON
// =============================================================
function stageBadge(n) { return badge(n, n === 'Closed Won' ? 'green' : n === 'Closed Lost' ? 'red' : 'blue'); }
async function loadDeals(mod) {
  var my = nextSeq(mod), st = pmPageState[mod], won = mod === 'cw', panel = mod + 'Panel';
  busy(panel, true);
  try {
    var params = { view: won ? 'won' : 'open', stage: won ? '' : $v('filterStage-dl'), q: $v('search-' + mod).trim(), page: st.page - 1, size: st.pageSize };
    var r = await Promise.all([api('GET', CRM_API + '/deals?' + qs(params)), api('GET', CRM_API + '/deals/stats')]);
    if (my !== seq[mod]) return;
    var d = r[0], s = r[1];
    if (!d.items.length && d.totalItems > 0 && st.page > 1) { st.page = d.totalPages; return loadDeals(mod); }
    var items = d.items.map(adaptDeal);
    if (won) drawCW(items, d.totalItems, s); else drawDL(items, d.totalItems, s);
  } catch (e) { if (my === seq[mod]) panelError(panel, mod, e); }
  finally { if (my === seq[mod]) busy(panel, false); }
}
function drawDL(items, total, s) {
  var rows = items.length ? items.map(function (d) {
    return `
      <tr class="border-b border-gray-100 table-row-hover">
        <td class="px-4 py-3 font-mono text-[12.5px] font-semibold text-gray-700">${esc(d.number)}<div class="text-[11px] text-gray-400 font-normal">${esc(d.leadNo)}</div></td>
        <td class="px-4 py-3"><div class="font-semibold text-gray-800">${esc(d.title)}</div><div class="text-[11px] text-gray-400">${esc(d.company)}</div></td>
        <td class="px-4 py-3 font-mono font-semibold text-gray-800">${money(d.amount)}</td>
        <td class="px-4 py-3"><select class="inline-filter-select" onchange="changeStage(${d.id}, this.value)">${optionsHtml(OPEN_STAGES, d.stage)}</select></td>
        <td class="px-4 py-3 text-gray-600">${d.prob}%</td>
        <td class="px-4 py-3 text-gray-600">${fmtDate(d.expectedClose)}</td>
        <td class="px-4 py-3"><div class="flex gap-1">${actBtn("viewDeal(" + d.id + ")", 'eye', 'View')}${actBtn("openEditDeal(" + d.id + ")", 'pen', 'Edit')}${actBtn("openWon(" + d.id + ")", 'trophy', 'Mark closed won')}${actBtn("openLost('deal'," + d.id + ")", 'ban', 'Mark lost', 'danger')}</div></td>
      </tr>`;
  }).join('') : emptyRow(7, 'No open deals.', 'convert a contacted lead', "switchModuleTab('cl')");
  setHtml('dlPanel', panelWrap('Open Deals <span class="panel-count-chip">' + total + '</span>',
    tableHtml(['Deal No', 'Deal', 'Amount', 'Stage', 'Win %', 'Expected Close', 'Actions'], rows) + paginationBarHtml('dl', total, pmPageState.dl)));
  setText('openDL', s.open); setText('valDL', money(s.pipelineValue)); setText('wonDL', s.won); setText('lostDL', s.lost);
}
function drawCW(items, total, s) {
  var rows = items.length ? items.map(function (d) {
    return `
      <tr class="border-b border-gray-100 table-row-hover">
        <td class="px-4 py-3 font-mono text-[12.5px] font-semibold text-gray-700">${esc(d.number)}</td>
        <td class="px-4 py-3"><div class="font-semibold text-gray-800">${esc(d.title)}</div><div class="text-[11px] text-gray-400">${esc(d.company)} · ${esc(d.contact)}</div></td>
        <td class="px-4 py-3 font-mono font-semibold text-gray-800">${money(d.amount)}</td>
        <td class="px-4 py-3 text-gray-600">${fmtDate(d.closedAt)}</td>
        <td class="px-4 py-3 font-mono text-[12px] text-gray-500">${esc(d.leadNo)}</td>
        <td class="px-4 py-3"><div class="flex gap-1">${actBtn("viewDeal(" + d.id + ")", 'eye', 'View')}${actBtn("openJourney('" + esc(d.leadNo) + "')", 'timeline', 'View journey')}</div></td>
      </tr>`;
  }).join('') : emptyRow(6, 'No closed deals yet.', 'open the deals pipeline', "switchModuleTab('dl')");
  setHtml('cwPanel', panelWrap('Closed Won Deals <span class="panel-count-chip">' + total + '</span>',
    tableHtml(['Deal No', 'Deal', 'Amount', 'Closed On', 'Lead', 'Actions'], rows) + paginationBarHtml('cw', total, pmPageState.cw)));
  setText('totalCW', s.won); setText('valCW', money(s.wonValue)); setText('avgCW', money(s.avgWon));
}
function filterDL() { renderDL(); }
function clearFiltersDL() { document.getElementById('filterStage-dl').value = 'all'; document.getElementById('search-dl').value = ''; renderDL(); }
function filterCW() { renderCW(); }
function clearFiltersCW() { document.getElementById('search-cw').value = ''; renderCW(); }

async function changeStage(id, st) {
  try { await api('PATCH', CRM_API + '/deals/' + id + '/stage', { stage: st }); showToast('Stage updated', 'success'); }
  catch (e) { showToast(e.message, 'error'); }
  refreshAll();   // also reverts the dropdown if the call failed
}
function openEditDeal(id) {
  var d = findDeal(id); if (!d) return;
  modalForm('Edit Deal', esc(d.number), fld('Deal Title <span class="required">*</span>', '<input id="de_title" value="' + esc(d.title) + '" class="form-input">') +
    '<div class="grid grid-cols-2 gap-3">' + fld('Amount (₹)', '<input id="de_amt" type="number" min="0" value="' + Number(d.amount) + '" class="form-input">') + fld('Expected Close Date', '<input id="de_close" type="date" value="' + esc(d.expectedClose) + '" class="form-input">') + '</div>' +
    fld('Notes', '<textarea id="de_notes" rows="2" class="form-input">' + esc(d.notes) + '</textarea>'), 'Update Deal', "saveDeal(" + id + ")");
}
function saveDeal(id) {
  return run(async function () {
    var t = $v('de_title').trim();
    if (!t) return bad('Deal title is required');
    await api('PATCH', CRM_API + '/deals/' + id, { title: t, amount: Number($v('de_amt')) || 0, expectedClose: $v('de_close') || null, notes: $v('de_notes').trim() });
    closeModal(); showToast('Deal updated', 'success'); refreshAll();
  });
}
function openWon(id) {
  var d = findDeal(id); if (!d) return;
  modalForm('Mark as Closed Won', esc(d.number) + ' · ' + esc(d.title), fld('Final Deal Value (₹) <span class="required">*</span>', '<input id="wn_amt" type="number" min="1" value="' + Number(d.amount) + '" class="form-input">'), 'Close Deal', "saveWon(" + id + ")", 'max-w-md');
}
function saveWon(id) {
  return run(async function () {
    var a = Number($v('wn_amt'));
    if (!a || a < 1) return bad('Enter the final deal value');
    await api('PATCH', CRM_API + '/deals/' + id + '/won', { amount: a });
    closeModal(); showToast('Deal closed won', 'success'); refreshAll();
  });
}
function viewDeal(id) {
  var d = findDeal(id); if (!d) return;
  openModal(`
    ${modalHeader('Deal — ' + esc(d.number), esc(d.title))}
    <div class="px-6 py-4 modal-scroll"><div class="grid grid-cols-2 gap-3 text-sm">
      <div><span class="text-gray-500">Stage</span><br>${stageBadge(d.stage)}</div>
      <div><span class="text-gray-500">Amount</span><br><span class="font-semibold">${money(d.amount)}</span></div>
      <div><span class="text-gray-500">Company</span><br>${esc(d.company)}</div>
      <div><span class="text-gray-500">Contact</span><br>${esc(d.contact)}</div>
      <div><span class="text-gray-500">Lead</span><br><span class="font-mono">${esc(d.leadNo)}</span></div>
      <div><span class="text-gray-500">Win Probability</span><br>${d.prob}%</div>
      <div><span class="text-gray-500">Expected Close</span><br>${fmtDate(d.expectedClose)}</div>
      <div><span class="text-gray-500">Closed On</span><br>${fmtDate(d.closedAt)}</div>
      ${d.lostReason ? '<div class="col-span-2"><span class="text-gray-500">Lost Reason</span><br>' + esc(d.lostReason) + '</div>' : ''}
      <div class="col-span-2"><span class="text-gray-500">Notes</span><br>${esc(d.notes) || '—'}</div>
    </div></div>
    ${modalFooter('Close', 'onclick="closeModal()"', journeyBtn(d.leadNo))}
  `, { width: 'max-w-xl' });
}

// =============================================================
// ACTIVITIES LOG
// =============================================================
var activityColors = { Registered: 'blue', Updated: 'gray', Contacted: 'amber', 'Follow-up': 'amber', Converted: 'green', 'Stage Changed': 'blue', 'Closed Won': 'green', 'Closed Lost': 'red', 'Lead Lost': 'red' };
async function loadAL() {
  var my = nextSeq('al'), st = pmPageState.al;
  busy('alPanel', true);
  try {
    var params = { type: $v('filterType-al'), action: $v('filterAction-al'), q: $v('search-al').trim(), page: st.page - 1, size: st.pageSize };
    var r = await Promise.all([api('GET', CRM_API + '/activities?' + qs(params)), api('GET', CRM_API + '/activities/stats')]);
    if (my !== seq.al) return;
    var d = r[0], s = r[1];
    if (!d.items.length && d.totalItems > 0 && st.page > 1) { st.page = d.totalPages; return loadAL(); }
    var rows = d.items.length ? d.items.map(function (x) {
      return `
        <tr class="border-b border-gray-100 table-row-hover">
          <td class="px-4 py-3 text-gray-700">${fmtDate(x.at)}<div class="text-[11px] text-gray-400">${new Date(x.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div></td>
          <td class="px-4 py-3"><div class="font-mono text-[12.5px] font-semibold text-gray-700">${esc(x.leadNo)}</div><div class="text-[11px] text-gray-400">${esc(x.company)}</div></td>
          <td class="px-4 py-3">${badge(x.type, x.type === 'Lead' ? 'blue' : 'gray')} <span class="font-mono text-[11.5px] text-gray-500 ml-1">${esc(x.ref)}</span></td>
          <td class="px-4 py-3">${badge(x.action, activityColors[x.action] || 'gray')}</td>
          <td class="px-4 py-3 text-gray-600">${esc(x.details)}</td>
        </tr>`;
    }).join('') : emptyRow(5, 'No activities found.', 'clear the filters', 'clearFiltersAL()');
    setHtml('alPanel', panelWrap('Activities <span class="panel-count-chip">' + d.totalItems + '</span>',
      tableHtml(['When', 'Lead', 'Record', 'Action', 'Details'], rows) + paginationBarHtml('al', d.totalItems, st)));
    setText('totalAL', s.total); setText('todayAL', s.today); setText('convAL', s.leadsConverted); setText('wonAL', s.dealsWon);
  } catch (e) { if (my === seq.al) panelError('alPanel', 'al', e); }
  finally { if (my === seq.al) busy('alPanel', false); }
}
function filterAL() { renderAL(); }
function clearFiltersAL() { ['filterType-al', 'filterAction-al'].forEach(function (i) { document.getElementById(i).value = 'all'; }); document.getElementById('search-al').value = ''; renderAL(); }

// =============================================================
// DASHBOARD
// =============================================================
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var priorityColor = { P1: '#dc2626', P2: '#d97706', P3: '#0284c7' };
var chartPalette = ['#0f766e', '#14b8a6', '#f59e0b', '#0284c7', '#ef4444', '#8b5cf6'];
var dbYM = { y: new Date().getFullYear(), m: new Date().getMonth() };
var dbData = null;
function pad2(n) { return String(n).padStart(2, '0'); }
function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function tempPill(t) { var m = { hot: ['Hot', 'red'], warm: ['Warm', 'amber'], cold: ['Cold', 'blue'] }[t]; return m ? '<span class="badge badge-' + m[1] + '" style="padding:1px 7px;font-size:10px">' + m[0] + '</span>' : ''; }
function prioPill(p) { return p && priorityColor[p] ? '<span style="font-size:11px;font-weight:700;color:' + priorityColor[p] + '">' + esc(p) + '</span>' : '—'; }
function pendingFollowups() { return dbData ? dbData.pending : []; }
function dbShift(n) { dbYM.m += n; if (dbYM.m < 0) { dbYM.m = 11; dbYM.y--; } if (dbYM.m > 11) { dbYM.m = 0; dbYM.y++; } if (dbData) drawDB(); }
function buildGrid(y, m) {
  var first = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate(), prev = new Date(y, m, 0).getDate(), cells = [], i, t = 1;
  for (i = first - 1; i >= 0; i--) cells.push({ d: new Date(y, m - 1, prev - i), out: true });
  for (i = 1; i <= dim; i++) cells.push({ d: new Date(y, m, i), out: false });
  while (cells.length < 42) cells.push({ d: new Date(y, m + 1, t++), out: true });
  return cells;
}

async function loadDB() {
  var my = nextSeq('db');
  try {
    var r = await Promise.all([api('GET', CRM_API + '/dashboard/summary'), api('GET', CRM_API + '/leads/pending-followups'), api('GET', LEAD_API + '/monthly-count?monthsBack=6')]);
    if (my !== seq.db) return;
    dbData = { summary: r[0], pending: r[1].map(adaptLead), trend: r[2] || [] };
    drawDB();
  } catch (e) {
    if (my !== seq.db) return;
    setHtml('dbStats', '<div class="col-span-5 text-center text-sm text-red-600 py-6" style="grid-column:1/-1">' + esc(e.message) + ' <button class="inline-filter-reset ml-2" onclick="renderDB()">Retry</button></div>');
  }
}

function drawDB() {
  var td = todayIso(), pend = pendingFollowups(), by = {}, s = dbData.summary;
  var cards = [['Total leads', s.totalLeads, 'users', 'bg-primary-soft text-primary'],
    ['Today follow-ups', s.todayFollowups, 'calendar-day', 'bg-red-50 text-red-500'],
    ['Total follow-ups', s.totalFollowups, 'repeat', 'bg-amber-50 text-amber-600'],
    ['Won', s.won, 'circle-check', 'bg-green-50 text-green-600'],
    ['Lost', s.lost, 'circle-xmark', 'bg-gray-100 text-gray-500']];
  setHtml('dbStats', cards.map(function (c) {
    return '<div class="db-stat"><div class="db-stat-ico ' + c[3] + '"><i class="fa-solid fa-' + c[2] + '"></i></div><div><div class="stat-label">' + c[0] + '</div><div class="stat-value">' + c[1] + '</div></div></div>';
  }).join(''));

  var up = pend.slice().sort(function (a, b) { var ta = a.nextFollowup === td, tb = b.nextFollowup === td; if (ta !== tb) return ta ? -1 : 1; return a.nextFollowup < b.nextFollowup ? -1 : 1; }).slice(0, 6);
  setHtml('dbUpcoming', up.length ? up.map(function (l) {
    var t = l.nextFollowup === td;
    return '<div class="db-up' + (t ? ' today' : '') + '" onclick="viewLead(' + l.id + ')">' + (t ? '<span class="db-up-tag">TODAY</span>' : '') +
      '<div class="flex justify-between gap-2"><span class="font-semibold text-[12px] text-gray-800">' + esc(l.name) + '</span><span class="text-[10px] ' + (l.nextFollowup < td ? 'text-red-600 font-semibold' : 'text-gray-400') + '">' + fmtDate(l.nextFollowup) + '</span></div>' +
      '<div class="flex justify-between gap-2 text-[10.5px] text-gray-500"><span class="truncate">' + esc(l.company || l.mobile) + '</span>' + prioPill(l.priority) + '</div>' +
      '<div class="text-[10.5px] text-gray-400 truncate mt-0.5">' + (esc((l.notes || '').slice(0, 52)) || '—') + '</div></div>';
  }).join('') : '<p class="text-[12px] text-gray-400 text-center py-3">No upcoming follow-ups</p>');

  pend.forEach(function (l) { (by[l.nextFollowup] = by[l.nextFollowup] || []).push(l); });
  setHtml('dbMonthBig', '<div class="db-month">' + MONTHS[dbYM.m].toUpperCase() + '</div><div class="db-year">' + dbYM.y + '</div>');
  setHtml('dbNavLabel', MONTHS[dbYM.m] + ' ' + dbYM.y);
  var cells = buildGrid(dbYM.y, dbYM.m).map(function (c) {
    var k = keyOf(c.d), arr = by[k] || [];
    return '<div class="db-cell' + (c.out ? ' out' : '') + (k === td ? ' today' : '') + (arr.length ? ' has' : '') + '"' + (arr.length ? ' onclick="openDay(\'' + k + '\')"' : '') + '><span class="db-num">' + c.d.getDate() + '</span>' +
      (arr.length ? '<span class="db-badge' + (k < td ? ' late' : k === td ? ' now' : '') + '">' + arr.length + '</span>' +
        arr.slice(0, 2).map(function (l) { return '<div class="db-chip t-' + esc(l.temp) + '">' + esc(l.name.split(' ')[0]) + '</div>'; }).join('') +
        (arr.length > 2 ? '<div class="db-chip">+' + (arr.length - 2) + '</div>' : '') : '') + '</div>';
  }).join('');
  setHtml('dbGrid', '<div class="db-dow">' + DOW.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="db-grid">' + cells + '</div>');

  // monthly lead trend (server returns oldest -> newest, zero months included)
  var months = dbData.trend.map(function (m) { return { label: String(m.monthLabel || m.label || m.monthKey || '').slice(0, 3), c: Number(m.count != null ? m.count : m.leadCount) || 0 }; });
  var max = Math.max.apply(null, months.map(function (x) { return x.c; }).concat(1));
  setHtml('dbTrend', '<div class="db-bars">' + months.map(function (m) {
    return '<div class="db-bar-col"><span class="db-bar-val">' + m.c + '</span><div class="db-bar-area"><div class="db-bar" style="height:' + Math.round(m.c / max * 100) + '%"></div></div><span class="db-bar-lbl">' + esc(m.label) + '</span></div>';
  }).join('') + '</div>');

  // leads by service (donut)
  var svc = s.byService || [], sum = svc.reduce(function (t, x) { return t + x.count; }, 0), acc = 0, total = sum || 1;
  var stops = svc.map(function (x, j) { var a = acc / total * 100; acc += x.count; return chartPalette[j % chartPalette.length] + ' ' + a + '% ' + (acc / total * 100) + '%'; }).join(',');
  setHtml('dbDonut', '<div class="db-donut-wrap"><div class="db-donut" style="background:conic-gradient(' + (stops || '#d6eae6 0 100%') + ')"><div class="db-donut-hole">' + sum + '<span>leads</span></div></div><div class="db-legend">' +
    (svc.length ? svc.map(function (x, j) { return '<div><i style="background:' + chartPalette[j % chartPalette.length] + '"></i>' + esc(x.name) + ' <b>' + x.count + '</b></div>'; }).join('') : '<div>No data yet</div>') + '</div></div>');
}

function openDay(key) {
  var list = pendingFollowups().filter(function (l) { return l.nextFollowup === key; });
  if (!list.length) return;
  var rows = list.map(function (l) {
    return `
      <tr class="border-b border-gray-100 table-row-hover">
        <td class="px-4 py-3"><div class="font-semibold text-gray-800">${esc(l.name)}</div><div class="text-[11px] text-gray-400">${esc(l.company)}</div></td>
        <td class="px-4 py-3 text-gray-600">${esc(l.mobile)}</td>
        <td class="px-4 py-3 text-gray-600">${esc(l.service)}</td>
        <td class="px-4 py-3">${tempPill(l.temp)}</td>
        <td class="px-4 py-3">${prioPill(l.priority)}</td>
        <td class="px-4 py-3 text-gray-600">${esc(l.assignedTo) || 'Unassigned'}</td>
        <td class="px-4 py-3"><div class="flex gap-1">${actBtn("viewLead(" + l.id + ")", 'eye', 'View')}${actBtn("openFuDone(" + l.id + ")", 'circle-check', 'Mark done')}${actBtn("openFuNext(" + l.id + ")", 'calendar-plus', 'Next follow-up')}${actBtn("openJourney('" + esc(l.number) + "')", 'clock-rotate-left', 'History')}</div></td>
      </tr>`;
  }).join('');
  openModal(modalHeader('Follow-ups — ' + fmtDate(key), list.length + ' lead' + (list.length > 1 ? 's' : '')) +
    '<div class="px-6 py-4 modal-scroll">' + tableHtml(['Lead', 'Mobile', 'Service', 'Temp', 'Priority', 'Assigned', 'Actions'], rows) + '</div>' + modalFooter('Close', 'onclick="closeModal()"'), { width: 'max-w-4xl' });
}

// =============================================================
// INIT
// =============================================================
loadStaff();
document.querySelectorAll('.sidebar-nav-link[data-page^="crm-"]').forEach(function (a) {
  a.addEventListener('click', function (e) { e.preventDefault(); switchModuleTab(CRM_TABS[a.dataset.page.slice(4)]); });
});
(function () {
  var t = new URLSearchParams(location.search).get('tab'); t = CRM_TABS[t] || t;
  switchModuleTab(['db', 'lr', 'cl', 'dl', 'cw', 'al'].indexOf(t) !== -1 ? t : 'db');
})();