// ===== Firebase 설정 =====
const firebaseConfig = {
  apiKey: "AIzaSyBsm8OMI_Do2T1d1tUZqjBavwp8bc4IKGg",
  authDomain: "market-399ce.firebaseapp.com",
  projectId: "market-399ce",
  storageBucket: "market-399ce.firebasestorage.app",
  messagingSenderId: "255179750883",
  appId: "1:255179750883:web:a7c74cbef815821e9834d6"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 관리자 비밀번호 (필요하면 이 값만 바꾸면 됩니다)
const ADMIN_PASSWORD = "daeseo";

// ===== 상태 =====
let students = [];      // [{id, docId, name, balance}]
let items = [];         // [{docId, name, price}]
let currentStudent = null;
let cart = {};
let lastAction = {};    // 중복 스캔 방지용: key = studentId+type, value = timestamp

// ===== 잠금 화면 =====
function tryUnlock() {
  const pw = document.getElementById('admin-pw').value;
  if (pw === ADMIN_PASSWORD) {
    sessionStorage.setItem('market_unlocked', '1');
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    initApp();
  } else {
    showToast('비밀번호가 올바르지 않습니다', true);
  }
}
if (sessionStorage.getItem('market_unlocked') === '1') {
  document.getElementById('lock-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  window.addEventListener('DOMContentLoaded', initApp);
}

// ===== 초기 로딩 =====
function initApp() {
  loadStudents();
  loadItems();
}

function loadStudents() {
  db.collection('students').orderBy('id').onSnapshot(snap => {
    students = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    if (document.getElementById('panel-students').style.display !== 'none') renderStudents();
  }, err => showToast('학생 데이터를 불러오지 못했습니다', true));
}

function loadItems() {
  db.collection('items').orderBy('price').onSnapshot(snap => {
    items = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    if (document.getElementById('panel-items').style.display !== 'none') renderItemManage();
  }, err => showToast('물건 데이터를 불러오지 못했습니다', true));
}

// ===== 탭 전환 =====
function switchTab(name) {
  ['main', 'students', 'items', 'purchase', 'log'].forEach(t => {
    const el = document.getElementById('panel-' + t);
    if (el) el.style.display = (t === name) ? 'block' : 'none';
  });
  ['main', 'students', 'items', 'log'].forEach(t => {
    const btn = document.getElementById('tab-' + t);
    if (!btn) return;
    const active = (t === name) || (name === 'purchase' && t === 'main');
    btn.classList.toggle('active', active);
  });
  if (name === 'students') renderStudents();
  if (name === 'items') renderItemManage();
  if (name === 'purchase') renderPurchase();
  if (name === 'log') loadLog();
}

// ===== 스캔 =====
function doScan(rawVal) {
  const val = rawVal.trim().toUpperCase();
  if (!val) return;
  const s = students.find(x => x.id.toUpperCase() === val);
  if (!s) { showToast('등록되지 않은 바코드입니다: ' + val, true); return; }
  currentStudent = s;
  document.getElementById('scan-idle').style.display = 'none';
  document.getElementById('scan-result').style.display = 'block';
  document.getElementById('deposit-box').style.display = 'none';
  renderScanResult();
}
function renderScanResult() {
  document.getElementById('result-name').textContent = currentStudent.name;
  document.getElementById('result-id').textContent = currentStudent.id;
  document.getElementById('result-balance').textContent = currentStudent.balance.toLocaleString();
  document.getElementById('result-initials').textContent = currentStudent.name.slice(0, 2);
}
function resetScan() {
  currentStudent = null;
  document.getElementById('scan-idle').style.display = 'block';
  document.getElementById('scan-result').style.display = 'none';
  document.getElementById('deposit-box').style.display = 'none';
  document.getElementById('scan-input').focus();
}

// ===== 중복 스캔 방지 =====
// 같은 학생 + 같은 거래 종류를 5초 안에 다시 시도하면 확인 요청
function checkDuplicate(studentDocId, type) {
  const key = studentDocId + '_' + type;
  const now = Date.now();
  const last = lastAction[key];
  lastAction[key] = now;
  if (last && (now - last) < 5000) {
    return !confirm('방금 같은 학생에게 같은 처리를 했습니다. 정말 다시 진행할까요?');
  }
  return false;
}

// ===== 적립 =====
function openDeposit() {
  document.getElementById('deposit-box').style.display = 'block';
  document.getElementById('deposit-amount').focus();
}
async function doDeposit() {
  const amt = Number(document.getElementById('deposit-amount').value);
  const reason = document.getElementById('deposit-reason').value.trim() || '적립';
  if (!amt || amt <= 0) { showToast('적립 금액을 입력하세요', true); return; }
  if (checkDuplicate(currentStudent.docId, 'deposit')) return;

  const newBalance = currentStudent.balance + amt;
  try {
    await db.collection('students').doc(currentStudent.docId).update({ balance: newBalance });
    await addLog(currentStudent, 'deposit', amt, reason, newBalance);
    currentStudent.balance = newBalance;
    renderScanResult();
    document.getElementById('deposit-amount').value = '';
    document.getElementById('deposit-reason').value = '';
    document.getElementById('deposit-box').style.display = 'none';
    showToast(currentStudent.name + '님 ' + amt.toLocaleString() + '달란트 적립 완료');
  } catch (e) {
    showToast('적립 처리 중 오류가 발생했습니다', true);
  }
}

// ===== 구매 =====
function renderPurchase() {
  cart = {};
  document.getElementById('purchase-who').textContent =
    currentStudent.name + ' · 잔액 ' + currentStudent.balance.toLocaleString();
  const list = document.getElementById('item-list');
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state">등록된 물건이 없습니다. 물건 관리 탭에서 추가하세요.</div>';
    updateCartTotal();
    return;
  }
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML =
      '<span style="flex:1; font-size:15px;">' + escapeHtml(it.name) + '</span>' +
      '<span style="font-size:13px; color:#7a7a7a;">' + it.price.toLocaleString() + '</span>' +
      '<button class="qty-btn qty-minus" onclick="changeCart(' + idx + ',-1)" aria-label="빼기">-</button>' +
      '<span style="min-width:16px; text-align:center; font-size:14px;" id="cart-qty-' + idx + '">0</span>' +
      '<button class="qty-btn qty-plus" onclick="changeCart(' + idx + ',1)" aria-label="더하기">+</button>';
    list.appendChild(row);
  });
  updateCartTotal();
}
function changeCart(idx, delta) {
  cart[idx] = Math.max(0, (cart[idx] || 0) + delta);
  document.getElementById('cart-qty-' + idx).textContent = cart[idx];
  updateCartTotal();
}
function updateCartTotal() {
  let total = 0;
  Object.keys(cart).forEach(idx => { total += cart[idx] * items[idx].price; });
  document.getElementById('cart-total').textContent = total.toLocaleString();
}
async function doPurchase() {
  let total = 0;
  const boughtNames = [];
  Object.keys(cart).forEach(idx => {
    if (cart[idx] > 0) {
      total += cart[idx] * items[idx].price;
      boughtNames.push(items[idx].name + ' x' + cart[idx]);
    }
  });
  if (total <= 0) { showToast('물건을 선택하세요', true); return; }
  if (total > currentStudent.balance) { showToast('잔액이 부족합니다', true); return; }
  if (checkDuplicate(currentStudent.docId, 'purchase')) return;

  const newBalance = currentStudent.balance - total;
  try {
    await db.collection('students').doc(currentStudent.docId).update({ balance: newBalance });
    await addLog(currentStudent, 'purchase', -total, boughtNames.join(', '), newBalance);
    currentStudent.balance = newBalance;
    showToast(currentStudent.name + '님 구매 완료 · ' + total.toLocaleString() + '달란트 차감');
    switchTab('main');
    renderScanResult();
  } catch (e) {
    showToast('구매 처리 중 오류가 발생했습니다', true);
  }
}

// ===== 학생 관리 =====
function renderStudents() {
  const wrap = document.getElementById('student-table');
  wrap.innerHTML = '';
  if (students.length === 0) {
    wrap.innerHTML = '<div class="empty-state">등록된 학생이 없습니다.</div>';
    return;
  }
  students.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'student-row';
    row.innerHTML =
      '<input type="checkbox" data-idx="' + idx + '" class="bulk-check">' +
      '<span style="flex:1; font-size:15px;">' + escapeHtml(s.name) + '</span>' +
      '<span style="font-size:12px; color:#7a7a7a;">' + escapeHtml(s.id) + '</span>' +
      '<span style="font-size:15px; font-weight:600; min-width:55px; text-align:right;">' + s.balance.toLocaleString() + '</span>';
    wrap.appendChild(row);
  });
}
async function bulkApply(sign) {
  const amt = Number(document.getElementById('bulk-amount').value);
  const reason = document.getElementById('bulk-reason').value.trim() || (sign > 0 ? '일괄 적립' : '일괄 차감');
  if (!amt || amt <= 0) { showToast('금액을 입력하세요', true); return; }
  const checks = document.querySelectorAll('.bulk-check:checked');
  if (checks.length === 0) { showToast('학생을 선택하세요', true); return; }
  if (!confirm(checks.length + '명에게 ' + amt.toLocaleString() + '달란트를 ' + (sign > 0 ? '적립' : '차감') + '합니다. 진행할까요?')) return;

  const batch = db.batch();
  const targets = [];
  checks.forEach(c => {
    const idx = Number(c.dataset.idx);
    const s = students[idx];
    const newBalance = Math.max(0, s.balance + sign * amt);
    batch.update(db.collection('students').doc(s.docId), { balance: newBalance });
    targets.push({ s, newBalance, delta: sign * amt });
  });
  try {
    await batch.commit();
    for (const t of targets) {
      await addLog(t.s, sign > 0 ? 'bulk_deposit' : 'bulk_deduct', t.delta, reason, t.newBalance);
    }
    document.getElementById('bulk-amount').value = '';
    document.getElementById('bulk-reason').value = '';
    showToast(checks.length + '명 처리 완료');
  } catch (e) {
    showToast('일괄 처리 중 오류가 발생했습니다', true);
  }
}

// ===== 물건 관리 =====
function renderItemManage() {
  const wrap = document.getElementById('item-manage-list');
  wrap.innerHTML = '';
  if (items.length === 0) {
    wrap.innerHTML = '<div class="empty-state">등록된 물건이 없습니다.</div>';
    return;
  }
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML =
      '<input value="' + escapeHtml(it.name) + '" style="flex:2; border:none; background:transparent; padding:0;" data-field="name" data-id="' + it.docId + '">' +
      '<input type="number" value="' + it.price + '" style="flex:1; border:none; background:transparent; padding:0;" data-field="price" data-id="' + it.docId + '">' +
      '<button class="btn-danger" style="flex:0 0 36px; padding:8px;" aria-label="삭제" onclick="removeItem(\'' + it.docId + '\')"><i class="ti ti-trash"></i></button>';
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', onItemFieldChange);
  });
}
async function onItemFieldChange(e) {
  const id = e.target.dataset.id;
  const field = e.target.dataset.field;
  let value = e.target.value;
  if (field === 'price') value = Number(value);
  try {
    await db.collection('items').doc(id).update({ [field]: value });
  } catch (err) {
    showToast('수정 중 오류가 발생했습니다', true);
  }
}
async function addItem() {
  const name = document.getElementById('new-item-name').value.trim();
  const price = Number(document.getElementById('new-item-price').value);
  if (!name || !price) { showToast('이름과 가격을 입력하세요', true); return; }
  try {
    await db.collection('items').add({ name, price });
    document.getElementById('new-item-name').value = '';
    document.getElementById('new-item-price').value = '';
    showToast('물건이 추가되었습니다');
  } catch (e) {
    showToast('추가 중 오류가 발생했습니다', true);
  }
}
async function removeItem(docId) {
  if (!confirm('이 물건을 삭제할까요?')) return;
  try {
    await db.collection('items').doc(docId).delete();
  } catch (e) {
    showToast('삭제 중 오류가 발생했습니다', true);
  }
}

// ===== 거래 로그 =====
async function addLog(student, type, delta, reason, resultingBalance) {
  await db.collection('logs').add({
    studentDocId: student.docId,
    studentId: student.id,
    studentName: student.name,
    type, delta, reason,
    resultingBalance,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
}
function loadLog() {
  const wrap = document.getElementById('log-list');
  wrap.innerHTML = '<div class="empty-state">불러오는 중...</div>';
  db.collection('logs').orderBy('timestamp', 'desc').limit(100).get().then(snap => {
    if (snap.empty) {
      wrap.innerHTML = '<div class="empty-state">아직 거래 내역이 없습니다.</div>';
      return;
    }
    wrap.innerHTML = '';
    snap.docs.forEach(d => {
      const log = d.data();
      const time = log.timestamp ? log.timestamp.toDate().toLocaleString('ko-KR') : '';
      const sign = log.delta > 0 ? '+' : '';
      const row = document.createElement('div');
      row.className = 'log-row';
      row.innerHTML =
        '<span>' + escapeHtml(log.studentName) + ' · ' + escapeHtml(log.reason || '') + '</span>' +
        '<span class="log-meta">' + sign + log.delta.toLocaleString() + ' · ' + time + '</span>';
      wrap.appendChild(row);
    });
  }).catch(() => { wrap.innerHTML = '<div class="empty-state">불러오기에 실패했습니다.</div>'; });
}

// ===== 유틸 =====
function showToast(msg, danger) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('danger', !!danger);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
