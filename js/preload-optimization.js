// Preload & Performance Optimization Module

// ==========================================
// 1. PRELOAD DATA FILES
// ==========================================

// Start loading data immediately (before DOM ready)
const dataPreloader = {
    promises: {},
    cache: {},
    
    // Start preloading all data files immediately
    init() {
        console.log('🚀 Preloading data files...');
        const startTime = performance.now();
        
        // Preload all data files in parallel
        this.promises.network = this.loadJSON(DATA_URLS.network);
        this.promises.players = this.loadJSON(DATA_URLS.players);
        this.promises.teams = this.loadJSON(DATA_URLS.teams);
        this.promises.colors = this.loadJSON(DATA_URLS.colors);
        
        // Wait for all to complete
        Promise.all([
            this.promises.network,
            this.promises.players,
            this.promises.teams,
            this.promises.colors
        ]).then(() => {
            const loadTime = (performance.now() - startTime).toFixed(0);
            console.log(`✅ All data preloaded in ${loadTime}ms`);
        }).catch(err => {
            console.error('❌ Preload error:', err);
        });
    },
    
    // Load JSON with caching
    async loadJSON(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            this.cache[url] = data;
            return data;
        } catch (error) {
            console.error(`Failed to preload ${url}:`, error);
            throw error;
        }
    },
    
    // Get cached data (returns promise if not loaded yet)
    get(url) {
        if (this.cache[url]) {
            return Promise.resolve(this.cache[url]);
        }
        return this.promises[url] || this.loadJSON(url);
    }
};

// Start preloading immediately
dataPreloader.init();

// ==========================================
// 2. PROGRESSIVE LOADING
// ==========================================

// Override the loadData function to use preloaded data
const originalLoadData = window.loadData;
if (originalLoadData) {
    window.loadData = async function() {
        console.log('📦 Using preloaded data...');
        
        try {
            // Get preloaded data (instant if already loaded)
            const [networkData, playersData, teamsData, colorsData] = await Promise.all([
                dataPreloader.get(DATA_URLS.network),
                dataPreloader.get(DATA_URLS.players),
                dataPreloader.get(DATA_URLS.teams),
                dataPreloader.get(DATA_URLS.colors)
            ]);
            
            // Store in global variables (same as original)
            window.networkData = networkData;
            window.playersData = playersData;
            window.teamsData = teamsData;
            window.teamColorsData = colorsData;
            
            // Initialize the app
            if (typeof initializeApp === 'function') {
                initializeApp();
            }
            
            console.log('✅ Data loaded from cache');
            return true;
            
        } catch (error) {
            console.error('❌ Error loading data:', error);
            alert('Failed to load data. Please refresh the page.');
            return false;
        }
    };
}

// ==========================================
// 3. LAZY LOAD IMAGES
// ==========================================

// Lazy load images (if you add player photos later)
const imageLazyLoader = {
    observer: null,
    
    init() {
        if ('IntersectionObserver' in window) {
            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                            this.observer.unobserve(img);
                        }
                    }
                });
            }, { rootMargin: '50px' });
        }
    },
    
    observe(img) {
        if (this.observer) {
            this.observer.observe(img);
        }
    }
};

// ==========================================
// 4. SERVICE WORKER (OFFLINE SUPPORT)
// ==========================================

// Register service worker for offline caching
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('✅ Service Worker registered'))
            .catch(err => console.log('❌ Service Worker registration failed:', err));
    });
}

// ==========================================
// 5. DEBOUNCED UPDATES
// ==========================================

// Debounce expensive operations
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle expensive operations
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ==========================================
// 6. REQUEST ANIMATION FRAME
// ==========================================

// Batch DOM updates
const rafBatcher = {
    pending: false,
    callbacks: [],
    
    add(callback) {
        this.callbacks.push(callback);
        if (!this.pending) {
            this.pending = true;
            requestAnimationFrame(() => this.flush());
        }
    },
    
    flush() {
        const callbacks = this.callbacks.slice();
        this.callbacks = [];
        this.pending = false;
        callbacks.forEach(cb => cb());
    }
};

// ==========================================
// 7. VIRTUAL SCROLLING FOR LARGE LISTS
// ==========================================

// Virtual scroll for player/team lists (if they get large)
class VirtualScroller {
    constructor(container, items, renderItem, itemHeight = 40) {
        this.container = container;
        this.items = items;
        this.renderItem = renderItem;
        this.itemHeight = itemHeight;
        this.visibleCount = Math.ceil(container.clientHeight / itemHeight) + 2;
        this.scrollTop = 0;
        
        this.init();
    }
    
    init() {
        // Create scroll container
        this.scrollContainer = document.createElement('div');
        this.scrollContainer.style.height = `${this.items.length * this.itemHeight}px`;
        this.scrollContainer.style.position = 'relative';
        
        // Create viewport
        this.viewport = document.createElement('div');
        this.viewport.style.position = 'absolute';
        this.viewport.style.top = '0';
        this.viewport.style.left = '0';
        this.viewport.style.right = '0';
        
        this.scrollContainer.appendChild(this.viewport);
        this.container.appendChild(this.scrollContainer);
        
        // Listen to scroll
        this.container.addEventListener('scroll', throttle(() => this.update(), 16));
        
        // Initial render
        this.update();
    }
    
    update() {
        const scrollTop = this.container.scrollTop;
        const startIndex = Math.floor(scrollTop / this.itemHeight);
        const endIndex = Math.min(startIndex + this.visibleCount, this.items.length);
        
        // Only update if changed
        if (startIndex === this.lastStartIndex) return;
        this.lastStartIndex = startIndex;
        
        // Clear and render visible items
        this.viewport.innerHTML = '';
        this.viewport.style.transform = `translateY(${startIndex * this.itemHeight}px)`;
        
        for (let i = startIndex; i < endIndex; i++) {
            const item = this.renderItem(this.items[i], i);
            this.viewport.appendChild(item);
        }
    }
}

// ==========================================
// 8. WEB WORKERS (HEAVY COMPUTATIONS)
// ==========================================

// Offload heavy computations to web worker
const workerPool = {
    workers: [],
    maxWorkers: navigator.hardwareConcurrency || 4,
    
    init() {
        // Create worker pool (if needed for heavy calculations)
        for (let i = 0; i < this.maxWorkers; i++) {
            try {
                const worker = new Worker('js/computation-worker.js');
                this.workers.push(worker);
            } catch (e) {
                console.log('Web Workers not available');
                break;
            }
        }
    },
    
    async compute(data) {
        return new Promise((resolve, reject) => {
            if (this.workers.length === 0) {
                // Fallback to main thread
                resolve(this.computeOnMainThread(data));
                return;
            }
            
            const worker = this.workers[0]; // Simple round-robin could be added
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = (e) => reject(e);
            worker.postMessage(data);
        });
    },
    
    computeOnMainThread(data) {
        // Fallback computation on main thread
        return data;
    }
};

// ==========================================
// 9. PERFORMANCE MONITORING
// ==========================================

const performanceMonitor = {
    marks: {},
    
    start(name) {
        this.marks[name] = performance.now();
    },
    
    end(name) {
        if (this.marks[name]) {
            const duration = performance.now() - this.marks[name];
            console.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`);
            delete this.marks[name];
            return duration;
        }
    },
    
    // Log network performance
    logNetworkStats() {
        if (window.performance && performance.getEntriesByType) {
            const resources = performance.getEntriesByType('resource');
            const totalSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
            const totalTime = resources.reduce((sum, r) => sum + r.duration, 0);
            
            console.log('📊 Network Stats:');
            console.log(`   Resources: ${resources.length}`);
            console.log(`   Total Size: ${(totalSize / 1024).toFixed(2)} KB`);
            console.log(`   Total Time: ${totalTime.toFixed(2)}ms`);
        }
    }
};

// ==========================================
// 10. INITIALIZE OPTIMIZATIONS
// ==========================================

// Initialize all optimizations
function initOptimizations() {
    console.log('⚡ Initializing performance optimizations...');
    
    // Start monitoring
    performanceMonitor.start('initialization');
    
    // Initialize lazy loading
    imageLazyLoader.init();
    
    // Initialize worker pool (if needed)
    // workerPool.init();
    
    // Log stats after page load
    window.addEventListener('load', () => {
        performanceMonitor.end('initialization');
        performanceMonitor.logNetworkStats();
    });
}

// Auto-initialize
initOptimizations();

// ==========================================
// EXPORTS
// ==========================================

window.performanceUtils = {
    debounce,
    throttle,
    rafBatcher,
    VirtualScroller,
    performanceMonitor,
    dataPreloader
};

console.log('✅ Performance optimizations loaded');
