// Canvas & Export Performance Optimizations
// Add this to your export.js or main app file

// ==========================================
// CANVAS RENDERING OPTIMIZATIONS
// ==========================================

const canvasOptimizations = {
    // Get optimized canvas context
    getOptimizedContext(canvas, options = {}) {
        const defaultOptions = {
            alpha: false,           // Faster if you don't need transparency
            desynchronized: true,   // Reduces latency
            willReadFrequently: false, // Optimize for drawing, not reading
            ...options
        };
        
        return canvas.getContext('2d', defaultOptions);
    },
    
    // Setup high-quality text rendering
    setupTextRendering(ctx) {
        // These don't exist in all browsers, but don't hurt to set
        ctx.textRendering = 'optimizeLegibility';
        ctx.fontKerning = 'normal';
        ctx.textBaseline = 'alphabetic';
        
        // Critical for sharp text
        ctx.imageSmoothingEnabled = false; // For pixel-perfect text at scaled res
    },
    
    // Batch canvas operations
    batchDraw(ctx, operations) {
        ctx.save();
        operations.forEach(op => op(ctx));
        ctx.restore();
    },
    
    // Pre-render static elements (like legend) to offscreen canvas
    createOffscreenCanvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') {
            return new OffscreenCanvas(width, height);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
};

// ==========================================
// EXPORT-SPECIFIC OPTIMIZATIONS
// ==========================================

const exportOptimizations = {
    // Pre-calculate all text metrics to avoid repeated measurements
    measureTextBatch(ctx, texts, font) {
        ctx.save();
        ctx.font = font;
        const measurements = new Map();
        texts.forEach(text => {
            measurements.set(text, ctx.measureText(text));
        });
        ctx.restore();
        return measurements;
    },
    
    // Use path2D for better performance with repeated shapes
    createCirclePath(radius) {
        const path = new Path2D();
        path.arc(0, 0, radius, 0, Math.PI * 2);
        return path;
    },
    
    // Optimize color operations
    rgbaToHex(r, g, b, a = 1) {
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    },
    
    // Memory-efficient blob creation
    async canvasToBlob(canvas, type = 'image/png', quality = 1.0) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('Blob creation failed')),
                type,
                quality
            );
        });
    },
    
    // Progressive rendering for large canvases
    async renderProgressive(canvas, renderFn, onProgress) {
        const chunkSize = 100; // Render in chunks
        const ctx = canvas.getContext('2d', { alpha: false });
        
        for (let i = 0; i < 100; i += chunkSize) {
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    renderFn(ctx, i, Math.min(i + chunkSize, 100));
                    if (onProgress) onProgress(i / 100);
                    resolve();
                });
            });
        }
    }
};

// ==========================================
// FONT LOADING OPTIMIZATION
// ==========================================

const fontOptimizer = {
    loadedFonts: new Set(),
    
    // Preload fonts before rendering
    async preloadFonts(fonts = ['Roboto']) {
        if (!document.fonts) return;
        
        const promises = fonts.map(async font => {
            if (this.loadedFonts.has(font)) return;
            
            try {
                await document.fonts.load(`16px ${font}`);
                await document.fonts.load(`bold 28px ${font}`);
                this.loadedFonts.add(font);
                console.log(`✅ Font loaded: ${font}`);
            } catch (e) {
                console.warn(`⚠️ Font failed to load: ${font}`);
            }
        });
        
        await Promise.all(promises);
        console.log('✅ All fonts ready');
    },
    
    // Wait for fonts before export
    async waitForFonts() {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }
    }
};

// ==========================================
// MEMORY MANAGEMENT
// ==========================================

const memoryManager = {
    // Release canvas memory
    releaseCanvas(canvas) {
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    },
    
    // Clear large objects
    clearImageData(imageData) {
        if (imageData && imageData.data) {
            imageData.data.fill(0);
        }
    },
    
    // Force garbage collection (Chrome only, dev tools)
    forceGC() {
        if (window.gc) {
            window.gc();
            console.log('🗑️ Garbage collection triggered');
        }
    }
};

// ==========================================
// EXPORT FUNCTION TEMPLATE (OPTIMIZED)
// ==========================================

async function exportPNGOptimized(svgElement, scale = 5) {
    console.log('🎨 Starting optimized PNG export...');
    const startTime = performance.now();
    
    try {
        // Wait for fonts
        await fontOptimizer.waitForFonts();
        
        // Create canvas at final resolution (no upscaling!)
        const baseWidth = 2400;
        const baseHeight = 1800;
        const canvas = document.createElement('canvas');
        canvas.width = baseWidth * scale;    // 12,000px
        canvas.height = baseHeight * scale;  // 9,000px
        
        // Get optimized context
        const ctx = canvasOptimizations.getOptimizedContext(canvas, {
            alpha: false,
            willReadFrequently: false
        });
        
        // Scale once
        ctx.scale(scale, scale);
        
        // Setup rendering
        canvasOptimizations.setupTextRendering(ctx);
        
        // Fill background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, baseWidth, baseHeight);
        
        // Draw content here...
        // (your drawing code)
        
        // Convert to blob
        const blob = await exportOptimizations.canvasToBlob(canvas, 'image/png', 1.0);
        
        // Create download
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `export-${Date.now()}.png`;
        link.click();
        
        // Cleanup
        setTimeout(() => {
            URL.revokeObjectURL(url);
            memoryManager.releaseCanvas(canvas);
        }, 100);
        
        const duration = (performance.now() - startTime).toFixed(0);
        console.log(`✅ Export complete in ${duration}ms`);
        
    } catch (error) {
        console.error('❌ Export failed:', error);
        throw error;
    }
}

// ==========================================
// KEY TIPS FOR SHARPNESS
// ==========================================

/*
CRITICAL RULES FOR SHARP PNG EXPORTS:

1. ✅ NEVER upscale - always render at final resolution
   - BAD:  Draw at 2400px, scale to 12000px = BLURRY
   - GOOD: Draw at 12000px directly = SHARP

2. ✅ Use ctx.scale() ONCE at the start
   - This maintains logical coordinates while rendering at high res

3. ✅ Disable imageSmoothingEnabled for text
   - ctx.imageSmoothingEnabled = false

4. ✅ Use integer coordinates when possible
   - Fractional pixels cause anti-aliasing blur

5. ✅ Wait for fonts to load
   - await document.fonts.ready

6. ✅ Use { alpha: false } for faster rendering
   - const ctx = canvas.getContext('2d', { alpha: false })

7. ✅ Set proper text rendering hints
   - ctx.textRendering = 'optimizeLegibility'

8. ✅ Pre-measure text if drawing lots of labels
   - Saves repeated layout calculations

9. ✅ Use Path2D for repeated shapes
   - Faster than drawing circles individually

10. ✅ Clean up resources after export
    - Release canvases, revoke blob URLs
*/

// ==========================================
// EXPORTS
// ==========================================

window.canvasOptimizations = canvasOptimizations;
window.exportOptimizations = exportOptimizations;
window.fontOptimizer = fontOptimizer;
window.memoryManager = memoryManager;

console.log('✅ Canvas optimizations loaded');
