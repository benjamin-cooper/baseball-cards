// Service Worker for Baseball Network Visualization
// Provides offline support and faster loading

const CACHE_NAME = 'baseball-network-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/filters.js',
    '/js/network.js',
    '/js/export.js',
    '/js/chord-redesigned.js',
    '/js/keyboard.js',
    '/js/history.js',
    '/js/url-state.js',
    '/js/lod.js',
    '/js/enhanced-search.js',
    '/js/optimizations.js',
    '/js/preload-optimization.js',
    // D3.js from CDN will be cached on first load
];

const DATA_FILES = [
    '/data/network_data.json',
    '/data/players.json',
    '/data/teams.json',
    '/data/team_colors.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Caching assets...');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('✅ Assets cached successfully');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('❌ Cache installation failed:', error);
            })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    console.log('🔄 Service Worker activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('🗑️ Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('✅ Service Worker activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Handle data files with network-first strategy (always fresh data)
    if (DATA_FILES.some(file => url.pathname.endsWith(file))) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Clone and cache the response
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // If network fails, try cache
                    return caches.match(request);
                })
        );
        return;
    }
    
    // Handle other assets with cache-first strategy (faster loading)
    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // Return cached version immediately
                    // Update cache in background
                    fetch(request).then((response) => {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, response);
                        });
                    }).catch(() => {});
                    
                    return cachedResponse;
                }
                
                // Not in cache, fetch from network
                return fetch(request)
                    .then((response) => {
                        // Cache external resources (like D3.js CDN)
                        if (response.ok && request.method === 'GET') {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(request, responseClone);
                            });
                        }
                        return response;
                    });
            })
    );
});

// Background sync for offline changes (future feature)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-filters') {
        event.waitUntil(syncFilters());
    }
});

async function syncFilters() {
    // Placeholder for syncing user filter preferences
    console.log('🔄 Syncing filters...');
}

console.log('✅ Service Worker loaded');
