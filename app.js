// WalkLogger - GPS位置記録アプリ

// グローバル変数
let map;
let currentMarker;
let trackingPath;
let watchId = null;
let isTracking = false;
let trackingData = [];
let trackingStartTime = null; // Start時の日時（yyyy-MM-ddThh:mm形式）
let trackingStartDate = null; // Start時のDateオブジェクト
let trackingStopDate = null; // Stop時のDateオブジェクト
let wakeLock = null; // Wake Lock API用（画面スリープ防止）
let photosInSession = 0; // セッション中の写真枚数

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

// Wake Lockを取得（画面スリープ防止）
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock取得成功：画面スリープを防止します');

            // Wake Lockが解放された時のイベントハンドラ
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lockが解放されました');
            });

            return true;
        } else {
            console.warn('このブラウザはWake Lock APIに対応していません');
            return false;
        }
    } catch (err) {
        console.error('Wake Lock取得エラー:', err);
        return false;
    }
}

// Wake Lockを解放
async function releaseWakeLock() {
    if (wakeLock !== null) {
        try {
            await wakeLock.release();
            wakeLock = null;
            console.log('Wake Lockを解放しました：画面スリープが有効になります');
        } catch (err) {
            console.error('Wake Lock解放エラー:', err);
        }
    }
}

// GPS追跡を開始
async function startTracking() {
    if (!navigator.geolocation) {
        alert('このブラウザは位置情報に対応していません');
        return;
    }

    if (isTracking) {
        return;
    }

    isTracking = true;
    trackingData = [];
    photosInSession = 0; // 写真カウントをリセット

    // Start時の日時を記録
    trackingStartDate = new Date();
    const year = trackingStartDate.getFullYear();
    const month = String(trackingStartDate.getMonth() + 1).padStart(2, '0');
    const day = String(trackingStartDate.getDate()).padStart(2, '0');
    const hours = String(trackingStartDate.getHours()).padStart(2, '0');
    const minutes = String(trackingStartDate.getMinutes()).padStart(2, '0');
    trackingStartTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    console.log('GPS追跡開始時刻:', trackingStartTime);

    // Wake Lockを取得（画面スリープ防止）
    const wakeLockSuccess = await requestWakeLock();
    if (wakeLockSuccess) {
        console.log('画面スリープ防止が有効になりました');
    } else {
        console.warn('画面スリープ防止を有効にできませんでした（ブラウザ非対応）');
    }

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
async function stopTracking() {
    if (!isTracking) {
        return;
    }

    isTracking = false;
    trackingStopDate = new Date(); // Stop時刻を記録

    // Wake Lockを解放（画面スリープを有効化）
    await releaseWakeLock();

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

        // 統計情報を表示
        await showTrackingStats();
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

// 写真撮影（MediaStream APIを使用）
async function takePhoto() {
    if (!db) {
        alert('データベースが初期化されていません');
        return;
    }

    const photoBtn = document.getElementById('photoBtn');

    try {
        // ボタンを無効化して視覚的フィードバックを追加
        photoBtn.disabled = true;
        photoBtn.style.opacity = '0.5';
        updateStatus('カメラ起動中...');

        // カメラにアクセス
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // 背面カメラを優先
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        const video = document.getElementById('cameraVideo');
        const canvas = document.getElementById('photoCanvas');

        video.srcObject = stream;

        // ビデオが準備できるまで待機
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                resolve();
            };
        });

        // 少し待ってから撮影（カメラが安定するまで）
        await new Promise(resolve => setTimeout(resolve, 500));

        // Canvasに描画
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        // カメラを停止
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;

        // Base64形式で取得
        const photoData = canvas.toDataURL('image/jpeg', 0.7);

        // 現在位置を取得
        const location = currentMarker ? currentMarker.getLatLng() : null;

        // IndexedDBに即座に保存
        const photoRecord = {
            data: photoData,
            timestamp: new Date().toISOString(),
            location: location ? {
                lat: parseFloat(location.lat.toFixed(5)),
                lng: parseFloat(location.lng.toFixed(5))
            } : null
        };

        const transaction = db.transaction([STORE_PHOTOS], 'readwrite');
        const store = transaction.objectStore(STORE_PHOTOS);
        const request = store.add(photoRecord);

        request.onsuccess = () => {
            console.log('写真を保存しました。ID:', request.result);
            photosInSession++; // セッション中の写真枚数をカウント
            updateStatus('写真を保存しました');
            // 2秒後にステータスを元に戻す
            setTimeout(() => {
                if (isTracking) {
                    updateStatus(`GPS追跡中 (${trackingData.length}点記録)`);
                } else {
                    updateStatus('GPS待機中...');
                }
            }, 2000);
        };

        request.onerror = () => {
            console.error('写真保存エラー:', request.error);
            updateStatus('写真保存エラー');
        };

    } catch (error) {
        console.error('カメラエラー:', error);

        if (error.name === 'NotAllowedError') {
            alert('カメラの使用が許可されていません');
        } else if (error.name === 'NotFoundError') {
            alert('カメラが見つかりません');
        } else {
            alert('写真撮影に失敗しました: ' + error.message);
        }

        updateStatus('写真撮影失敗');
    } finally {
        // 必ずボタンを元に戻す
        photoBtn.disabled = false;
        photoBtn.style.opacity = '';
    }
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

// 写真一覧を表示
async function showPhotoList() {
    if (!db) {
        alert('データベースが初期化されていません');
        return;
    }

    const photoListContainer = document.getElementById('photoListContainer');
    const photoGrid = document.getElementById('photoGrid');

    // 既存のサムネイルをクリア
    photoGrid.innerHTML = '';

    try {
        // IndexedDBから全ての写真を取得
        const transaction = db.transaction([STORE_PHOTOS], 'readonly');
        const store = transaction.objectStore(STORE_PHOTOS);
        const request = store.getAll();

        request.onsuccess = () => {
            const photos = request.result;

            if (photos.length === 0) {
                photoGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">保存された写真がありません</p>';
            } else {
                // 各写真のサムネイルを作成
                photos.forEach(photo => {
                    const thumbnail = document.createElement('div');
                    thumbnail.className = 'photo-thumbnail';

                    const img = document.createElement('img');
                    img.src = photo.data;
                    img.alt = '写真';

                    const timestamp = document.createElement('div');
                    timestamp.className = 'photo-timestamp';
                    const date = new Date(photo.timestamp);
                    timestamp.textContent = date.toLocaleString('ja-JP');

                    thumbnail.appendChild(img);
                    thumbnail.appendChild(timestamp);

                    // サムネイルクリックで拡大表示
                    thumbnail.addEventListener('click', () => {
                        showPhotoViewer(photo);
                    });

                    photoGrid.appendChild(thumbnail);
                });
            }

            // 写真一覧を表示
            photoListContainer.style.display = 'block';
        };

        request.onerror = () => {
            console.error('写真取得エラー:', request.error);
            alert('写真の読み込みに失敗しました');
        };

    } catch (error) {
        console.error('写真一覧表示エラー:', error);
        alert('写真一覧の表示に失敗しました');
    }
}

// 写真一覧を閉じる
function closePhotoList() {
    document.getElementById('photoListContainer').style.display = 'none';
}

// 写真を拡大表示
function showPhotoViewer(photo) {
    const viewer = document.getElementById('photoViewer');
    const viewerImage = document.getElementById('viewerImage');
    const photoInfo = document.getElementById('photoInfo');

    // 画像を設定
    viewerImage.src = photo.data;

    // 写真情報を設定
    const date = new Date(photo.timestamp);
    let infoHTML = `撮影日時: ${date.toLocaleString('ja-JP')}`;

    if (photo.location) {
        infoHTML += `<br>緯度: ${photo.location.lat.toFixed(5)}<br>経度: ${photo.location.lng.toFixed(5)}`;
    } else {
        infoHTML += '<br>位置情報なし';
    }

    photoInfo.innerHTML = infoHTML;

    // ビューアを表示
    viewer.style.display = 'flex';
}

// 写真ビューアを閉じる
function closePhotoViewer() {
    document.getElementById('photoViewer').style.display = 'none';
}

// 記録統計情報を表示
async function showTrackingStats() {
    if (!trackingStartDate || !trackingStopDate) {
        console.error('記録時刻情報が不足しています');
        return;
    }

    // 記録時間を計算（ミリ秒 → 分:秒）
    const durationMs = trackingStopDate - trackingStartDate;
    const durationSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const durationStr = `${minutes}分${seconds}秒`;

    // 開始・終了時刻をフォーマット
    const startTimeStr = `${trackingStartDate.getFullYear()}/${String(trackingStartDate.getMonth() + 1).padStart(2, '0')}/${String(trackingStartDate.getDate()).padStart(2, '0')} ${String(trackingStartDate.getHours()).padStart(2, '0')}:${String(trackingStartDate.getMinutes()).padStart(2, '0')}:${String(trackingStartDate.getSeconds()).padStart(2, '0')}`;
    const stopTimeStr = `${String(trackingStopDate.getHours()).padStart(2, '0')}:${String(trackingStopDate.getMinutes()).padStart(2, '0')}:${String(trackingStopDate.getSeconds()).padStart(2, '0')}`;

    // GPS記録地点数とサイズを計算
    const gpsPointsCount = trackingData.length;
    const gpsDataStr = JSON.stringify(trackingData);
    const gpsDataSizeBytes = new Blob([gpsDataStr]).size;
    const gpsDataSizeKB = (gpsDataSizeBytes / 1024).toFixed(2);

    // 写真データを取得してサイズと解像度を計算
    let photosTotalSize = 0;
    let photosResolution = '-';

    if (photosInSession > 0) {
        try {
            const allPhotos = await getAllPhotos();
            // 最新の写真から今回のセッション分を取得
            const sessionPhotos = allPhotos.slice(-photosInSession);

            sessionPhotos.forEach(photo => {
                photosTotalSize += new Blob([photo.data]).size;
            });

            // 最後の写真から解像度を取得
            if (sessionPhotos.length > 0) {
                const lastPhoto = sessionPhotos[sessionPhotos.length - 1];
                // Base64データから画像サイズを取得
                const img = new Image();
                await new Promise((resolve) => {
                    img.onload = () => {
                        photosResolution = `${img.width} × ${img.height}`;
                        resolve();
                    };
                    img.src = lastPhoto.data;
                });
            }
        } catch (error) {
            console.error('写真データ取得エラー:', error);
        }
    }

    const photosSizeMB = (photosTotalSize / (1024 * 1024)).toFixed(2);

    // 統計情報のHTMLを生成
    const statsHTML = `
        <div class="stat-section">
            <div class="stat-row">
                <span class="stat-label">記録開始日時:</span>
                <span class="stat-value">${startTimeStr}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">終了時刻:</span>
                <span class="stat-value">${stopTimeStr}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">記録時間:</span>
                <span class="stat-value">${durationStr}</span>
            </div>
        </div>
        <div class="stat-section">
            <div class="stat-row">
                <span class="stat-label">GPS記録地点数:</span>
                <span class="stat-value">${gpsPointsCount}点</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">GPSデータサイズ:</span>
                <span class="stat-value">${gpsDataSizeKB} KB</span>
            </div>
        </div>
        <div class="stat-section">
            <div class="stat-row">
                <span class="stat-label">写真撮影枚数:</span>
                <span class="stat-value">${photosInSession}枚</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">写真データサイズ:</span>
                <span class="stat-value">${photosSizeMB} MB</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">写真解像度:</span>
                <span class="stat-value">${photosResolution}</span>
            </div>
        </div>
    `;

    // ダイアログに統計情報を表示
    document.getElementById('statsBody').innerHTML = statsHTML;
    document.getElementById('statsDialog').style.display = 'flex';
}

// 統計ダイアログを閉じる
function closeStatsDialog() {
    document.getElementById('statsDialog').style.display = 'none';
}

// ページの可視性が変化した時の処理（Wake Lock再取得用）
async function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && isTracking) {
        console.log('ページが再表示されました。Wake Lockを再取得します');
        await requestWakeLock();
    }
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
    document.getElementById('listBtn').addEventListener('click', showPhotoList);

    // 写真一覧とビューアの閉じるボタン
    document.getElementById('closeListBtn').addEventListener('click', closePhotoList);
    document.getElementById('closeViewerBtn').addEventListener('click', closePhotoViewer);

    // 統計ダイアログのOKボタン
    document.getElementById('statsOkBtn').addEventListener('click', closeStatsDialog);

    // ページの可視性が変化した時のイベントリスナー（Wake Lock再取得用）
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
