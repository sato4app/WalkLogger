// WalkLogger - GPS位置記録アプリ

// グローバル変数
let map;
let currentMarker;
let trackingPath;
let watchId = null;
let isTracking = false;
let trackingData = [];
let currentPhotoData = null;
let trackingStartTime = null; // Start時の日時

// IndexedDB関連
let db = null;
const DB_NAME = 'WalkLoggerDB';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const STORE_PHOTOS = 'photos';
const STORE_SETTINGS = 'settings';

// デフォルト位置（箕面大滝）
const DEFAULT_POSITION = {
    lat: 34.853667,
    lng: 135.472041,
    zoom: 13
};

// 緑の三角形マーカーアイコンを作成
const triangleIcon = L.divIcon({
    className: 'triangle-marker',
    html: '<div class="triangle"></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

// IndexedDBの初期化
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB接続エラー:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('IndexedDB接続成功');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            console.log('IndexedDBをアップグレード中...');

            // tracksオブジェクトストアの作成
            if (!db.objectStoreNames.contains(STORE_TRACKS)) {
                const trackStore = db.createObjectStore(STORE_TRACKS, { keyPath: 'id', autoIncrement: true });
                trackStore.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('tracksストアを作成しました');
            }

            // photosオブジェクトストアの作成
            if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
                const photoStore = db.createObjectStore(STORE_PHOTOS, { keyPath: 'id', autoIncrement: true });
                photoStore.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('photosストアを作成しました');
            }

            // settingsオブジェクトストアの作成
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
                const settingsStore = db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
                console.log('settingsストアを作成しました');
            }
        };
    });
}

// 現在位置を保存
async function saveLastPosition(lat, lng, zoom) {
    if (!db) {
        return;
    }

    try {
        const transaction = db.transaction([STORE_SETTINGS], 'readwrite');
        const store = transaction.objectStore(STORE_SETTINGS);
        const positionData = {
            key: 'lastPosition',
            lat: parseFloat(lat.toFixed(5)),
            lng: parseFloat(lng.toFixed(5)),
            zoom: zoom,
            timestamp: new Date().toISOString()
        };
        await store.put(positionData);
        console.log('最終位置を保存しました:', lat.toFixed(5), lng.toFixed(5));
    } catch (error) {
        console.error('位置保存エラー:', error);
    }
}

// 最後の位置を取得
function getLastPosition() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('データベースが初期化されていません'));
            return;
        }

        try {
            const transaction = db.transaction([STORE_SETTINGS], 'readonly');
            const store = transaction.objectStore(STORE_SETTINGS);
            const request = store.get('lastPosition');

            request.onsuccess = () => {
                if (request.result) {
                    console.log('最終位置を取得しました:', request.result);
                    resolve(request.result);
                } else {
                    console.log('保存された位置がありません。デフォルト位置を使用します');
                    resolve(null);
                }
            };

            request.onerror = () => {
                console.error('位置取得エラー:', request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error('位置取得エラー:', error);
            reject(error);
        }
    });
}

// データ精度を調整する関数
function formatPositionData(data) {
    if (!data) return null;

    const formatted = { ...data };

    // 緯度・経度を小数点以下5位に
    if (formatted.lat !== undefined) {
        formatted.lat = parseFloat(formatted.lat.toFixed(5));
    }
    if (formatted.lng !== undefined) {
        formatted.lng = parseFloat(formatted.lng.toFixed(5));
    }

    // 精度を小数点以下1位に
    if (formatted.accuracy !== undefined) {
        formatted.accuracy = parseFloat(formatted.accuracy.toFixed(1));
    }

    return formatted;
}

// IndexedDBのデータをFirebaseに保存
async function saveToFirebase() {
    if (!trackingStartTime) {
        alert('追跡データがありません。先にGPS追跡を開始してください。');
        return;
    }

    if (!confirm('IndexedDBのデータをFirebaseに保存しますか？\n保存後、IndexedDBは初期化されます。')) {
        return;
    }

    try {
        updateStatus('Firebaseに保存中...');

        // IndexedDBから全データを取得
        const allTracks = await getAllTracks();
        const allPhotos = await getAllPhotos();
        const lastPosition = await getLastPosition();

        console.log('取得したデータ:', {
            tracks: allTracks.length,
            photos: allPhotos.length,
            position: lastPosition
        });

        // Firebaseプロジェクト名（Start時の日時）
        const projectName = trackingStartTime;
        console.log('Firebaseプロジェクト名:', projectName);

        // Firestoreに保存
        const firestoreDb = firebase.firestore();
        const projectRef = firestoreDb.collection('projects').doc(projectName);

        // トラッキングデータを配列形式に変換（精度調整）
        const formattedTracks = allTracks.map(track => ({
            timestamp: track.timestamp,
            points: track.points.map(point => formatPositionData(point)),
            totalPoints: track.totalPoints
        }));

        // 写真データを配列形式に変換（精度調整）
        const formattedPhotos = allPhotos.map(photo => ({
            data: photo.data,
            timestamp: photo.timestamp,
            location: formatPositionData(photo.location)
        }));

        // プロジェクトデータを作成（tracks, photosを配列として含む）
        const projectData = {
            startTime: trackingStartTime,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastPosition: formatPositionData(lastPosition),
            tracks: formattedTracks,
            photos: formattedPhotos,
            tracksCount: allTracks.length,
            photosCount: allPhotos.length
        };

        // プロジェクトドキュメントを保存（1回の書き込みで完了）
        await projectRef.set(projectData);
        console.log('プロジェクトデータを保存しました');
        console.log(`トラック: ${allTracks.length}件、写真: ${allPhotos.length}件`);

        updateStatus('Firebase保存完了');
        alert(`Firebaseに保存しました\nプロジェクト名: ${projectName}\nトラック: ${allTracks.length}件\n写真: ${allPhotos.length}件`);

        // IndexedDBを初期化
        await resetIndexedDBAfterSave(lastPosition);

    } catch (error) {
        console.error('Firebase保存エラー:', error);
        updateStatus('Firebase保存エラー');
        alert('Firebaseへの保存に失敗しました: ' + error.message);
    }
}

// IndexedDBから全トラッキングデータを取得
function getAllTracks() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('データベースが初期化されていません'));
            return;
        }

        try {
            const transaction = db.transaction([STORE_TRACKS], 'readonly');
            const store = transaction.objectStore(STORE_TRACKS);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(request.error);
            };
        } catch (error) {
            reject(error);
        }
    });
}

// IndexedDBから全写真データを取得
function getAllPhotos() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('データベースが初期化されていません'));
            return;
        }

        try {
            const transaction = db.transaction([STORE_PHOTOS], 'readonly');
            const store = transaction.objectStore(STORE_PHOTOS);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(request.error);
            };
        } catch (error) {
            reject(error);
        }
    });
}

// Firebase保存後のIndexedDB初期化
async function resetIndexedDBAfterSave(savedPosition) {
    try {
        // データベースを閉じる
        if (db) {
            db.close();
            db = null;
        }

        // データベースを削除
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

        deleteRequest.onsuccess = async () => {
            console.log('IndexedDBを削除しました');
            updateStatus('IndexedDBを初期化しました');

            // 再初期化
            await initIndexedDB();

            // 最後の記録地点を復元
            if (savedPosition) {
                await saveLastPosition(savedPosition.lat, savedPosition.lng, savedPosition.zoom);
                console.log('最後の記録地点を復元しました');
            } else {
                await saveLastPosition(DEFAULT_POSITION.lat, DEFAULT_POSITION.lng, DEFAULT_POSITION.zoom);
                console.log('デフォルト位置を設定しました');
            }

            // trackingStartTimeをリセット
            trackingStartTime = null;

            updateStatus('保存完了。IndexedDBを初期化しました');
        };

        deleteRequest.onerror = () => {
            console.error('IndexedDB削除エラー:', deleteRequest.error);
            alert('IndexedDBの削除に失敗しました');
        };

        deleteRequest.onblocked = () => {
            console.warn('IndexedDB削除がブロックされました');
            alert('データベースが使用中です。他のタブを閉じてから再度お試しください。');
        };
    } catch (error) {
        console.error('IndexedDB初期化エラー:', error);
        alert('IndexedDBの初期化に失敗しました: ' + error.message);
    }
}

// 地図の初期化
async function initMap() {
    // 保存された最終位置を取得
    let initialPosition = DEFAULT_POSITION;

    try {
        const lastPos = await getLastPosition();
        if (lastPos) {
            initialPosition = {
                lat: lastPos.lat,
                lng: lastPos.lng,
                zoom: lastPos.zoom
            };
            console.log('保存された位置から地図を初期化します:', initialPosition);
        } else {
            console.log('デフォルト位置（箕面大滝）から地図を初期化します');
        }
    } catch (error) {
        console.warn('位置取得エラー。デフォルト位置を使用します:', error);
    }

    // 地図を作成
    map = L.map('map').setView([initialPosition.lat, initialPosition.lng], initialPosition.zoom);

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
            lat: parseFloat(lat.toFixed(5)),
            lng: parseFloat(lng.toFixed(5)),
            timestamp: new Date().toISOString(),
            accuracy: parseFloat(accuracy.toFixed(1))
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

    // Start時の日時を記録（yyyy-MM-ddThh:mm形式）
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    trackingStartTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    console.log('GPS追跡開始時刻:', trackingStartTime);

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
        // 最後の記録地点を保存
        const lastPoint = trackingData[trackingData.length - 1];
        saveLastPosition(lastPoint.lat, lastPoint.lng, map.getZoom());
        console.log('最後の記録地点を保存しました:', lastPoint.lat, lastPoint.lng);

        saveTrackingData();
        updateStatus(`GPS追跡を停止しました (${trackingData.length}点記録)`);
    } else {
        updateStatus('GPS追跡を停止しました');
    }
}

// トラッキングデータをIndexedDBに保存
async function saveTrackingData() {
    if (!db) {
        console.error('データベースが初期化されていません');
        updateStatus('データベース接続エラー');
        return;
    }

    const trackData = {
        timestamp: new Date().toISOString(),
        points: trackingData,
        totalPoints: trackingData.length
    };

    try {
        const transaction = db.transaction([STORE_TRACKS], 'readwrite');
        const store = transaction.objectStore(STORE_TRACKS);
        const request = store.add(trackData);

        request.onsuccess = () => {
            console.log('トラッキングデータを保存しました。ID:', request.result);
        };

        request.onerror = () => {
            console.error('データ保存エラー:', request.error);
            updateStatus('データ保存エラー');
        };
    } catch (e) {
        console.error('データ保存エラー:', e);
        updateStatus('データ保存エラー');
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

// 写真をIndexedDBに保存
async function savePhoto() {
    if (!currentPhotoData) {
        return;
    }

    if (!db) {
        alert('データベースが初期化されていません');
        return;
    }

    try {
        const transaction = db.transaction([STORE_PHOTOS], 'readwrite');
        const store = transaction.objectStore(STORE_PHOTOS);
        const request = store.add(currentPhotoData);

        request.onsuccess = () => {
            console.log('写真を保存しました。ID:', request.result);
            alert('写真を保存しました');
            closePhotoModal();
        };

        request.onerror = () => {
            console.error('写真保存エラー:', request.error);
            alert('写真の保存に失敗しました');
        };
    } catch (e) {
        console.error('写真保存エラー:', e);
        alert('写真の保存に失敗しました: ' + e.message);
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
        緯度: ${lat.toFixed(5)}<br>
        経度: ${lng.toFixed(5)}<br>
        精度: ±${accuracy.toFixed(1)}m
    `;
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', async function() {
    // IndexedDBを初期化
    try {
        await initIndexedDB();
        console.log('IndexedDB初期化完了');
    } catch (error) {
        console.error('IndexedDB初期化エラー:', error);
        updateStatus('データベース初期化エラー');
    }

    // 地図を初期化（保存された位置または箕面大滝）
    await initMap();

    // ボタンイベント
    document.getElementById('saveBtn').addEventListener('click', saveToFirebase);
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
