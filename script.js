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
                input.blur(); 
            }
        });
    });
    
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
// PDF関連制御（強制縮小版）
// ==========================================
function openPDFModal() {
    const listContainer = document.getElementById('pdf-staff-list');
    listContainer.innerHTML = "";
    
    let allDiv = document.createElement('div');
    allDiv.className = 'pdf-staff-item';
    allDiv.innerHTML = `<input type="checkbox" id="pdf-check-all" onchange="toggleAllPDFChecks(this)" checked><label for="pdf-check-all">全て選択</label>`;
    listContainer.appendChild(allDiv);

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

    const checkboxes = document.querySelectorAll('.pdf-staff-check');
    const selectedStaff = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

    if (selectedStaff.length === 0) {
        showLoading(false);
        showAlert('error', 'エラー', '出力するスタッフを選択してください');
        return;
    }

    const originalTable = document.getElementById('shift-table');
    
    // PDF生成用コンテナ（画面外に配置）
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    // ユーザーからは見えないが、描画エンジンからは見えるようにz-indexを調整
    container.style.zIndex = '-9999'; 
    container.style.background = 'white';
    container.style.padding = '20px';
    // 横幅を固定せず、内容に合わせて自然に広げる
    container.style.width = 'auto';
    container.style.minWidth = '1200px'; // 最低幅を確保して折り返しを防ぐ

    const title = document.createElement('h2');
    title.innerText = `${currentYear}年 ${currentMonth}月 シフト表`;
    title.style.textAlign = 'center';
    title.style.marginBottom = '20px';
    container.appendChild(title);

    const cloneTable = originalTable.cloneNode(true);
    // スタイルをリセットして全展開させる
    cloneTable.style.width = '100%'; 
    cloneTable.style.borderCollapse = 'collapse';
    cloneTable.style.tableLayout = 'auto';

    // 色と文字を確実に反映させる処理
    const origThs = originalTable.querySelectorAll('thead th');
    const cloneThs = cloneTable.querySelectorAll('thead th');
    origThs.forEach((th, i) => {
        if(cloneThs[i]) {
            cloneThs[i].style.backgroundColor = getComputedStyle(th).backgroundColor;
            cloneThs[i].style.color = getComputedStyle(th).color;
            cloneThs[i].style.border = "1px solid #888"; 
            cloneThs[i].style.fontSize = "14px";
            cloneThs[i].style.padding = "2px";
        }
    });

    const origRows = originalTable.querySelectorAll('tbody tr');
    const cloneBody = cloneTable.querySelector('tbody');
    cloneBody.innerHTML = ""; 

    origRows.forEach((row) => {
        const staffNameTh = row.querySelector('th');
        const staffName = staffNameTh.innerText;

        if (selectedStaff.includes(staffName)) {
            const newRow = document.createElement('tr');
            const cells = row.children;
            
            Array.from(cells).forEach(cell => {
                const newCell = cell.cloneNode(true);
                const computedStyle = getComputedStyle(cell);
                
                newCell.style.backgroundColor = computedStyle.backgroundColor;
                newCell.style.color = computedStyle.color;
                newCell.style.fontWeight = computedStyle.fontWeight;
                newCell.style.fontSize = "14px"; 
                newCell.style.border = "1px solid #888";
                newCell.style.height = "30px"; 
                newCell.style.minWidth = "30px"; 
                newCell.style.textAlign = "center";
                newCell.style.verticalAlign = "middle"; // 文字を上下中央に

                if(newCell.tagName === 'TH') {
                    newCell.style.fontWeight = "bold";
                    newCell.style.textAlign = "left";
                    newCell.style.whiteSpace = "nowrap"; 
                    newCell.style.backgroundColor = "#fff";
                }

                newRow.appendChild(newCell);
            });
            cloneBody.appendChild(newRow);
        }
    });

    container.appendChild(cloneTable);
    document.body.appendChild(container);

    // 画像化とPDF化
    // scaleを上げて高画質化することで、縮小時の文字潰れを防ぐ
    html2canvas(container, { scale: 3, useCORS: true }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        
        // A4 縦向き (Portrait)
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        
        const pdfWidth = doc.internal.pageSize.getWidth();   // 210mm
        const pdfHeight = doc.internal.pageSize.getHeight(); // 297mm
        const margin = 5; // 余白5mm
        
        // 描画可能エリア
        const printWidth = pdfWidth - (margin * 2);
        const printHeight = pdfHeight - (margin * 2);

        const imgProps = doc.getImageProperties(imgData);
        
        // ★重要: ここで「横幅」を基準に縮小率を決める
        // 画像の「縦横比」を計算
        const imgRatio = imgProps.height / imgProps.width;
        
        // PDFに貼り付ける幅を「用紙の最大幅」に設定
        const finalWidth = printWidth;
        // それに合わせた高さを計算
        let finalHeight = printWidth * imgRatio;

        // 万が一、高さが用紙を超えてしまう場合（スタッフ数が極端に多い時など）
        // 1枚に収めるためにさらに縮小する
        if (finalHeight > printHeight) {
             const fitRatio = printHeight / finalHeight;
             finalWidth = finalWidth * fitRatio;
             finalHeight = printHeight;
        }

        // 画像配置 (左上座標: margin, margin)
        doc.addImage(imgData, 'PNG', margin, margin, finalWidth, finalHeight);
        doc.save(`shift_${currentYear}_${currentMonth}.pdf`);
        
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
            
            td.addEventListener('touchstart', handleTouchStart, {passive: false});
            td.addEventListener('touchmove', handleTouchMove, {passive: false}); 
            td.addEventListener('touchend', handleTouchEnd);
            
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

function handleTouchStart(e) {
    if (e.touches.length > 1) {
        isDragging = false;
        return;
    }
    isDragging = true;
    let td = e.target.closest('td');
    if(td) toggleSelection(td);
}

function handleTouchMove(e) {
    if (e.touches.length > 1) {
        isDragging = false; 
        return; 
    }
    if (isDragging) {
        if (e.cancelable) e.preventDefault(); 
        
        let touch = e.touches[0];
        let target = document.elementFromPoint(touch.clientX, touch.clientY);
        
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