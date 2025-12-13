// WalkLogger - GPS位置記録アプリ

// グローバル変数
let map;
let currentMarker;
let trackingPath;
let watchId = null;
let isTracking = false;
let trackingData = [];
let currentPhotoData = null;

// 緑の三角形マーカーアイコンを作成
const triangleIcon = L.divIcon({
    className: 'triangle-marker',
    html: '<div class="triangle"></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

// 地図の初期化
function initMap() {
    // 地図を作成（初期位置: 東京）
    map = L.map('map').setView([35.6812, 139.7671], 13);

    // 国土地理院タイルレイヤーを追加
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
        maxZoom: 18,
        minZoom: 5
    }).addTo(map);

    // トラッキングパス（軌跡）用のポリライン
    trackingPath = L.polyline([], {
        color: '#2196F3',
        weight: 4,
        opacity: 0.7
    }).addTo(map);

    updateStatus('地図を初期化しました');
}

// GPS位置の更新
function updatePosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    // マーカーを更新または作成
    if (currentMarker) {
        currentMarker.setLatLng([lat, lng]);
    } else {
        currentMarker = L.marker([lat, lng], { icon: triangleIcon }).addTo(map);
        map.setView([lat, lng], 15);
    }

    // 座標表示を更新
    updateCoordinates(lat, lng, accuracy);

    // トラッキング中の場合、軌跡を記録
    if (isTracking) {
        trackingData.push({
            lat: lat,
            lng: lng,
            timestamp: new Date().toISOString(),
            accuracy: accuracy
        });

        // 軌跡を描画
        const latlngs = trackingData.map(point => [point.lat, point.lng]);
        trackingPath.setLatLngs(latlngs);

        updateStatus(`GPS追跡中 (${trackingData.length}点記録)`);
    }
}

// GPSエラー処理
function handlePositionError(error) {
    let message = 'GPS取得エラー: ';
    switch (error.code) {
        case error.PERMISSION_DENIED:
            message += '位置情報の使用が許可されていません';
            break;
        case error.POSITION_UNAVAILABLE:
            message += '位置情報が利用できません';
            break;
        case error.TIMEOUT:
            message += '位置情報の取得がタイムアウトしました';
            break;
        default:
            message += '不明なエラーが発生しました';
    }
    updateStatus(message);
    console.error('GPS Error:', error);
}

// GPS追跡を開始
function startTracking() {
    if (!navigator.geolocation) {
        alert('このブラウザは位置情報に対応していません');
        return;
    }

    if (isTracking) {
        return;
    }

    isTracking = true;
    trackingData = [];

    // GPS監視を開始
    watchId = navigator.geolocation.watchPosition(
        updatePosition,
        handlePositionError,
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );

    // UIを更新
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    updateStatus('GPS追跡を開始しました');
}

// GPS追跡を停止
function stopTracking() {
    if (!isTracking) {
        return;
    }

    isTracking = false;

    // GPS監視を停止
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    // UIを更新
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;

    // トラッキングデータを保存
    if (trackingData.length > 0) {
        saveTrackingData();
        updateStatus(`GPS追跡を停止しました (${trackingData.length}点記録)`);
    } else {
        updateStatus('GPS追跡を停止しました');
    }
}

// トラッキングデータをローカルストレージに保存
function saveTrackingData() {
    const trackKey = `track_${new Date().getTime()}`;
    const trackData = {
        timestamp: new Date().toISOString(),
        points: trackingData,
        totalPoints: trackingData.length
    };

    try {
        localStorage.setItem(trackKey, JSON.stringify(trackData));
        console.log('トラッキングデータを保存しました:', trackKey);
    } catch (e) {
        console.error('データ保存エラー:', e);
    }
}

// 写真撮影
function takePhoto() {
    const cameraInput = document.getElementById('cameraInput');
    cameraInput.click();
}

// 写真が選択された時の処理
function handlePhotoSelected(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        currentPhotoData = {
            data: e.target.result,
            timestamp: new Date().toISOString(),
            location: currentMarker ? currentMarker.getLatLng() : null
        };

        // プレビューを表示
        document.getElementById('photoPreview').src = e.target.result;
        document.getElementById('photoModal').style.display = 'flex';
    };

    reader.readAsDataURL(file);
}

// 写真を保存
function savePhoto() {
    if (!currentPhotoData) {
        return;
    }

    const photoKey = `photo_${new Date().getTime()}`;
    try {
        localStorage.setItem(photoKey, JSON.stringify(currentPhotoData));
        alert('写真を保存しました');
        closePhotoModal();
    } catch (e) {
        console.error('写真保存エラー:', e);
        alert('写真の保存に失敗しました。容量が不足している可能性があります。');
    }
}

// 写真モーダルを閉じる
function closePhotoModal() {
    document.getElementById('photoModal').style.display = 'none';
    currentPhotoData = null;
    document.getElementById('cameraInput').value = '';
}

// ステータス表示を更新
function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
}

// 座標表示を更新
function updateCoordinates(lat, lng, accuracy) {
    const coordsDiv = document.getElementById('coordinates');
    coordsDiv.innerHTML = `
        緯度: ${lat.toFixed(6)}<br>
        経度: ${lng.toFixed(6)}<br>
        精度: ±${accuracy.toFixed(1)}m
    `;
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', function() {
    // 地図を初期化
    initMap();

    // ボタンイベント
    document.getElementById('startBtn').addEventListener('click', startTracking);
    document.getElementById('stopBtn').addEventListener('click', stopTracking);
    document.getElementById('photoBtn').addEventListener('click', takePhoto);

    // 写真関連イベント
    document.getElementById('cameraInput').addEventListener('change', handlePhotoSelected);
    document.getElementById('savePhotoBtn').addEventListener('click', savePhoto);
    document.getElementById('cancelPhotoBtn').addEventListener('click', closePhotoModal);
    document.querySelector('.close').addEventListener('click', closePhotoModal);

    // モーダルの外側クリックで閉じる
    document.getElementById('photoModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closePhotoModal();
        }
    });

    // Service Workerの登録（PWA対応）
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(function(registration) {
                console.log('Service Worker登録成功:', registration.scope);
            })
            .catch(function(error) {
                console.log('Service Worker登録失敗:', error);
            });
    }
});
