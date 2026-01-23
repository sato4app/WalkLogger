// WalkLogger - UI/ダイアログ関連

import * as state from './state.js';
import { getAllTracks, getAllPhotos } from './db.js';
import { calculateTrackStats, formatDataSize } from './utils.js';

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
        const dialog = document.getElementById('docNameDialog');
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
            dialog.style.display = 'none';
        };

        dialog.style.display = 'flex';
        input.focus();
        input.select();
    });
}

/**
 * マーカークリックから写真を表示
 * @param {Object} photo - 写真データ
 */
export function showPhotoFromMarker(photo) {
    const viewer = document.getElementById('photoViewer');
    const img = document.getElementById('viewerImage');
    const info = document.getElementById('photoInfo');

    img.src = photo.data;

    const timestamp = new Date(photo.timestamp).toLocaleString('ja-JP');
    const location = photo.location
        ? `緯度: ${photo.location.lat.toFixed(5)}, 経度: ${photo.location.lng.toFixed(5)}`
        : '位置情報なし';
    const direction = photo.direction ? `方向: ${photo.direction}` : '';

    info.innerHTML = `撮影日時: ${timestamp}<br>${location}${direction ? '<br>' + direction : ''}`;
    viewer.style.display = 'flex';
}

/**
 * 写真一覧を表示
 */
export async function showPhotoList() {
    if (!state.db) {
        alert('データベースが初期化されていません');
        return;
    }

    const photoListContainer = document.getElementById('photoListContainer');
    const photoGrid = document.getElementById('photoGrid');
    photoGrid.innerHTML = '';

    try {
        const photos = await getAllPhotos();

        if (photos.length === 0) {
            photoGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">保存された写真がありません</p>';
        } else {
            photos.forEach(photo => {
                const thumbnail = document.createElement('div');
                thumbnail.className = 'photo-thumbnail';

                const img = document.createElement('img');
                img.src = photo.data;
                img.alt = '写真';

                const timestamp = document.createElement('div');
                timestamp.className = 'photo-timestamp';
                timestamp.textContent = new Date(photo.timestamp).toLocaleString('ja-JP');

                thumbnail.appendChild(img);
                thumbnail.appendChild(timestamp);

                thumbnail.addEventListener('click', () => showPhotoViewer(photo));
                photoGrid.appendChild(thumbnail);
            });
        }

        photoListContainer.style.display = 'block';
    } catch (error) {
        console.error('写真一覧表示エラー:', error);
        alert('写真一覧の表示に失敗しました');
    }
}

/**
 * 写真一覧を閉じる
 */
export function closePhotoList() {
    document.getElementById('photoListContainer').style.display = 'none';
    if (state.isTracking) {
        updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
    }
}

/**
 * 写真を拡大表示
 * @param {Object} photo - 写真データ
 */
export function showPhotoViewer(photo) {
    const viewer = document.getElementById('photoViewer');
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
    viewer.style.display = 'flex';
}

/**
 * 写真ビューアを閉じる
 */
export function closePhotoViewer() {
    document.getElementById('photoViewer').style.display = 'none';
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
        docItem.className = 'document-item';

        const docInfo = document.createElement('div');
        docInfo.className = 'document-info';

        const docName = document.createElement('div');
        docName.className = 'document-name';
        docName.textContent = doc.id;

        const docDetails = document.createElement('div');
        docDetails.className = 'document-details';
        const createdAt = doc.data.createdAt?.toDate();
        const dateStr = createdAt ? createdAt.toLocaleString('ja-JP') : '不明';
        const userId = doc.data.userId ? `UID: ${doc.data.userId.substring(0, 4)}...` : 'UID: 不明';
        docDetails.textContent = `作成日時: ${dateStr} | ${userId} | トラック: ${doc.data.tracksCount || 0}件 | 写真: ${doc.data.photosCount || 0}枚`;

        docInfo.appendChild(docName);
        docInfo.appendChild(docDetails);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'document-load-btn';
        loadBtn.textContent = '読み込み';
        loadBtn.onclick = () => onLoad(doc);

        docItem.appendChild(docInfo);
        docItem.appendChild(loadBtn);
        documentList.appendChild(docItem);
    });

    document.getElementById('documentListDialog').style.display = 'flex';
}

/**
 * ドキュメント選択ダイアログを閉じる
 */
export function closeDocumentListDialog() {
    document.getElementById('documentListDialog').style.display = 'none';
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
                    <span class="stat-value">${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">GPSデータサイズ:</span>
                    <span class="stat-value">${formatDataSize(gpsDataSizeBytes)}</span>
                </div>
            </div>
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">写真撮影枚数:</span>
                    <span class="stat-value">${allPhotos.length}枚</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真データサイズ:</span>
                    <span class="stat-value">${formatDataSize(photosTotalSize)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真解像度:</span>
                    <span class="stat-value">${photosResolution}</span>
                </div>
            </div>
        `;

        document.getElementById('statsBody').innerHTML = statsHTML;
        document.getElementById('statsDialog').style.display = 'flex';
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
    if (!statsDialog || statsDialog.style.display !== 'flex') return;

    try {
        const allTracks = await getAllTracks();
        const allPhotos = await getAllPhotos();
        const trackStats = calculateTrackStats(allTracks);

        let gpsDataSizeBytes = 0;
        allTracks.forEach(track => {
            gpsDataSizeBytes += new Blob([JSON.stringify(track)]).size;
        });

        let photosTotalSize = 0;
        allPhotos.forEach(photo => {
            photosTotalSize += new Blob([photo.data]).size;
        });

        const statsBody = document.getElementById('statsBody');
        const existingResolution = statsBody.querySelector('.stat-row:last-child .stat-value')?.textContent || '-';

        const statsHTML = `
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">トラック:</span>
                    <span class="stat-value">${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">GPSデータサイズ:</span>
                    <span class="stat-value">${formatDataSize(gpsDataSizeBytes)}</span>
                </div>
            </div>
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">写真撮影枚数:</span>
                    <span class="stat-value">${allPhotos.length}枚</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真データサイズ:</span>
                    <span class="stat-value">${formatDataSize(photosTotalSize)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真解像度:</span>
                    <span class="stat-value">${existingResolution}</span>
                </div>
            </div>
        `;

        statsBody.innerHTML = statsHTML;
    } catch (error) {
        console.error('データサイズ更新エラー:', error);
    }
}

/**
 * 統計ダイアログを閉じる
 */
export function closeStatsDialog() {
    document.getElementById('statsDialog').style.display = 'none';
    if (state.isTracking) {
        updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
    }
}
