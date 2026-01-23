// WalkLogger - 地図関連

import { DEFAULT_POSITION, GSI_TILE_URL, GSI_ATTRIBUTION, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './config.js';
import * as state from './state.js';
import { getLastPosition, getAllPhotos } from './db.js';

/**
 * 矢印型マーカーアイコンを作成
 * @param {number} heading - 方角（度）
 * @returns {L.DivIcon}
 */
export function createArrowIcon(heading = 0) {
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

/**
 * 写真マーカーアイコンを作成
 * @returns {L.DivIcon}
 */
export function createPhotoIcon() {
    return L.divIcon({
        className: 'photo-marker',
        html: `<div class="photo-marker-circle"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
}

/**
 * 地図を初期化
 */
export async function initMap() {
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

    const mapInstance = L.map('map').setView([initialPosition.lat, initialPosition.lng], initialPosition.zoom);
    state.setMap(mapInstance);

    L.tileLayer(GSI_TILE_URL, {
        attribution: GSI_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
        minZoom: MAP_MIN_ZOOM
    }).addTo(mapInstance);

    const trackingPathInstance = L.polyline([], {
        color: '#4CAF50',
        weight: 4,
        opacity: 0.7
    }).addTo(mapInstance);
    state.setTrackingPath(trackingPathInstance);

    console.log('地図を初期化しました');
}

/**
 * 写真マーカーを地図上に表示
 * @param {Function} onMarkerClick - マーカークリック時のコールバック
 */
export async function displayPhotoMarkers(onMarkerClick) {
    try {
        // 既存のマーカーをクリア
        state.photoMarkers.forEach(marker => state.map.removeLayer(marker));
        state.clearPhotoMarkers();

        const allPhotos = await getAllPhotos();
        console.log(`IndexedDBから写真データを取得: ${allPhotos.length}件`);

        let markerCount = 0;
        allPhotos.forEach((photo, index) => {
            if (photo.location && photo.location.lat && photo.location.lng) {
                const photoIcon = createPhotoIcon();
                const directionText = photo.direction ? ` - ${photo.direction}` : '';
                const marker = L.marker([photo.location.lat, photo.location.lng], {
                    icon: photoIcon,
                    title: `${new Date(photo.timestamp).toLocaleString('ja-JP')}${directionText}`
                }).addTo(state.map);

                if (onMarkerClick) {
                    marker.on('click', () => onMarkerClick(photo));
                }

                state.addPhotoMarker(marker);
                markerCount++;
            } else {
                console.warn(`写真 ${index + 1}: 位置情報なし`);
            }
        });

        console.log(`写真マーカーを${markerCount}個表示しました（全${allPhotos.length}件中）`);
    } catch (error) {
        console.error('写真マーカー表示エラー:', error);
    }
}

/**
 * 地図上のマーカーと軌跡をクリア
 */
export function clearMapData() {
    if (state.trackingPath) {
        state.trackingPath.setLatLngs([]);
        console.log('トラックパスをクリアしました');
    }

    state.photoMarkers.forEach(marker => state.map.removeLayer(marker));
    state.clearPhotoMarkers();
    console.log('写真マーカーをクリアしました');
}

/**
 * 軌跡を更新
 * @param {Array} points - 位置データ配列
 */
export function updateTrackingPath(points) {
    if (state.trackingPath) {
        const latlngs = points.map(point => [point.lat, point.lng]);
        state.trackingPath.setLatLngs(latlngs);
    }
}

/**
 * 現在位置マーカーを更新
 * @param {number} lat - 緯度
 * @param {number} lng - 経度
 * @param {number} heading - 方角
 */
export function updateCurrentMarker(lat, lng, heading) {
    const arrowIcon = createArrowIcon(heading);
    if (state.currentMarker) {
        state.currentMarker.setLatLng([lat, lng]);
        state.currentMarker.setIcon(arrowIcon);
    } else {
        const marker = L.marker([lat, lng], { icon: arrowIcon }).addTo(state.map);
        state.setCurrentMarker(marker);
        state.map.setView([lat, lng], 15);
    }
}

/**
 * 写真マーカーを追加
 * @param {Object} photo - 写真データ
 * @param {Function} onMarkerClick - クリック時のコールバック
 */
export function addPhotoMarkerToMap(photo, onMarkerClick) {
    if (!photo.location) return;

    const photoIcon = createPhotoIcon();
    const marker = L.marker([photo.location.lat, photo.location.lng], {
        icon: photoIcon,
        title: `${new Date(photo.timestamp).toLocaleString('ja-JP')} - ${photo.direction || ''}`
    }).addTo(state.map);

    if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(photo));
    }

    state.addPhotoMarker(marker);
}
