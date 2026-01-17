// WalkLogger - GPS位置記録アプリ

// グローバル変数
let map;
let currentMarker;
let trackingPath;
let photoMarkers = []; // 写真マーカーの配列
let watchId = null;
let isTracking = false;
let trackingData = [];
let trackingStartTime = null; // Start時の日時（yyyy-MM-ddThh:mm形式）
let trackingStartDate = null; // Start時のDateオブジェクト
let trackingStopDate = null; // Stop時のDateオブジェクト
let wakeLock = null; // Wake Lock API用（画面スリープ防止）
let photosInSession = 0; // セッション中の写真枚数
let lastRecordedPoint = null; // 最後に記録した位置情報（条件判定用）
let currentHeading = 0; // 現在の方角（度）

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

// 矢印型マーカーアイコンを作成（方角に応じて回転）
function createArrowIcon(heading = 0) {
    return L.divIcon({
        className: 'arrow-marker',
        html: `<div class="arrow" style="transform: rotate(${heading}deg)">
                <svg width="30" height="30" viewBox="0 0 30 30">
                    <path d="M15 5 L25 25 L15 20 L5 25 Z" fill="#4CAF50" stroke="#2E7D32" stroke-width="2"/>
                </svg>
            </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}

// 写真マーカーアイコンを作成（オレンジ色の丸）
function createPhotoIcon() {
    return L.divIcon({
        className: 'photo-marker',
        html: `<div class="photo-marker-circle"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
}

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

// Base64をBlobに変換
function base64ToBlob(base64, contentType = 'image/jpeg') {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: contentType });
}

// ドキュメント名入力ダイアログを表示
function showDocNameDialog(defaultName) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('docNameDialog');
        const input = document.getElementById('docNameInput');
        const okBtn = document.getElementById('docNameOkBtn');
        const cancelBtn = document.getElementById('docNameCancelBtn');

        // デフォルト名を設定
        input.value = defaultName;

        // OKボタンのイベント
        const handleOk = () => {
            const docName = input.value.trim();
            if (!docName) {
                alert('ドキュメント名を入力してください');
                return;
            }
            cleanup();
            resolve(docName);
        };

        // キャンセルボタンのイベント
        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        // Enterキーでも保存
        const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
                handleOk();
            }
        };

        // イベントリスナーを追加
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        input.addEventListener('keypress', handleKeyPress);

        // クリーンアップ関数
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            input.removeEventListener('keypress', handleKeyPress);
            dialog.style.display = 'none';
        };

        // ダイアログを表示
        dialog.style.display = 'flex';
        input.focus();
        input.select();
    });
}

// IndexedDBのデータをFirebaseに保存
async function saveToFirebase() {
    if (!trackingStartTime) {
        alert('追跡データがありません。先にGPS追跡を開始してください。');
        return;
    }

    // ドキュメント名を入力
    const projectName = await showDocNameDialog(trackingStartTime);
    if (!projectName) {
        updateStatus('保存をキャンセルしました');
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

        console.log('Firebaseプロジェクト名:', projectName);

        // Firebase StorageとFirestoreの参照を取得
        const storage = firebase.storage();
        const firestoreDb = firebase.firestore();
        const projectRef = firestoreDb.collection('projects').doc(projectName);

        // トラック統計を計算
        const trackStats = calculateTrackStats(allTracks);

        // トラッキングデータを配列形式に変換（精度調整）
        const formattedTracks = allTracks.map(track => ({
            timestamp: track.timestamp,
            points: track.points.map(point => formatPositionData(point)),
            totalPoints: track.totalPoints
        }));

        // 写真をStorageにアップロードしてダウンロードURLを取得
        updateStatus(`写真をアップロード中... (0/${allPhotos.length})`);
        const formattedPhotos = [];

        for (let i = 0; i < allPhotos.length; i++) {
            const photo = allPhotos[i];

            try {
                // Base64をBlobに変換
                const blob = base64ToBlob(photo.data);

                // Storage パス: projects/{projectName}/photos/{timestamp}.jpg
                const timestamp = new Date(photo.timestamp).getTime();
                const photoPath = `projects/${projectName}/photos/${timestamp}.jpg`;
                const storageRef = storage.ref(photoPath);

                // アップロード
                await storageRef.put(blob, {
                    contentType: 'image/jpeg',
                    customMetadata: {
                        timestamp: photo.timestamp,
                        lat: photo.location?.lat?.toString() || '',
                        lng: photo.location?.lng?.toString() || ''
                    }
                });

                // ダウンロードURLを取得
                const downloadURL = await storageRef.getDownloadURL();

                // Firestoreに保存するデータ
                formattedPhotos.push({
                    url: downloadURL,
                    storagePath: photoPath,
                    timestamp: photo.timestamp,
                    location: formatPositionData(photo.location)
                });

                console.log(`写真 ${i + 1}/${allPhotos.length} をアップロードしました`);
                updateStatus(`写真をアップロード中... (${i + 1}/${allPhotos.length})`);

            } catch (uploadError) {
                console.error(`写真 ${i + 1} のアップロードエラー:`, uploadError);
                // エラーがあっても続行
                formattedPhotos.push({
                    error: uploadError.message,
                    timestamp: photo.timestamp,
                    location: formatPositionData(photo.location)
                });
            }
        }

        updateStatus('Firestoreに保存中...');

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
        console.log(`トラック: ${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）、写真: ${allPhotos.length}件`);

        updateStatus('Firebase保存完了');
        alert(`Firebaseに保存しました\nプロジェクト名: ${projectName}\nトラック: ${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）\n写真: ${allPhotos.length}件`);

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

// トラック件数と総位置記録点数を計算
function calculateTrackStats(tracks) {
    const trackCount = tracks.length;
    const totalPoints = tracks.reduce((sum, track) => {
        return sum + (track.points ? track.points.length : 0);
    }, 0);
    return { trackCount, totalPoints };
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

// IndexedDB初期化（サイレント版 - Start機能用）
async function clearIndexedDBSilent() {
    try {
        // 最後の記録地点を取得（復元用）
        const lastPosition = await getLastPosition();

        // データベースを閉じる
        if (db) {
            db.close();
            db = null;
        }

        // データベースを削除
        await new Promise((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

            deleteRequest.onsuccess = () => {
                console.log('IndexedDBを削除しました');
                resolve();
            };

            deleteRequest.onerror = () => {
                console.error('IndexedDB削除エラー:', deleteRequest.error);
                reject(deleteRequest.error);
            };

            deleteRequest.onblocked = () => {
                console.warn('IndexedDB削除がブロックされました');
                reject(new Error('データベースが使用中です'));
            };
        });

        // 再初期化
        await initIndexedDB();

        // 最後の記録地点を復元
        if (lastPosition) {
            await saveLastPosition(lastPosition.lat, lastPosition.lng, lastPosition.zoom);
            console.log('最後の記録地点を復元しました');
        } else {
            await saveLastPosition(DEFAULT_POSITION.lat, DEFAULT_POSITION.lng, DEFAULT_POSITION.zoom);
            console.log('デフォルト位置を設定しました');
        }

        // trackingStartTimeをリセット
        trackingStartTime = null;
        trackingData = [];

        updateStatus('IndexedDB初期化完了');
    } catch (error) {
        console.error('IndexedDB初期化エラー:', error);
        throw error;
    }
}

// IndexedDB初期化（Clear機能）
async function clearIndexedDB() {
    if (!confirm('IndexedDBを初期化しますか？\n保存されているすべてのデータが削除されます。')) {
        return;
    }

    try {
        // 最後の記録地点を取得（復元用）
        const lastPosition = await getLastPosition();

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
            if (lastPosition) {
                await saveLastPosition(lastPosition.lat, lastPosition.lng, lastPosition.zoom);
                console.log('最後の記録地点を復元しました');
            } else {
                await saveLastPosition(DEFAULT_POSITION.lat, DEFAULT_POSITION.lng, DEFAULT_POSITION.zoom);
                console.log('デフォルト位置を設定しました');
            }

            // trackingStartTimeをリセット
            trackingStartTime = null;
            trackingData = [];

            alert('IndexedDBを初期化しました');
            updateStatus('IndexedDB初期化完了');
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

    // トラッキングパス（軌跡）用のポリライン（緑色）
    trackingPath = L.polyline([], {
        color: '#4CAF50',
        weight: 4,
        opacity: 0.7
    }).addTo(map);

    updateStatus('地図を初期化しました');
}

// 写真マーカーを地図上に表示
async function displayPhotoMarkers() {
    try {
        // 既存の写真マーカーをクリア
        photoMarkers.forEach(marker => map.removeLayer(marker));
        photoMarkers = [];

        // IndexedDBから全写真データを取得
        const allPhotos = await getAllPhotos();

        // 位置情報がある写真のみマーカーを表示
        allPhotos.forEach(photo => {
            if (photo.location && photo.location.lat && photo.location.lng) {
                const photoIcon = createPhotoIcon();
                const marker = L.marker([photo.location.lat, photo.location.lng], {
                    icon: photoIcon,
                    title: new Date(photo.timestamp).toLocaleString('ja-JP')
                }).addTo(map);

                // マーカークリック時に写真を表示
                marker.on('click', () => {
                    showPhotoFromMarker(photo);
                });

                photoMarkers.push(marker);
            }
        });

        console.log(`写真マーカーを${photoMarkers.length}個表示しました`);
    } catch (error) {
        console.error('写真マーカー表示エラー:', error);
    }
}

// マーカークリックから写真を表示
function showPhotoFromMarker(photo) {
    const viewer = document.getElementById('photoViewer');
    const img = document.getElementById('viewerImage');
    const info = document.getElementById('photoInfo');

    img.src = photo.data;

    const timestamp = new Date(photo.timestamp).toLocaleString('ja-JP');
    const location = photo.location
        ? `緯度: ${photo.location.lat.toFixed(5)}, 経度: ${photo.location.lng.toFixed(5)}`
        : '位置情報なし';

    info.innerHTML = `撮影日時: ${timestamp}<br>${location}`;
    viewer.style.display = 'flex';
}

// 2地点間の距離を計算（メートル）- Haversine公式
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球の半径（メートル）
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // メートル単位で距離を返す
}

// GPS位置の更新
function updatePosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const currentTime = Date.now();

    // 方角を取得（heading）※watchPositionで自動取得されることがある
    if (position.coords.heading !== null && position.coords.heading !== undefined) {
        currentHeading = position.coords.heading;
    }

    // マーカーを更新または作成
    const arrowIcon = createArrowIcon(currentHeading);
    if (currentMarker) {
        currentMarker.setLatLng([lat, lng]);
        currentMarker.setIcon(arrowIcon);
    } else {
        currentMarker = L.marker([lat, lng], { icon: arrowIcon }).addTo(map);
        map.setView([lat, lng], 15);
    }

    // 座標表示を更新
    updateCoordinates(lat, lng, accuracy);

    // トラッキング中の場合、条件を満たした時のみ記録
    if (isTracking) {
        let shouldRecord = false;

        // 初回は必ず記録
        if (lastRecordedPoint === null) {
            shouldRecord = true;
        } else {
            // 前回記録からの経過時間（秒）
            const elapsedSeconds = (currentTime - lastRecordedPoint.time) / 1000;

            // 前回記録からの移動距離（メートル）
            const distance = calculateDistance(
                lastRecordedPoint.lat, lastRecordedPoint.lng,
                lat, lng
            );

            // 60秒以上経過、または20m以上移動した場合に記録
            if (elapsedSeconds >= 60 || distance >= 20) {
                shouldRecord = true;
            }
        }

        if (shouldRecord) {
            const recordedPoint = {
                lat: parseFloat(lat.toFixed(5)),
                lng: parseFloat(lng.toFixed(5)),
                timestamp: new Date().toISOString(),
                accuracy: parseFloat(accuracy.toFixed(1))
            };

            trackingData.push(recordedPoint);

            // 最後に記録した位置情報を更新
            lastRecordedPoint = {
                lat: lat,
                lng: lng,
                time: currentTime
            };

            // 軌跡を描画
            const latlngs = trackingData.map(point => [point.lat, point.lng]);
            trackingPath.setLatLngs(latlngs);

            updateStatus(`GPS追跡中 (${trackingData.length}点記録)`);
        }
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

    // IndexedDBが初期化されているか確認
    if (!db) {
        alert('データベースが初期化されていません。ページを再読み込みしてください。');
        console.error('IndexedDBが未初期化です');
        return;
    }

    // IndexedDBに既存データがあるか確認
    try {
        const allTracks = await getAllTracks();
        const allPhotos = await getAllPhotos();
        const trackStats = calculateTrackStats(allTracks);

        if (allTracks.length > 0 || allPhotos.length > 0) {
            // 既存データがある場合、初期化するか確認
            const shouldClear = confirm(
                `IndexedDBに既存のデータがあります。\n` +
                `トラック: ${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）\n` +
                `写真: ${allPhotos.length}件\n\n` +
                `データを初期化して新規記録を開始しますか？\n` +
                `「OK」: データの初期化\n` +
                `「キャンセル」: データを追記`
            );

            if (shouldClear) {
                // IndexedDB初期化
                await clearIndexedDBSilent();
                console.log('IndexedDBを初期化しました');
            } else {
                console.log('既存データに追記します');
            }
        }
    } catch (error) {
        console.error('データ確認エラー:', error);
        alert('データ確認中にエラーが発生しました。ページを再読み込みしてください。');
        return;
    }

    isTracking = true;
    trackingData = [];
    photosInSession = 0; // 写真カウントをリセット
    lastRecordedPoint = null; // 最後の記録地点をリセット

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

    // iOS 13以降の場合、DeviceOrientation許可を要求
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                window.addEventListener('deviceorientation', handleDeviceOrientation, true);
                console.log('DeviceOrientation許可が付与されました');
            } else {
                console.warn('DeviceOrientation許可が拒否されました');
            }
        } catch (error) {
            console.error('DeviceOrientation許可要求エラー:', error);
        }
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

            // 写真マーカーを追加表示
            if (location) {
                const photoIcon = createPhotoIcon();
                const marker = L.marker([location.lat, location.lng], {
                    icon: photoIcon,
                    title: new Date(photoRecord.timestamp).toLocaleString('ja-JP')
                }).addTo(map);

                // マーカークリック時に写真を表示
                marker.on('click', () => {
                    showPhotoFromMarker(photoRecord);
                });

                photoMarkers.push(marker);
            }

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
        photoBtn.style.backgroundColor = '';
        photoBtn.style.color = '';
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

// 保存されたドキュメント一覧を取得して表示（Reloadボタン用）
async function reloadFromFirebase() {
    try {
        updateStatus('ドキュメント一覧を取得中...');

        const firestoreDb = firebase.firestore();
        const projectsRef = firestoreDb.collection('projects');

        // createdAtで降順ソート（新しい順）
        const querySnapshot = await projectsRef.orderBy('createdAt', 'desc').get();

        if (querySnapshot.empty) {
            alert('保存されたドキュメントがありません');
            updateStatus('ドキュメントなし');
            return;
        }

        // ドキュメント一覧を生成
        const documents = [];
        querySnapshot.forEach(doc => {
            documents.push({
                id: doc.id,
                data: doc.data()
            });
        });

        // ドキュメント選択ダイアログを表示
        showDocumentListDialog(documents);

        updateStatus('ドキュメント一覧取得完了');
    } catch (error) {
        console.error('ドキュメント取得エラー:', error);
        alert('ドキュメントの取得に失敗しました: ' + error.message);
        updateStatus('ドキュメント取得エラー');
    }
}

// ドキュメント選択ダイアログを表示
function showDocumentListDialog(documents) {
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
        docDetails.textContent = `作成日時: ${dateStr} | トラック: ${doc.data.tracksCount || 0}件 | 写真: ${doc.data.photosCount || 0}枚`;

        docInfo.appendChild(docName);
        docInfo.appendChild(docDetails);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'document-load-btn';
        loadBtn.textContent = '読み込み';
        loadBtn.onclick = () => loadDocument(doc);

        docItem.appendChild(docInfo);
        docItem.appendChild(loadBtn);

        documentList.appendChild(docItem);
    });

    document.getElementById('documentListDialog').style.display = 'flex';
}

// ドキュメント選択ダイアログを閉じる
function closeDocumentListDialog() {
    document.getElementById('documentListDialog').style.display = 'none';
}

// 選択したドキュメントを読み込んで地図に表示
async function loadDocument(doc) {
    try {
        updateStatus('データを読み込み中...');
        closeDocumentListDialog();

        const data = doc.data;

        // 地図上の既存データをクリア
        if (trackingPath) {
            trackingPath.setLatLngs([]);
        }

        // トラックデータを地図に表示
        if (data.tracks && data.tracks.length > 0) {
            const allPoints = [];
            data.tracks.forEach(track => {
                if (track.points) {
                    track.points.forEach(point => {
                        allPoints.push([point.lat, point.lng]);
                    });
                }
            });

            if (allPoints.length > 0) {
                trackingPath.setLatLngs(allPoints);
                // 最初の地点に地図を移動
                map.setView(allPoints[0], 15);
            }
        }

        // 最終位置にマーカーを表示
        if (data.lastPosition) {
            const arrowIcon = createArrowIcon(currentHeading);
            if (currentMarker) {
                currentMarker.setLatLng([data.lastPosition.lat, data.lastPosition.lng]);
                currentMarker.setIcon(arrowIcon);
            } else {
                currentMarker = L.marker([data.lastPosition.lat, data.lastPosition.lng], { icon: arrowIcon }).addTo(map);
            }
        }

        // Firebaseの写真をIndexedDBにダウンロード
        if (data.photos && data.photos.length > 0) {
            updateStatus(`写真をダウンロード中... (0/${data.photos.length})`);

            for (let i = 0; i < data.photos.length; i++) {
                const photoData = data.photos[i];

                try {
                    // URLがある場合のみダウンロード
                    if (photoData.url) {
                        // URLから画像をダウンロード
                        const response = await fetch(photoData.url);
                        const blob = await response.blob();

                        // BlobをBase64に変換
                        const base64 = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        });

                        // IndexedDBに保存
                        const photoRecord = {
                            data: base64,
                            timestamp: photoData.timestamp,
                            location: photoData.location
                        };

                        const transaction = db.transaction([STORE_PHOTOS], 'readwrite');
                        const store = transaction.objectStore(STORE_PHOTOS);

                        await new Promise((resolve, reject) => {
                            const request = store.add(photoRecord);
                            request.onsuccess = () => resolve();
                            request.onerror = () => reject(request.error);
                        });

                        console.log(`写真 ${i + 1}/${data.photos.length} をダウンロードしました`);
                        updateStatus(`写真をダウンロード中... (${i + 1}/${data.photos.length})`);
                    }
                } catch (downloadError) {
                    console.error(`写真 ${i + 1} のダウンロードエラー:`, downloadError);
                    // エラーがあっても続行
                }
            }
        }

        // 写真マーカーを表示（IndexedDBから）
        await displayPhotoMarkers();

        // トラック統計を計算
        const trackStats = data.tracks ? calculateTrackStats(data.tracks) : { trackCount: 0, totalPoints: 0 };

        updateStatus(`データを読み込みました: ${doc.id}`);
        alert(`データを読み込みました\nドキュメント名: ${doc.id}\nトラック: ${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）\n写真: ${data.photosCount || 0}枚`);

    } catch (error) {
        console.error('ドキュメント読み込みエラー:', error);
        alert('データの読み込みに失敗しました: ' + error.message);
        updateStatus('データ読み込みエラー');
    }
}

// データサイズ情報を表示（Sizeボタン用）
async function showDataSize() {
    try {
        updateStatus('データサイズを計算中...');

        // IndexedDBから全データを取得
        const allTracks = await getAllTracks();
        const allPhotos = await getAllPhotos();
        const trackStats = calculateTrackStats(allTracks);

        // GPSデータサイズを計算
        let gpsDataSizeBytes = 0;

        allTracks.forEach(track => {
            const trackStr = JSON.stringify(track);
            gpsDataSizeBytes += new Blob([trackStr]).size;
        });

        // GPSデータサイズを適切な単位で表示（4桁精度）
        let gpsDataSize;
        const gpsDataSizeMB = gpsDataSizeBytes / (1024 * 1024);
        if (gpsDataSizeMB > 10) {
            gpsDataSize = gpsDataSizeMB.toPrecision(4) + ' MB';
        } else {
            const gpsDataSizeKB = gpsDataSizeBytes / 1024;
            gpsDataSize = gpsDataSizeKB.toPrecision(4) + ' KB';
        }

        // 写真データのサイズと解像度を計算
        let photosTotalSize = 0;
        let photosResolution = '-';

        if (allPhotos.length > 0) {
            allPhotos.forEach(photo => {
                photosTotalSize += new Blob([photo.data]).size;
            });

            // 最後の写真から解像度を取得
            const lastPhoto = allPhotos[allPhotos.length - 1];
            const img = new Image();
            await new Promise((resolve) => {
                img.onload = () => {
                    photosResolution = `${img.width} × ${img.height}`;
                    resolve();
                };
                img.onerror = () => {
                    resolve();
                };
                img.src = lastPhoto.data;
            });
        }

        // 写真データサイズを適切な単位で表示（4桁精度）
        let photosDataSize;
        const photosSizeMB = photosTotalSize / (1024 * 1024);
        if (photosSizeMB > 10) {
            photosDataSize = photosSizeMB.toPrecision(4) + ' MB';
        } else {
            const photosSizeKB = photosTotalSize / 1024;
            photosDataSize = photosSizeKB.toPrecision(4) + ' KB';
        }

        // データサイズ情報のHTMLを生成
        const statsHTML = `
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">トラック:</span>
                    <span class="stat-value">${trackStats.trackCount}件（位置記録点: ${trackStats.totalPoints}件）</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">GPSデータサイズ:</span>
                    <span class="stat-value">${gpsDataSize}</span>
                </div>
            </div>
            <div class="stat-section">
                <div class="stat-row">
                    <span class="stat-label">写真撮影枚数:</span>
                    <span class="stat-value">${allPhotos.length}枚</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真データサイズ:</span>
                    <span class="stat-value">${photosDataSize}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">写真解像度:</span>
                    <span class="stat-value">${photosResolution}</span>
                </div>
            </div>
        `;

        // ダイアログに表示
        document.getElementById('statsBody').innerHTML = statsHTML;
        document.getElementById('statsDialog').style.display = 'flex';

        updateStatus('データサイズ表示完了');
    } catch (error) {
        console.error('データサイズ取得エラー:', error);
        alert('データサイズの取得に失敗しました: ' + error.message);
        updateStatus('データサイズ取得エラー');
    }
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

    // GPSデータサイズを適切な単位で表示（4桁精度）
    let gpsDataSize;
    const gpsDataSizeMB = gpsDataSizeBytes / (1024 * 1024);
    if (gpsDataSizeMB > 10) {
        // 10MB超: MB単位で表示
        gpsDataSize = gpsDataSizeMB.toPrecision(4) + ' MB';
    } else {
        // 10MB以下: KB単位で表示
        const gpsDataSizeKB = gpsDataSizeBytes / 1024;
        gpsDataSize = gpsDataSizeKB.toPrecision(4) + ' KB';
    }

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

    // 写真データサイズを適切な単位で表示（4桁精度）
    let photosDataSize;
    const photosSizeMB = photosTotalSize / (1024 * 1024);
    if (photosSizeMB > 10) {
        // 10MB超: MB単位で表示
        photosDataSize = photosSizeMB.toPrecision(4) + ' MB';
    } else {
        // 10MB以下: KB単位で表示
        const photosSizeKB = photosTotalSize / 1024;
        photosDataSize = photosSizeKB.toPrecision(4) + ' KB';
    }

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
                <span class="stat-value">${gpsDataSize}</span>
            </div>
        </div>
        <div class="stat-section">
            <div class="stat-row">
                <span class="stat-label">写真撮影枚数:</span>
                <span class="stat-value">${photosInSession}枚</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">写真データサイズ:</span>
                <span class="stat-value">${photosDataSize}</span>
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

// デバイスの方角を取得（DeviceOrientation API）
function handleDeviceOrientation(event) {
    // alphaは北を0度とした方角（0-360度）
    // webkitCompassHeadingはiOS用
    let heading = null;

    if (event.webkitCompassHeading !== undefined) {
        // iOS Safari
        heading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        // Android Chrome等
        // alphaは0度が北、90度が東、180度が南、270度が西
        heading = 360 - event.alpha;
    }

    if (heading !== null) {
        currentHeading = heading;
        // マーカーアイコンを更新
        if (currentMarker) {
            const arrowIcon = createArrowIcon(currentHeading);
            currentMarker.setIcon(arrowIcon);
        }
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
        alert('データベースの初期化に失敗しました。ページを再読み込みしてください。\nエラー: ' + error.message);
        return; // 初期化失敗時は後続処理をスキップ
    }

    // 地図を初期化（保存された位置または箕面大滝）
    await initMap();

    // 写真マーカーを表示
    await displayPhotoMarkers();

    // メインコントロールのボタンイベント
    document.getElementById('startBtn').addEventListener('click', startTracking);
    document.getElementById('stopBtn').addEventListener('click', stopTracking);
    document.getElementById('photoBtn').addEventListener('click', takePhoto);

    // Dataボタンのクリックイベント（パネル表示切り替え）
    document.getElementById('dataBtn').addEventListener('click', function() {
        const dataPanel = document.getElementById('dataPanel');
        const controls = document.getElementById('controls');

        if (dataPanel.style.display === 'none' || dataPanel.style.display === '') {
            // dataPanelを表示し、controlsを隠す
            dataPanel.style.display = 'flex';
            controls.style.display = 'none';

            // dataPanelのボタンスタイルをリセット（hover状態を解除）
            const dataBtns = dataPanel.querySelectorAll('.control-btn');
            dataBtns.forEach(btn => {
                btn.style.backgroundColor = '';
                btn.style.color = '';
            });
        } else {
            // dataPanelを隠し、controlsを表示
            dataPanel.style.display = 'none';
            controls.style.display = 'flex';
        }
    });

    // メインコントロールに戻る共通関数
    function returnToMainControl() {
        document.getElementById('dataPanel').style.display = 'none';
        document.getElementById('controls').style.display = 'flex';
    }

    // データ管理パネルのボタンイベント
    document.getElementById('dataListBtn').addEventListener('click', async function() {
        await showPhotoList();
        returnToMainControl();
    });

    document.getElementById('dataSizeBtn').addEventListener('click', async function() {
        await showDataSize();
        returnToMainControl();
    });

    document.getElementById('dataReloadBtn').addEventListener('click', async function() {
        await reloadFromFirebase();
        returnToMainControl();
    });

    document.getElementById('dataSaveBtn').addEventListener('click', async function() {
        await saveToFirebase();
        returnToMainControl();
    });

    // 写真一覧とビューアの閉じるボタン
    document.getElementById('closeListBtn').addEventListener('click', closePhotoList);
    document.getElementById('closeViewerBtn').addEventListener('click', closePhotoViewer);

    // 統計ダイアログのOKボタン
    document.getElementById('statsOkBtn').addEventListener('click', closeStatsDialog);

    // ドキュメント一覧ダイアログのキャンセルボタン
    document.getElementById('closeDocListBtn').addEventListener('click', closeDocumentListDialog);

    // ページの可視性が変化した時のイベントリスナー（Wake Lock再取得用）
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // デバイスの方角センサーを有効化
    if (window.DeviceOrientationEvent) {
        // iOS 13以降は許可が必要
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOSの場合、ユーザーアクションから呼び出す必要があるため、
            // Startボタンクリック時に許可を要求する（startTracking内で処理）
            console.log('iOS: DeviceOrientation許可が必要です');
        } else {
            // Android等
            window.addEventListener('deviceorientation', handleDeviceOrientation, true);
            console.log('DeviceOrientation イベントリスナーを追加しました');
        }
    }

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
