// Optimizations Module - Initialize all enhancements

// Initialize all optimization features
function initializeOptimizations() {
    console.log('🚀 Initializing optimizations...');
    
    // 1. Keyboard Shortcuts
    try {
        initializeKeyboardShortcuts();
        addKeyboardShortcutButton();
        console.log('✅ Keyboard shortcuts ready');
    } catch (e) {
        console.error('❌ Keyboard shortcuts failed:', e);
    }
    
    // 2. Filter History (Undo/Redo)
    try {
        hookFilterChanges();
        addHistoryButtons();
        console.log('✅ Filter history (undo/redo) ready');
    } catch (e) {
        console.error('❌ Filter history failed:', e);
    }
    
    // 3. URL State Management
    try {
        addShareButton();
        // Initialize URL state after a brief delay to ensure data is loaded
        setTimeout(() => {
            initializeURLState();
        }, 500);
        console.log('✅ URL state management ready');
    } catch (e) {
        console.error('❌ URL state management failed:', e);
    }
    
    // 4. Enhanced Search (will override original after delay)
    try {
        initializeEnhancedSearch();
        console.log('✅ Enhanced search with preview ready');
    } catch (e) {
        console.error('❌ Enhanced search failed:', e);
    }
    
    // 5. LOD System (will be initialized after first network render)
    // This is handled automatically in network.js
    console.log('✅ LOD system will activate on first zoom');
    
    console.log('🎉 All optimizations initialized!');
    
    // Show welcome notification
    setTimeout(() => {
        showNotification('💡 Tip: Press ? for keyboard shortcuts', 4000);
    }, 2000);
}

// Call this after the main app initializes
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Wait for main app to initialize
        setTimeout(initializeOptimizations, 1000);
    });
} else {
    // DOM already loaded
    setTimeout(initializeOptimizations, 1000);
}
