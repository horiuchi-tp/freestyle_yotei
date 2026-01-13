// ★GASのURL（ご自身のURLに書き換えてください）
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

// ==========================================
// 初期化・便利機能
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // フォーカスを外す＝キーボードが閉じる
            }
        });
    });
    
    // 背景クリックでキーボードを閉じる
    document.addEventListener('click', (e) => {
        if (!e.target.closest('input') && !e.target.closest('button') && !e.target.closest('.modal-box')) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }
        }
    });
});

// ==========================================
// 通信関数
// ==========================================
function postToGAS(payloadObj) {
    return fetch(GAS_API_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain" },
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
// アプリ制御
// ==========================================
function refreshView(needsConfig = true) {
    showLoading(true);
    let promiseChain = Promise.resolve();

    if (needsConfig) {
        promiseChain = promiseChain.then(() => postToGAS({ action: 'getConfig' }))
            .then(configData => {
                if (configData.status === 'success') {
                    staffList = configData.staff;
                    shiftSettings = configData.shifts;
                } else {
                    throw new Error(configData.message);
                }
            });
    }

    promiseChain.then(() => postToGAS({ action: 'getShifts', year: currentYear, month: currentMonth }))
    .then(shiftRes => {
        if (shiftRes.status === 'success') {
            shiftData = shiftRes.data;
            renderToolbar();
            renderTable();
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
            refreshView(true);
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
    refreshView(false);
}

// ==========================================
// PDF関連制御（縦向き・1枚対応版）
// ==========================================
function openPDFModal() {
    const listContainer = document.getElementById('pdf-staff-list');
    listContainer.innerHTML = "";
    
    // 全選択チェックボックス
    let allDiv = document.createElement('div');
    allDiv.className = 'pdf-staff-item';
    allDiv.innerHTML = `<input type="checkbox" id="pdf-check-all" onchange="toggleAllPDFChecks(this)" checked><label for="pdf-check-all">全て選択</label>`;
    listContainer.appendChild(allDiv);

    // スタッフ一覧
    staffList.forEach((staff, idx) => {
        let div = document.createElement('div');
        div.className = 'pdf-staff-item';
        div.innerHTML = `<input type="checkbox" class="pdf-staff-check" id="pdf-check-${idx}" value="${staff}" checked><label for="pdf-check-${idx}">${staff}</label>`;
        listContainer.appendChild(div);
    });

    document.getElementById('pdf-modal-overlay').style.display = 'flex';
}

function closePDFModal() {
    document.getElementById('pdf-modal-overlay').style.display = 'none';
}

function toggleAllPDFChecks(source) {
    const checkboxes = document.querySelectorAll('.pdf-staff-check');
    checkboxes.forEach(cb => cb.checked = source.checked);
}

function generatePDF() {
    closePDFModal();
    showLoading(true);

    // 1. 選択されたスタッフを取得
    const checkboxes = document.querySelectorAll('.pdf-staff-check');
    const selectedStaff = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

    if (selectedStaff.length === 0) {
        showLoading(false);
        showAlert('error', 'エラー', '出力するスタッフを選択してください');
        return;
    }

    // 2. PDF生成用の一時コンテナを作成
    const originalTable = document.getElementById('shift-table');
    
    // 描画用のコンテナ（画面外、白背景、固定幅なしで自動拡張）
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.zIndex = '-9999'; 
    container.style.background = 'white';
    container.style.padding = '20px';
    container.style.width = 'max-content'; // コンテンツに合わせて幅を最大化
    
    // タイトル
    const title = document.createElement('h2');
    title.innerText = `${currentYear}年 ${currentMonth}月 シフト表`;
    title.style.textAlign = 'center';
    title.style.marginBottom = '20px';
    title.style.fontFamily = 'sans-serif';
    container.appendChild(title);

    // テーブルのクローン
    const cloneTable = originalTable.cloneNode(true);
    cloneTable.style.width = 'auto'; // 横に伸びることを許可
    cloneTable.style.borderCollapse = 'collapse';

    // 3. データ整理とスタイル固定（見た目を確定させる）
    
    // ヘッダー（日付行）のスタイル適用
    const origThs = originalTable.querySelectorAll('thead th');
    const cloneThs = cloneTable.querySelectorAll('thead th');
    origThs.forEach((th, i) => {
        if(cloneThs[i]) {
            cloneThs[i].style.backgroundColor = getComputedStyle(th).backgroundColor;
            cloneThs[i].style.color = getComputedStyle(th).color;
            cloneThs[i].style.border = "1px solid #999"; // 印刷用に少し濃く
            cloneThs[i].style.fontSize = "16px";
            cloneThs[i].style.padding = "4px";
        }
    });

    // ボディ（スタッフ行）の再構築
    const origRows = originalTable.querySelectorAll('tbody tr');
    const cloneBody = cloneTable.querySelector('tbody');
    cloneBody.innerHTML = ""; // 一旦クリア

    origRows.forEach((row) => {
        const staffNameTh = row.querySelector('th');
        const staffName = staffNameTh.innerText;

        // 選択されたスタッフのみ追加
        if (selectedStaff.includes(staffName)) {
            const newRow = document.createElement('tr');
            const cells = row.children;
            
            Array.from(cells).forEach(cell => {
                const newCell = cell.cloneNode(true);
                
                // 元のセルのスタイルをコピー
                const computedStyle = getComputedStyle(cell);
                newCell.style.backgroundColor = computedStyle.backgroundColor;
                newCell.style.color = computedStyle.color;
                newCell.style.fontWeight = computedStyle.fontWeight;
                
                // PDF用の微調整（文字は小さくてもOK、枠線をはっきり）
                newCell.style.fontSize = "16px"; 
                newCell.style.border = "1px solid #999";
                newCell.style.height = "35px"; 
                newCell.style.minWidth = "35px"; 
                newCell.style.textAlign = "center";
                
                // スタッフ名のセル調整
                if(newCell.tagName === 'TH') {
                    newCell.style.fontWeight = "bold";
                    newCell.style.textAlign = "left";
                    newCell.style.paddingLeft = "8px";
                    newCell.style.backgroundColor = "#fff";
                    newCell.style.whiteSpace = "nowrap"; // 名前での折り返し防止
                }

                newRow.appendChild(newCell);
            });
            cloneBody.appendChild(newRow);
        }
    });

    container.appendChild(cloneTable);
    document.body.appendChild(container);

    // 4. 画像化 -> PDF化 (縦向き1枚に収めるロジック)
    // scale: 4 で超高解像度化（縮小しても文字が潰れないように）
    html2canvas(container, { scale: 4, useCORS: true }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        
        // A4 縦向き (portrait)
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        
        const pageWidth = doc.internal.pageSize.getWidth();   // 210mm
        const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
        const margin = 10; // 余白 10mm
        
        const usableWidth = pageWidth - (margin * 2);
        const usableHeight = pageHeight - (margin * 2);

        const imgProps = doc.getImageProperties(imgData);
        
        // 画像の本来のアスペクト比
        const imgRatio = imgProps.width / imgProps.height;
        
        // 用紙の枠に収めるための幅と高さを計算
        // 1. 幅を用紙幅いっぱいにした場合の高さ
        let finalImgWidth = usableWidth;
        let finalImgHeight = usableWidth / imgRatio;

        // 2. もし高さが用紙からはみ出るなら、高さに合わせて幅を縮める（1枚に収めるため）
        if (finalImgHeight > usableHeight) {
            finalImgHeight = usableHeight;
            finalImgWidth = usableHeight * imgRatio;
        }

        // 画像の中央配置用オフセット計算
        const xOffset = margin + (usableWidth - finalImgWidth) / 2;
        const yOffset = margin; // 上詰め

        doc.addImage(imgData, 'PNG', xOffset, yOffset, finalImgWidth, finalImgHeight);
        doc.save(`shift_${currentYear}_${currentMonth}.pdf`);
        
        // 後始末
        document.body.removeChild(container);
        showLoading(false);
        showAlert('success', '完了', 'PDFを保存しました');
    }).catch(err => {
        if(document.body.contains(container)) document.body.removeChild(container);
        showLoading(false);
        showAlert('error', 'エラー', err.toString());
    });
}

// ==========================================
// モーダル・保存関連
// ==========================================
function openHelpModal() { document.getElementById('help-modal-overlay').style.display = 'flex'; }
function closeHelpModal() { document.getElementById('help-modal-overlay').style.display = 'none'; }

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

// スタッフ編集
function openStaffModal() { document.getElementById('staff-modal-overlay').style.display = 'flex'; document.getElementById('new-staff-name').value = ""; }
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
// 描画・操作系 (スマホ操作最適化)
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
        thDate.innerText = `${day}`;
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
            
            // タッチ操作（修正版：2本指と1本指を厳密に区別）
            td.addEventListener('touchstart', handleTouchStart, {passive: false});
            td.addEventListener('touchmove', handleTouchMove, {passive: false}); 
            td.addEventListener('touchend', handleTouchEnd);
            
            // マウス操作
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

// 共通機能（タッチ制御 修正版）
function handleTouchStart(e) {
    // 2本指以上（ズーム・スクロール）の場合は、ドラッグモードを即座にOFFにする
    if (e.touches.length > 1) {
        isDragging = false;
        return;
    }

    // 1本指の場合のみドラッグ開始
    isDragging = true;
    let td = e.target.closest('td');
    if(td) toggleSelection(td);
}

function handleTouchMove(e) {
    // 2本指以上の場合、何もしない（ブラウザ標準のスクロール/ズーム動作に任せる）
    if (e.touches.length > 1) {
        isDragging = false; 
        return; 
    }

    // 1本指の場合のみ処理
    if (isDragging) {
        // スクロールを止めて、なぞり選択を優先する
        if (e.cancelable) e.preventDefault(); 
        
        let touch = e.touches[0];
        let target = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // ターゲットがセルであれば選択に追加
        if(target && target.tagName === 'TD' && target.id.startsWith('cell_')) {
            addSelection(target);
        }
    }
}

function handleTouchEnd(e) { isDragging = false; }
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