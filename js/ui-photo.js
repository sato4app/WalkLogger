// WalkLogger - 写真関連UI

import * as state from './state.js';
import { getAllPhotos } from './db.js';
import { toggleVisibility, updateStatus } from './ui-common.js';

let currentPhotoList = [];
let currentPhotoIndex = -1;

/**
 * マーカークリックから写真を表示
 * @param {Object} photo - 写真データ
 */
export async function showPhotoFromMarker(photo) {
    try {
        // ナビゲーションを有効にするために全写真リストを取得
        const allPhotos = await getAllPhotos();

        let index = -1;
        if (allPhotos.length > 0) {
            // タイムスタンプで一致する写真を探す
            index = allPhotos.findIndex(p => p.timestamp === photo.timestamp);
        }

        if (index !== -1) {
            showPhotoViewer(photo, allPhotos, index);
        } else {
            console.warn('マーカーの画像がデータベース内で見つかりませんでした。単一表示します。');
            showPhotoViewer(photo, [photo], 0);
        }
    } catch (error) {
        console.error('showPhotoFromMarkerエラー:', error);
        // エラー時は単一表示へフォールバック
        showPhotoViewer(photo, [photo], 0);
    }
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

        // Update header with count
        const headerTitle = document.querySelector('#photoListContainer h2');
        if (headerTitle) {
            headerTitle.innerHTML = `Photo Gallery<br>(${photos.length} photos)`;
        }

        if (photos.length === 0) {
            photoGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">保存された写真がありません</p>';
        } else {
            photos.forEach((photo, index) => {
                const item = document.createElement('div');
                item.className = 'photo-item';

                const img = document.createElement('img');
                img.src = photo.data;
                img.alt = '写真';

                item.appendChild(img);
                item.addEventListener('click', () => showPhotoViewer(photo, photos, index));
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
        const totalPoints = state.previousTotalPoints + state.trackingData.length;
        updateStatus(`GPS追跡中 (${totalPoints}点記録)`);
    }
}

/**
 * 写真を拡大表示
 * @param {Object} photo - 写真データ
 * @param {Array} allPhotos - 全写真リスト (Optional)
 * @param {number} index - 写真のインデックス (Optional)
 */
export function showPhotoViewer(photo, allPhotos = [], index = -1) {
    if (allPhotos.length > 0) {
        currentPhotoList = allPhotos;
        currentPhotoIndex = index;
    } else {
        currentPhotoList = [photo];
        currentPhotoIndex = 0;
    }

    updatePhotoViewerUI(photo, currentPhotoIndex, currentPhotoList.length);
    toggleVisibility('photoViewer', true);
}

/**
 * 写真ビューアのUIを更新
 * @param {Object} photo 
 * @param {number} index 
 * @param {number} total 
 */
function updatePhotoViewerUI(photo, index, total) {
    const viewerImage = document.getElementById('viewerImage');
    const photoInfo = document.getElementById('photoInfo');
    const counter = document.getElementById('photoCounter');
    const prevBtn = document.getElementById('prevPhotoBtn');
    const nextBtn = document.getElementById('nextPhotoBtn');

    if (!photo) return;

    viewerImage.src = photo.data;

    let infoHTML = `撮影日時: ${new Date(photo.timestamp).toLocaleString('ja-JP')}`;
    if (photo.location) {
        infoHTML += `<br>緯度: ${photo.location.lat.toFixed(5)}<br>経度: ${photo.location.lng.toFixed(5)}`;
    } else {
        infoHTML += '<br>位置情報なし';
    }

    if (photo.text) {
        infoHTML += `<br><br><span style="white-space: pre-wrap;">${photo.text}</span>`;
    }

    photoInfo.innerHTML = infoHTML;

    // Update counter
    if (total > 1) {
        counter.textContent = `${index + 1} of ${total}`;
        counter.style.display = 'block';
    } else {
        counter.style.display = 'none';
    }

    // Update buttons
    if (total > 1) {
        if (prevBtn) prevBtn.style.display = index > 0 ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = index < total - 1 ? 'flex' : 'none';
    } else {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    }
}

/**
 * 写真ビューアを閉じる
 */
export function closePhotoViewer() {
    toggleVisibility('photoViewer', false);
    if (state.isTracking) {
        const totalPoints = state.previousTotalPoints + state.trackingData.length;
        updateStatus(`GPS追跡中 (${totalPoints}点記録)`);
    }
}

/**
 * Photo Viewerのナビゲーション初期化
 */
export function initPhotoViewerControls() {
    const prevBtn = document.getElementById('prevPhotoBtn');
    const nextBtn = document.getElementById('nextPhotoBtn');

    if (prevBtn) {
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (currentPhotoIndex > 0) {
                currentPhotoIndex--;
                updatePhotoViewerUI(currentPhotoList[currentPhotoIndex], currentPhotoIndex, currentPhotoList.length);
            }
        };
    }

    if (nextBtn) {
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (currentPhotoIndex < currentPhotoList.length - 1) {
                currentPhotoIndex++;
                updatePhotoViewerUI(currentPhotoList[currentPhotoIndex], currentPhotoIndex, currentPhotoList.length);
            }
        };
    }
}
