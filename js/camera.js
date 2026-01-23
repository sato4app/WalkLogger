// WalkLogger - カメラ・写真関連

import { PHOTO_WIDTH, PHOTO_HEIGHT, PHOTO_QUALITY } from './config.js';
import * as state from './state.js';
import { savePhoto } from './db.js';
import { addPhotoMarkerToMap } from './map.js';
import { updateStatus, updateDataSizeIfOpen, showPhotoFromMarker } from './ui.js';

/**
 * 矢印スタンプを画像に描画
 * @param {string} base64Image - Base64画像データ
 * @param {string} direction - 方向（left/up/right）
 * @returns {Promise<string>} スタンプ済み画像のBase64
 */
export async function drawArrowStamp(base64Image, direction) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(img, 0, 0);

            // 矢印スタンプを描画
            const arrowSize = Math.min(img.width, img.height) * 0.15;
            const centerX = img.width / 2;
            const bottomY = img.height - arrowSize * 1.5;

            // 白背景の円
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(centerX, bottomY, arrowSize * 0.7, 0, Math.PI * 2);
            ctx.fill();

            // 縁取り
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 矢印を描画
            ctx.save();
            ctx.translate(centerX, bottomY);

            if (direction === 'left') {
                ctx.rotate(Math.PI / 4);
            } else if (direction === 'right') {
                ctx.rotate(-Math.PI / 4);
            }

            const arrowWidth = arrowSize * 0.5;
            const arrowHeight = arrowSize * 0.6;

            ctx.strokeStyle = '#333';
            ctx.lineWidth = arrowSize * 0.12;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.moveTo(0, arrowHeight / 2);
            ctx.lineTo(0, -arrowHeight / 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-arrowWidth / 2, -arrowHeight / 4);
            ctx.lineTo(0, -arrowHeight / 2);
            ctx.lineTo(arrowWidth / 2, -arrowHeight / 4);
            ctx.stroke();

            ctx.restore();

            const stampedImage = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
            resolve(stampedImage);
        };

        img.onerror = (error) => {
            console.error('画像読み込みエラー:', error);
            reject(error);
        };

        img.src = base64Image;
    });
}

/**
 * カメラを起動して写真撮影ダイアログを表示
 */
export async function takePhoto() {
    if (!state.db) {
        alert('データベースが初期化されていません');
        return;
    }

    try {
        updateStatus('カメラ起動中...');

        const cameraDialog = document.getElementById('cameraDialog');
        const cameraPreview = document.getElementById('cameraPreview');
        const capturedCanvas = document.getElementById('capturedCanvas');
        const captureButtons = document.getElementById('captureButtons');
        const directionButtons = document.getElementById('directionButtons');

        cameraDialog.style.display = 'block';
        cameraPreview.style.display = 'block';
        capturedCanvas.style.display = 'none';
        captureButtons.style.display = 'flex';
        directionButtons.style.display = 'none';

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        state.setCameraStream(stream);
        cameraPreview.srcObject = stream;

        updateStatus('カメラ準備完了');
    } catch (error) {
        console.error('カメラエラー:', error);

        if (error.name === 'NotAllowedError') {
            alert('カメラの使用が許可されていません');
        } else if (error.name === 'NotFoundError') {
            alert('カメラが見つかりません');
        } else {
            alert('カメラの起動に失敗しました: ' + error.message);
        }

        updateStatus('カメラ起動失敗');
    }
}

/**
 * カメラダイアログを閉じる
 */
export function closeCameraDialog() {
    const cameraDialog = document.getElementById('cameraDialog');
    cameraDialog.style.display = 'none';

    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.setCameraStream(null);
    }

    updateStatus(state.isTracking ? `GPS追跡中 (${state.trackingData.length}点記録)` : 'GPS待機中...');
}

/**
 * 写真を撮影（シャッターボタン）
 */
export function capturePhoto() {
    const cameraPreview = document.getElementById('cameraPreview');
    const capturedCanvas = document.getElementById('capturedCanvas');
    const captureButtons = document.getElementById('captureButtons');
    const directionButtons = document.getElementById('directionButtons');

    const srcWidth = cameraPreview.videoWidth;
    const srcHeight = cameraPreview.videoHeight;

    // アスペクト比を維持しながらリサイズ
    const srcAspect = srcWidth / srcHeight;
    const targetAspect = PHOTO_WIDTH / PHOTO_HEIGHT;

    let cropX = 0, cropY = 0, cropWidth = srcWidth, cropHeight = srcHeight;

    if (srcAspect > targetAspect) {
        cropWidth = srcHeight * targetAspect;
        cropX = (srcWidth - cropWidth) / 2;
    } else {
        cropHeight = srcWidth / targetAspect;
        cropY = (srcHeight - cropHeight) / 2;
    }

    capturedCanvas.width = PHOTO_WIDTH;
    capturedCanvas.height = PHOTO_HEIGHT;
    const ctx = capturedCanvas.getContext('2d');
    ctx.drawImage(cameraPreview, cropX, cropY, cropWidth, cropHeight, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);

    state.setCapturedPhotoData(capturedCanvas.toDataURL('image/jpeg', PHOTO_QUALITY));
    console.log(`写真撮影: ${PHOTO_WIDTH}x${PHOTO_HEIGHT}px にリサイズ（元: ${srcWidth}x${srcHeight}px）`);

    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.setCameraStream(null);
    }

    cameraPreview.style.display = 'none';
    capturedCanvas.style.display = 'block';
    captureButtons.style.display = 'none';
    directionButtons.style.display = 'flex';

    updateStatus('方向を選択してください');
}

/**
 * 方向を選択して写真を保存
 * @param {string} direction - 方向（left/up/right）
 */
export async function savePhotoWithDirection(direction) {
    if (!state.capturedPhotoData) {
        console.error('撮影データがありません');
        return;
    }

    try {
        const stampedPhotoData = await drawArrowStamp(state.capturedPhotoData, direction);
        console.log('矢印スタンプを画像に合成しました:', direction);

        const location = state.currentMarker ? state.currentMarker.getLatLng() : null;

        const photoRecord = {
            data: stampedPhotoData,
            timestamp: new Date().toISOString(),
            direction: direction,
            location: location ? {
                lat: parseFloat(location.lat.toFixed(5)),
                lng: parseFloat(location.lng.toFixed(5))
            } : null
        };

        const photoId = await savePhoto(photoRecord);
        console.log('写真を保存しました。ID:', photoId, '方向:', direction);
        state.setPhotosInSession(state.photosInSession + 1);

        if (location) {
            addPhotoMarkerToMap(photoRecord, showPhotoFromMarker);
        }

        closeCameraDialog();
        updateStatus(`写真を保存しました（方向: ${direction}）`);

        setTimeout(() => {
            if (state.isTracking) {
                updateStatus(`GPS追跡中 (${state.trackingData.length}点記録)`);
            } else {
                updateStatus('GPS待機中...');
            }
        }, 2000);

        updateDataSizeIfOpen();

    } catch (error) {
        console.error('写真保存エラー:', error);
        alert('写真の保存に失敗しました: ' + error.message);
    }

    state.setCapturedPhotoData(null);
}
