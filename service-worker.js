// WalkLogger Service Worker
// PWA対応: オフライン機能とキャッシュ管理

const CACHE_NAME = 'walklogger-v3';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Service Workerのインストール
self.addEventListener('install', function(event) {
  console.log('[Service Worker] インストール中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[Service Worker] キャッシュを開きました');
        return cache.addAll(urlsToCache);
      })
      .catch(function(error) {
        console.error('[Service Worker] キャッシュエラー:', error);
      })
  );
});

// Service Workerのアクティベーション
self.addEventListener('activate', function(event) {
  console.log('[Service Worker] アクティベート中...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 古いキャッシュを削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// リクエストの処理
self.addEventListener('fetch', function(event) {
  // 国土地理院のタイルは常にネットワークから取得（リアルタイム性のため）
  if (event.request.url.includes('cyberjapandata.gsi.go.jp')) {
    event.respondWith(
      fetch(event.request)
        .catch(function() {
          // オフライン時は何も返さない（地図が表示されないだけ）
          return new Response('', { status: 200 });
        })
    );
    return;
  }

  // その他のリソースはキャッシュファースト戦略
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // キャッシュにあればそれを返す
        if (response) {
          return response;
        }

        // なければネットワークから取得
        return fetch(event.request)
          .then(function(response) {
            // レスポンスが有効でない場合はそのまま返す
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // レスポンスをクローンしてキャッシュに保存
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(function(error) {
            console.error('[Service Worker] フェッチエラー:', error);
          });
      })
  );
});
