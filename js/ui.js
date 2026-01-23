// WalkLogger - UI/ダイアログ関連

import * as state from './state.js';
import { getAllTracks, getAllPhotos } from './db.js';
import { calculateTrackStats, formatDataSize } from './utils.js';

/**
 * HTML要素の表示・非表示を切り替え
 * @param {string} elementId - 要素ID
 * @param {boolean} isVisible - 表示するかどうか
 */
function toggleVisibility(elementId, isVisible) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (isVisible) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

/**
 * ステータス表示を更新
 * @param {string} message - メッセージ
 */
export function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
}

/**
 * 座標表示を更新
 * @param {number} lat - 緯度
 * @param {number} lng - 経度
 * @param {number} accuracy - 精度
 */
export function updateCoordinates(lat, lng, accuracy) {
    const coordsDiv = document.getElementById('coordinates');
    coordsDiv.innerHTML = `
        緯度: ${lat.toFixed(5)}<br>
        経度: ${lng.toFixed(5)}<br>
        精度: ±${accuracy.toFixed(1)}m
    `;
}

/**
 * ドキュメント名入力ダイアログを表示
 * @param {string} defaultName - デフォルト名
 * @returns {Promise<string|null>}
 */
export function showDocNameDialog(defaultName) {
    return new Promise((resolve) => {
        const dialogId = 'docNameDialog';
        const input = document.getElementById('docNameInput');
        const okBtn = document.getElementById('docNameOkBtn');
        const cancelBtn = document.getElementById('docNameCancelBtn');

        input.value = defaultName;

        const handleOk = () => {
            const docName = input.value.trim();
            if (!docName) {
                alert('ドキュメント名を入力してください');
                return;
            }
            cleanup();
            resolve(docName);
        };

        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        const handleKeyPress = (e) => {
            if (e.key === 'Enter') handleOk();
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        input.addEventListener('keypress', handleKeyPress);

        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            input.removeEventListener('keypress', handleKeyPress);
            toggleVisibility(dialogId, false);
        };

        toggleVisibility(dialogId, true);
        input.focus();
        input.select();
    });
}

/**
 * マーカークリックから写真を表示
 * @param {Object} photo - 写真データ
 */
export function showPhotoFromMarker(photo) {
    const img = document.getElementById('viewerImage');
    const info = document.getElementById('photoInfo');

    img.src = photo.data;

    const timestamp = new Date(photo.timestamp).toLocaleString('ja-JP');
    const location = photo.location
        ? `緯度: ${photo.location.lat.toFixed(5)}, 経度: ${photo.location.lng.toFixed(5)}`
        : '位置情報なし';
    const direction = photo.direction ? `方向: ${photo.direction}` : '';

    info.innerHTML = `撮影日時: ${timestamp}<br>${location}${direction ? '<br>' + direction : ''}`;
    toggleVisibility('photoViewer', true);
}

/**
 * 写真一覧を表示
 */
export async function showPhotoList() {
    if (!state.db) {
        alert('データベースが初期化されていません');
        return;
    }

    const photoGrid = document.getElementById('photoGrid');
    photoGrid.innerHTML = '';

    try {
        const photos = await getAllPhotos();

        if (photos.length === 0) {
            photoGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">保存された写真がありません</p>';
        } else {
            photos.forEach(photo => {
                const item = document.createElement('div');
                item.className = 'photo-item';

                const img = document.createElement('img');
                img.src = photo.data;
                img.alt = '写真';

                item.appendChild(img);
                item.addEventListener('click', () => showPhotoViewer(photo));
                photoGrid.appendChild(item);
            });
        }

        toggleVisibility('photoListContainer', true);
    } catch (error) {
        console.error('写真一覧表示エラー:', error);
        alert('写真一覧の表示に失敗しました');
    }
}

/**
 * 写真一覧を閉じる
 */
export function closePhotoList() {
    toggleVisibility('photoListContainer', false);
    if (state.isTracking) {
        updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
    }
}

/**
 * 写真を拡大表示
 * @param {Object} photo - 写真データ
 */
export function showPhotoViewer(photo) {
    const viewerImage = document.getElementById('viewerImage');
    const photoInfo = document.getElementById('photoInfo');

    viewerImage.src = photo.data;

    let infoHTML = `撮影日時: ${new Date(photo.timestamp).toLocaleString('ja-JP')}`;
    if (photo.location) {
        infoHTML += `<br>緯度: ${photo.location.lat.toFixed(5)}<br>経度: ${photo.location.lng.toFixed(5)}`;
    } else {
        infoHTML += '<br>位置情報なし';
    }

    photoInfo.innerHTML = infoHTML;
    toggleVisibility('photoViewer', true);
}

/**
 * 写真ビューアを閉じる
 */
export function closePhotoViewer() {
    toggleVisibility('photoViewer', false);
    if (state.isTracking) {
        updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
    }
}

/**
 * ドキュメント選択ダイアログを表示
 * @param {Array} documents - ドキュメント配列
 * @param {Function} onLoad - 読み込み時のコールバック
 */
export function showDocumentListDialog(documents, onLoad) {
    const documentList = document.getElementById('documentList');
    documentList.innerHTML = '';

    documents.forEach(doc => {
        const docItem = document.createElement('div');
        docItem.className = 'doc-item';

        const title = document.createElement('div');
        title.className = 'doc-item-title';
        title.textContent = doc.id;

        const meta = document.createElement('div');
        meta.className = 'doc-item-meta';
        const createdAt = doc.data.createdAt?.toDate();
        const dateStr = createdAt ? createdAt.toLocaleString('ja-JP') : '不明';
        const userId = doc.data.userId ? `UID: ...${doc.data.userId.slice(-4)}` : 'UID: 不明';
        meta.textContent = `${dateStr} | ${userId}`;

        const stats = document.createElement('div');
        stats.className = 'doc-item-meta';
        stats.textContent = `トラック: ${doc.data.tracksCount || 0} | 写真: ${doc.data.photosCount || 0}`;

        docItem.appendChild(title);
        docItem.appendChild(meta);
        docItem.appendChild(stats);

        docItem.onclick = () => onLoad(doc);
        documentList.appendChild(docItem);
    });

    toggleVisibility('documentListDialog', true);
}

/**
 * ドキュメント選択ダイアログを閉じる
 */
export function closeDocumentListDialog() {
    toggleVisibility('documentListDialog', false);
    if (state.isTracking) {
        updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
    }
}

/**
 * データサイズ情報を表示
 */
export async function showDataSize() {
    try {
        updateStatus('データサイズを計算中...');

        const allTracks = await getAllTracks();
        const allPhotos = await getAllPhotos();
        const trackStats = calculateTrackStats(allTracks);

        // GPSデータサイズ
        let gpsDataSizeBytes = 0;
        allTracks.forEach(track => {
            gpsDataSizeBytes += new Blob([JSON.stringify(track)]).size;
        });

        // 写真データサイズと解像度
        let photosTotalSize = 0;
        let photosResolution = '-';

        if (allPhotos.length > 0) {
            allPhotos.forEach(photo => {
                photosTotalSize += new Blob([photo.data]).size;
            });

            const lastPhoto = allPhotos[allPhotos.length - 1];
            const img = new Image();
            await new Promise((resolve) => {
                img.onload = () => {
                    photosResolution = `${img.width} × ${img.height}`;
                    resolve();
                };
                img.onerror = resolve;
                img.src = lastPhoto.data;
            });
        }

        const statsHTML = `
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">トラック:</span>
                    <span class="stat-value">${trackStats.trackCount}件 (${trackStats.totalPoints}点)</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">GPSサイズ:</span>
                    <span class="stat-value">${formatDataSize(gpsDataSizeBytes)}</span>
                </div>
            </div>
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">写真:</span>
                    <span class="stat-value">${allPhotos.length}枚</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真サイズ:</span>
                    <span class="stat-value">${formatDataSize(photosTotalSize)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">解像度:</span>
                    <span class="stat-value">${photosResolution}</span>
                </div>
            </div>
        `;

        document.getElementById('statsBody').innerHTML = statsHTML;
        toggleVisibility('statsDialog', true);
        updateStatus('データサイズ表示完了');
    } catch (error) {
        console.error('データサイズ取得エラー:', error);
        alert('データサイズの取得に失敗しました: ' + error.message);
        updateStatus('データサイズ取得エラー');
    }
}

/**
 * Sizeダイアログが開いている場合はデータサイズを更新
 */
export async function updateDataSizeIfOpen() {
    const statsDialog = document.getElementById('statsDialog');
    if (!statsDialog || statsDialog.classList.contains('hidden')) return;

    // showDataSizeを再利用（簡略化のため）
    await showDataSize();
}

/**
 * 統計ダイアログを閉じる
 */
export function closeStatsDialog() {
    toggleVisibility('statsDialog', false);
    if (state.isTracking) {
        updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
    }
}

/**
 * 既存データ確認ダイアログを表示
 * @param {string} message - メッセージ
 * @param {boolean} hasData - 既存データがあるかどうか
 * @returns {Promise<string>} 'init', 'append', 'cancel'
 */
export function showClearDataDialog(message, hasData) {
    return new Promise((resolve) => {
        const dialogId = 'clearDataDialog';
        const body = document.getElementById('clearDataBody');
        const initBtn = document.getElementById('clearDataInitBtn');
        const appendBtn = document.getElementById('clearDataAppendBtn');
        const title = document.querySelector('#clearDataDialog h2');

        body.innerText = message;

        if (hasData) {
            title.textContent = 'Existing Data Found';
            initBtn.textContent = 'Start New (Clear Data)';
            initBtn.classList.add('danger-btn');
            appendBtn.textContent = 'Continue (Append)';
            appendBtn.style.display = 'block';
        } else {
            title.textContent = 'Start Recording';
            initBtn.textContent = 'Start';
            initBtn.classList.remove('danger-btn');
            appendBtn.textContent = 'Cancel';
            appendBtn.style.display = 'block';
        }

        const handleInit = () => {
            cleanup();
            resolve('init');
        };

        const handleAppend = () => {
            cleanup();
            if (hasData) {
                resolve('append');
            } else {
                resolve('cancel');
            }
        };

        initBtn.onclick = handleInit;
        appendBtn.onclick = handleAppend;

        const cleanup = () => {
            initBtn.onclick = null;
            appendBtn.onclick = null;
            toggleVisibility(dialogId, false);
        };

        toggleVisibility(dialogId, true);
    });
}
