// WalkLogger - グローバル状態管理

// 地図関連
export let map = null;
export let currentMarker = null;
export let trackingPath = null;
export let photoMarkers = [];

// GPS追跡関連
export let watchId = null;
export let isTracking = false;
export let trackingData = [];
export let trackingStartTime = null;
export let trackingStartDate = null;
export let trackingStopDate = null;
export let lastRecordedPoint = null;
export let currentHeading = 0;

// Wake Lock
export let wakeLock = null;

// カメラ関連
export let cameraStream = null;
export let capturedPhotoData = null;
export let photosInSession = 0;

// IndexedDB
export let db = null;

// Firebase
export let firebaseAuthReady = false;

// 状態更新関数
export function setMap(value) { map = value; }
export function setCurrentMarker(value) { currentMarker = value; }
export function setTrackingPath(value) { trackingPath = value; }
export function setPhotoMarkers(value) { photoMarkers = value; }
export function setWatchId(value) { watchId = value; }
export function setIsTracking(value) { isTracking = value; }
export function setTrackingData(value) { trackingData = value; }
export function setTrackingStartTime(value) { trackingStartTime = value; }
export function setTrackingStartDate(value) { trackingStartDate = value; }
export function setTrackingStopDate(value) { trackingStopDate = value; }
export function setLastRecordedPoint(value) { lastRecordedPoint = value; }
export function setCurrentHeading(value) { currentHeading = value; }
export function setWakeLock(value) { wakeLock = value; }
export function setCameraStream(value) { cameraStream = value; }
export function setCapturedPhotoData(value) { capturedPhotoData = value; }
export function setPhotosInSession(value) { photosInSession = value; }
export function setDb(value) { db = value; }
export function setFirebaseAuthReady(value) { firebaseAuthReady = value; }

// 配列操作
export function addPhotoMarker(marker) { photoMarkers.push(marker); }
export function clearPhotoMarkers() { photoMarkers = []; }
export function addTrackingPoint(point) { trackingData.push(point); }
export function resetTrackingData() { trackingData = []; }
