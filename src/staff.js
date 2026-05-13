import { S } from './state.js';
import { listenStaffUsers, createStaffAccount, toggleStaffActive, deleteStaffAccount, resetStaffPassword } from './auth.js';
import { toast } from './utils.js';

let _staffUnsub = null;
let _staffList  = [];

export function initStaffManager() {
  _staffUnsub = listenStaffUsers(users => {
    _staffList = users;
    renderStaffTable();
  });
}

export function destroyStaffManager() {
  if (_staffUnsub) { _staffUnsub(); _staffUnsub = null; }
}

// ── RENDER STAFF TABLE ────────────────────────────────────
export function renderStaffTable() {
  const tbody = document.getElementById('staff-tbody');
  if (!tbody) return;

  if (!_staffList.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state" style="padding:32px">
        <div class="empty-icon">👤</div>
        <div class="empty-title">No staff accounts yet</div>
        <div class="empty-sub">Use the form above to create the first account</div>
      </div></td></tr>`;
    return;
  }

  const roleColor = { owner:'t-teal', manager:'t-blue', staff:'t-muted' };

  tbody.innerHTML = _staffList
    .sort((a,b) => (a.role==='owner'?0:1) - (b.role==='owner'?0:1))
    .map(u => `<tr>
      <td>
        <div class="fw6">${u.name || '—'}</div>
        ${u.mustReset ? '<div class="fs11" style="color:var(--amber)">⚠ Password reset pending</div>' : ''}
      </td>
      <td class="t-muted fs12">${u.email || '—'}</td>
      <td class="${roleColor[u.role]||'t-muted'} fw6 fs12">${capitalize(u.role || 'staff')}</td>
      <td>
        <span class="badge ${u.active ? 'badge-received' : 'badge-pending'}">
          ${u.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td class="t-muted fs11">${u.createdAt ? u.createdAt.slice(0,10) : '—'}</td>
      <td style="text-align:center">
        ${u.role !== 'owner' ? `
          <div style="display:flex;gap:5px;justify-content:center">
            <button class="btn btn-ghost btn-xs" onclick="window.showPasswordNote('${u.uid}','${u.name||u.email}')">🔑 Set Pass</button>
            <button class="btn btn-ghost btn-xs ${u.active?'btn-danger':''}"
              onclick="window.toggleStaff('${u.uid}',${!u.active})">
              ${u.active ? '🚫 Deactivate' : '✅ Activate'}
            </button>
            <button class="btn btn-danger btn-xs" onclick="window.removeStaff('${u.uid}','${u.name||u.email}')">🗑</button>
          </div>` : '<span class="t-muted fs11">Owner</span>'}
      </td>
    </tr>`).join('');
}

// ── CREATE ACCOUNT ────────────────────────────────────────
export async function createStaff() {
  const name  = document.getElementById('staff-name').value.trim();
  const email = document.getElementById('staff-email').value.trim();
  const pass  = document.getElementById('staff-pass').value;
  const role  = document.getElementById('staff-role').value;

  if (!name)  return alert('Name is required');
  if (!email) return alert('Email is required');
  if (!pass || pass.length < 6) return alert('Password must be at least 6 characters');

  const btn = document.getElementById('create-staff-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    await createStaffAccount(email, pass, name, role);
    toast(`Account created for ${name} ✓`);
    // Clear form
    ['staff-name','staff-email','staff-pass'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    document.getElementById('staff-role').value = 'staff';
  } catch(e) {
    const msgs = {
      'EMAIL_EXISTS':    'This email already has an account.',
      'INVALID_EMAIL':   'Invalid email address.',
      'WEAK_PASSWORD':   'Password too weak — use at least 6 characters.',
    };
    const key = e.message.includes('EMAIL_EXISTS') ? 'EMAIL_EXISTS' :
                e.message.includes('WEAK_PASSWORD') ? 'WEAK_PASSWORD' : '';
    alert(msgs[key] || 'Error: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Create Account';
}

export async function toggleStaff(uid, active) {
  const action = active ? 'activate' : 'deactivate';
  if (!confirm(`${capitalize(action)} this account?`)) return;
  await toggleStaffActive(uid, active);
  toast(`Account ${action}d ✓`);
}

export async function removeStaff(uid, name) {
  if (!confirm(`Remove ${name}'s access permanently?\n\nThey won't be able to sign in anymore.`)) return;
  await deleteStaffAccount(uid);
  toast(`${name} removed ✓`);
}

export function showPasswordNote(uid, name) {
  const pass = prompt(`Set a new password for ${name}:\n(At least 6 characters)\n\nNote: They will see this password noted in their account.`);
  if (!pass) return;
  if (pass.length < 6) { alert('Password must be at least 6 characters.'); return; }
  // Store as a note for the owner to communicate manually
  // (Firebase client SDK can't reset another user's password directly)
  resetStaffPassword(uid, pass).then(() => {
    toast(`Password note saved for ${name}. Communicate the new password to them directly.`);
  });
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
