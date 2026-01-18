// ★GASのURL（ご自身の新しいURLに書き換えてください）
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyCiKN_tDGJn80oU-1oQnhi8daCwP2LFK2K_DFuEAGvLcr_cit03qSH0gCQwEzbtlOmRQ/exec";

// 変数
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let staffList = [];
let shiftSettings = [];
let shiftData = [];
let selectedCells = new Set();
let isDragging = false;
let modalCallback = null;

const PRESET_COLORS = ["#ffcdd2", "#f8bbd0", "#e1bee7", "#d1c4e9", "#c5cae9", "#bbdefb", "#b2ebf2", "#b2dfdb", "#c8e6c9", "#fff9c4"];
let selectedNewColor = PRESET_COLORS[0];

// タッチ操作制御用
let longPressTimer = null;   // 長押し判定用タイマー
let isSelectionMode = false; // 選択モードかどうか
let startX = 0;              // タッチ開始位置X
let startY = 0;              // タッチ開始位置Y
let isScrolling = false;     // スクロール中かどうか


// ==========================================
// 通信関数 (安定版)
// ==========================================
function postToGAS(payloadObj) {
    return fetch(GAS_API_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain" },
        // GitHubなどの外部からアクセスする場合、リダイレクトを明示的に許可すると安定します
        redirect: 'follow', 
        body: JSON.stringify(payloadObj)
    })
    .then(res => res.text())
    .then(text => {
        try { return JSON.parse(text); } 
        catch (e) { console.error("RAW:", text); throw new Error("サーバーエラー\n" + text.substring(0, 50)); }
    });
}

// ==========================================
// アプリ制御 (高速化・並列処理版)
// ==========================================
function refreshView(needsConfig = true) {
    showLoading(true);

    // 通信処理の配列を作成
    const requests = [];

    // 1. 設定取得のリクエスト（必要な場合のみ）
    if (needsConfig) {
        requests.push(postToGAS({ action: 'getConfig' }));
    } else {
        requests.push(Promise.resolve(null)); // 何もしないPromise
    }

    // 2. シフトデータ取得のリクエスト（常に実行）
    requests.push(postToGAS({ action: 'getShifts', year: currentYear, month: currentMonth }));

    // ★高速化の肝：Promise.allで並列実行
    Promise.all(requests)
    .then(([configData, shiftRes]) => {
        // --- 設定データの反映 ---
        if (configData) {
            if (configData.status === 'success') {
                staffList = configData.staff;
                shiftSettings = configData.shifts;
            } else {
                throw new Error(configData.message);
            }
        }

        // --- シフトデータの反映 ---
        if (shiftRes.status === 'success') {
            shiftData = shiftRes.data;
            renderToolbar(); // アイコン再描画
            renderTable();   // テーブル再描画
            document.getElementById('current-month-display').innerText = `${currentMonth}月`;
            showLoading(false);
        } else {
            throw new Error(shiftRes.message);
        }
    })
    .catch(err => {
        showLoading(false);
        showAlert('error', 'エラー', err.toString());
    });
}

function attemptLogin() {
    const pwd = document.getElementById('password-input').value;
    showLoading(true);
    postToGAS({ action: 'login', password: pwd })
    .then(data => {
        if (data.status === 'success') {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            refreshView(true); // 初回は設定も読み込む
        } else {
            showLoading(false);
            showAlert('error', '失敗', data.message);
        }
    })
    .catch(err => { showLoading(false); showAlert('error', '通信エラー', err.toString()); });
}

function changeMonth(diff) {
    currentMonth += diff;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    else if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    clearSelection();
    // ★高速化ポイント: 月移動時は設定（スタッフ等）を再読込せず、シフトだけ読み込む
    refreshView(false);
}

// ==========================================
// 説明書モーダル制御
// ==========================================
function openHelpModal() {
    document.getElementById('help-modal-overlay').style.display = 'flex';
}
function closeHelpModal() {
    document.getElementById('help-modal-overlay').style.display = 'none';
}


// ==========================================
// 編集・保存 (変更時は refreshView(true) で全更新)
// ==========================================
function saveDataConfirm() {
    showConfirm('保存', '現在の内容で保存しますか？', executeSaveData);
}

function executeSaveData() {
    let payload = [];
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    if(!staffList || staffList.length === 0) { showAlert('error', 'エラー', 'スタッフがいません'); return; }

    for (let day = 1; day <= daysInMonth; day++) {
        let dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        staffList.forEach(staff => {
            let cell = document.getElementById(`cell_${dateStr}_${staff}`);
            if(cell && cell.dataset.value){
                payload.push({ date: dateStr, staff: staff, shift: cell.dataset.value });
            }
        });
    }

    showLoading(true);
    postToGAS({ action: 'saveShifts', payload: payload })
    .then(data => {
        showLoading(false);
        if(data.status === 'success') {
            showAlert('success', '完了', 'データを保存しました');
        } else {
            showAlert('error', '保存失敗', data.message);
        }
    })
    .catch(err => { showLoading(false); showAlert('error', '通信エラー', err.toString()); });
}

// スタッフ追加
function openStaffModal() {
    document.getElementById('staff-modal-overlay').style.display = 'flex';
    document.getElementById('new-staff-name').value = "";
}
function closeStaffModal() { document.getElementById('staff-modal-overlay').style.display = 'none'; }
function saveNewStaff() {
    const name = document.getElementById('new-staff-name').value;
    if(!name) { showAlert('error', 'エラー', '名前を入力してください'); return; }
    showLoading(true);
    postToGAS({ action: 'addStaff', name: name }).then(data => {
        if(data.status === 'success') { closeStaffModal(); refreshView(true); } 
        else { showLoading(false); showAlert('error', '失敗', data.message); }
    }).catch(err => { showLoading(false); showAlert('error', 'エラー', err.toString()); });
}
function deleteStaff() {
    const name = document.getElementById('new-staff-name').value;
    if(!name) { showAlert('error', 'エラー', '削除する名前を入力してください'); return; }
    showConfirm('削除確認', `「${name}」を削除しますか？\nデータは復元できません。`, () => {
        showLoading(true);
        postToGAS({ action: 'deleteStaff', name: name }).then(data => {
            if(data.status === 'success') { closeStaffModal(); refreshView(true); } 
            else { showLoading(false); showAlert('error', '失敗', data.message); }
        }).catch(err => { showLoading(false); showAlert('error', 'エラー', err.toString()); });
    });
}

// アイコン編集
function openModal() { document.getElementById('modal-overlay').style.display = 'flex'; document.getElementById('new-shift-label').value = ""; renderColorPicker(); }
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }
function saveNewIcon() {
    const label = document.getElementById('new-shift-label').value;
    if(!label || label.length > 2) { showAlert('error', 'エラー', '2文字以内で入力してください'); return; }
    showLoading(true);
    postToGAS({ action: 'saveSetting', label: label, color: selectedNewColor }).then(data => {
        if(data.status === 'success') { closeModal(); refreshView(true); showAlert('success', '完了', `「${label}」を追加しました`); }
        else { showLoading(false); showAlert('error', '失敗', data.message); }
    }).catch(err => { showLoading(false); showAlert('error', 'エラー', err.toString()); });
}
function deleteIcon() {
    const label = document.getElementById('new-shift-label').value;
    if(!label) { showAlert('error', 'エラー', '削除するアイコン名を入力してください'); return; }
    showConfirm('削除確認', `「${label}」を削除しますか？`, () => {
        showLoading(true);
        postToGAS({ action: 'deleteSetting', label: label }).then(data => {
            if(data.status === 'success') { closeModal(); refreshView(true); showAlert('success', '完了', '削除しました'); }
            else { showLoading(false); showAlert('error', '失敗', data.message); }
        }).catch(err => { showLoading(false); showAlert('error', 'エラー', err.toString()); });
    });
}

// ==========================================
// 描画・操作系
// ==========================================
function renderTable() {
    const thead = document.getElementById('table-head');
    const tbody = document.getElementById('table-body');
    thead.innerHTML = ""; tbody.innerHTML = "";
    
    if(!staffList || staffList.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5' style='padding:20px; text-align:center;'>スタッフがいません。<br>上の編集ボタンから追加してください。</td></tr>";
        return;
    }

    let trHead = document.createElement('tr');
    trHead.innerHTML = '<th style="width:50px;">日</th>';
    staffList.forEach(s => {
        let th = document.createElement('th'); th.innerText = s; trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
        let dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        let dateObj = new Date(currentYear, currentMonth - 1, day);
        let tr = document.createElement('tr');
        
        let thDate = document.createElement('th');
        thDate.innerText = `${day}`; // シンプルに数字のみ
        if (dateObj.getDay() === 0) thDate.className = "sunday";
        if (dateObj.getDay() === 6) thDate.className = "saturday";
        tr.appendChild(thDate);

        staffList.forEach(staff => {
            let td = document.createElement('td');
            let cellId = `cell_${dateStr}_${staff}`;
            td.id = cellId;
            let record = shiftData.find(d => d.date === dateStr && d.staff === staff);
            let val = record ? record.shift : "";
            td.dataset.value = val;
            updateCellStyle(td, val);
            
            // タッチ操作ロジック
            td.addEventListener('touchstart', handleTouchStart, {passive: false});
            td.addEventListener('touchmove', handleTouchMove, {passive: false});
            td.addEventListener('touchend', handleTouchEnd);
            td.addEventListener('touchcancel', handleTouchEnd);

            // マウス操作（PC用）
            td.onmousedown = (e) => { isDragging = true; toggleSelection(td); e.preventDefault(); };
            td.onmouseover = () => { if(isDragging) addSelection(td); };
            td.onmouseup = () => { isDragging = false; };
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }
}
document.body.onmouseup = () => isDragging = false;

function updateCellStyle(td, val) {
    td.innerText = val;
    let setting = shiftSettings.find(s => s.label === val);
    td.style.backgroundColor = setting ? setting.color : "#fff";
    td.style.color = setting ? "#333" : "#333";
}

function renderToolbar() {
    const container = document.getElementById('shift-buttons');
    container.innerHTML = "";
    
    // 消去ボタン
    let btnClear = document.createElement('div');
    btnClear.className = 'shift-btn';
    btnClear.innerText = '消去';
    btnClear.style.backgroundColor = '#fff';
    btnClear.style.color = '#e74c3c';
    btnClear.onclick = () => applyShiftToSelection("");
    container.appendChild(btnClear);

    if(shiftSettings) {
        shiftSettings.forEach(s => {
            let btn = document.createElement('div');
            btn.className = 'shift-btn';
            btn.innerText = s.label;
            btn.style.backgroundColor = s.color;
            btn.onclick = () => applyShiftToSelection(s.label);
            container.appendChild(btn);
        });
    }
}

// ==========================================
// ツールバー開閉制御（新機能）
// ==========================================
function toggleToolbar() {
    const toolbar = document.getElementById('toolbar');
    const body = document.body;
    
    // クラスを付け外ししてCSSの状態を切り替える
    toolbar.classList.toggle('toolbar-hidden');
    body.classList.toggle('menu-closed');
}

// ==========================================
// 共通機能（タッチ・長押し・スクロール判定）
// ==========================================

function handleTouchStart(e) {
    // タッチ開始位置を記録
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    
    isScrolling = false;     // スクロールフラグ初期化
    isSelectionMode = false; // 選択モード初期化

    // 長押しタイマー開始 (0.5秒 = 500ms)
    longPressTimer = setTimeout(() => {
        // 0.5秒間、指が大きく動かなければ「選択モード」発動
        if (!isScrolling) {
            isSelectionMode = true;
            if (navigator.vibrate) navigator.vibrate(50); // ブルっとさせる
            
            let td = e.target.closest('td');
            if(td) {
                addSelection(td); // 最初のセルを選択
            }
        }
    }, 500); 
}

function handleTouchMove(e) {
    const touch = e.touches[0];

    // 選択モード中の場合：スクロールを止めて、なぞって選択
    if (isSelectionMode) {
        if (e.cancelable) e.preventDefault(); // スクロール禁止
        
        // 指の下にある要素を取得
        let target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && target.tagName === 'TD' && target.id.startsWith('cell_')) {
            addSelection(target);
        }
        return;
    }

    // まだ長押し確定前の場合：指が動いたらタイマー解除（ただのスクロールとみなす）
    const moveX = Math.abs(touch.clientX - startX);
    const moveY = Math.abs(touch.clientY - startY);

    if (moveX > 10 || moveY > 10) { // 10px以上動いたらスクロールと判定
        isScrolling = true;
        if(longPressTimer) {
            clearTimeout(longPressTimer); // 長押しキャンセル
            longPressTimer = null;
        }
    }
}

function handleTouchEnd(e) {
    // 指が離れたらタイマー解除
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    // 選択モードでもなく、スクロールもしていない場合 ＝ 「単発タップ」
    if (!isSelectionMode && !isScrolling) {
        let td = e.target.closest('td');
        if (td) {
            toggleSelection(td); // タップで選択/解除
        }
    }

    // すべてリセット
    isSelectionMode = false;
    isScrolling = false;
}

// 既存の選択ロジック（そのまま維持）
function toggleSelection(td) { if(selectedCells.has(td.id)) { selectedCells.delete(td.id); td.classList.remove('selected'); } else { addSelection(td); } }
function addSelection(td) { if(!selectedCells.has(td.id)){ selectedCells.add(td.id); td.classList.add('selected'); } }
function clearSelection() { selectedCells.forEach(id => { let el = document.getElementById(id); if(el) el.classList.remove('selected'); }); selectedCells.clear(); }
function applyShiftToSelection(val) { if(selectedCells.size === 0) return; selectedCells.forEach(id => { let td = document.getElementById(id); if(td) { td.dataset.value = val; updateCellStyle(td, val); } }); clearSelection(); }

function renderColorPicker() {
    const container = document.getElementById('color-picker-container');
    container.innerHTML = "";
    selectedNewColor = PRESET_COLORS[0];
    PRESET_COLORS.forEach((color, idx) => {
        let div = document.createElement('div');
        div.className = 'color-swatch';
        div.style.backgroundColor = color;
        if(idx === 0) div.classList.add('selected');
        div.onclick = () => { document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected')); div.classList.add('selected'); selectedNewColor = color; };
        container.appendChild(div);
    });
}

function showLoading(bool) { document.getElementById('loading-overlay').style.display = bool ? 'flex' : 'none'; }
function showAlert(type, title, message) {
    const box = document.getElementById('msg-modal-box');
    box.classList.remove('type-error', 'type-success');
    box.classList.add(type === 'error' ? 'type-error' : 'type-success');
    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-content').innerText = message;
    document.getElementById('msg-btn-cancel').style.display = 'none';
    document.getElementById('msg-btn-ok').onclick = closeMsgModal;
    document.getElementById('msg-modal-overlay').style.display = 'flex';
}
function showConfirm(title, message, callback) {
    const box = document.getElementById('msg-modal-box');
    box.classList.remove('type-error', 'type-success');
    box.classList.add('type-success'); 
    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-content').innerText = message;
    document.getElementById('msg-btn-cancel').style.display = 'inline-block';
    modalCallback = callback;
    document.getElementById('msg-btn-ok').onclick = () => { const action = modalCallback; closeMsgModal(); if (action) action(); };
    document.getElementById('msg-modal-overlay').style.display = 'flex';
}
function closeMsgModal() { document.getElementById('msg-modal-overlay').style.display = 'none'; modalCallback = null; }

function downloadPDF() { 
    showLoading(true); 
    const table = document.getElementById('shift-table'); 
    html2canvas(table, { scale: 2 }).then(canvas => { 
        const imgData = canvas.toDataURL('image/png'); 
        const { jsPDF } = window.jspdf; 
        const doc = new jsPDF({ orientation: 'portrait' }); 
        const imgProps = doc.getImageProperties(imgData); 
        const pdfWidth = doc.internal.pageSize.getWidth(); 
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width; 
        doc.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight); 
        doc.save(`shift_${currentYear}_${currentMonth}.pdf`); 
        showLoading(false); 
        showAlert('success', '完了', 'PDFを保存しました'); 
    }).catch(err => { showLoading(false); showAlert('error', 'エラー', err.toString()); }); 
}