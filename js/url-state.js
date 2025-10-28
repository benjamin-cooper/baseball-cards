// URL State Management - Save and load filters from URL
// DISABLED per user request - uncomment initializeURLState() in optimizations.js to re-enable

// Compression helper (simple base64 encoding)
function compressState(obj) {
    const json = JSON.stringify(obj);
    return btoa(encodeURIComponent(json));
}

function decompressState(str) {
    try {
        const json = decodeURIComponent(atob(str));
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

// Save current state to URL
function updateURL(replaceState = false) {
    const state = {
        y: Array.from(selectedYears),
        p: Array.from(selectedPlayers).slice(0, 20), // Limit to prevent huge URLs
        t: Array.from(selectedTeams).slice(0, 10),
        m: minConnections,
        pm: playerFilterMode === 'show' ? 1 : 0,
        tm: teamFilterMode === 'show' ? 1 : 0,
        v: Date.now() // Version/timestamp
    };
    
    const compressed = compressState(state);
    const url = `${window.location.pathname}#${compressed}`;
    
    if (replaceState) {
        history.replaceState({}, '', url);
    } else {
        history.pushState({}, '', url);
    }
    
    console.log('🔗 URL updated with current state');
}

// Load state from URL on page load
function loadFromURL() {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;
    
    const state = decompressState(hash);
    if (!state) {
        console.warn('⚠️ Invalid URL state');
        return false;
    }
    
    try {
        // Restore state
        suppressHistorySave = true; // Don't save to history when loading from URL
        
        selectedYears = new Set(state.y || []);
        selectedPlayers = new Set(state.p || []);
        selectedTeams = new Set(state.t || []);
        minConnections = state.m || 2;
        playerFilterMode = state.pm ? 'show' : 'hide';
        teamFilterMode = state.tm ? 'show' : 'hide';
        
        console.log('✅ Loaded state from URL');
        console.log(`  Years: ${selectedYears.size}`);
        console.log(`  Players: ${selectedPlayers.size}`);
        console.log(`  Teams: ${selectedTeams.size}`);
        console.log(`  Min connections: ${minConnections}`);
        
        suppressHistorySave = false;
        return true;
    } catch (e) {
        console.error('Error loading URL state:', e);
        suppressHistorySave = false;
        return false;
    }
}

// Copy share link to clipboard
function copyShareLink() {
    updateURL();
    const url = window.location.href;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showNotification('🔗 Link copied! Share this URL to show this exact view.', 3000);
        }).catch(() => {
            // Fallback for older browsers
            fallbackCopyToClipboard(url);
        });
    } else {
        fallbackCopyToClipboard(url);
    }
}

// Fallback copy method for older browsers
function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showNotification('🔗 Link copied! Share this URL.', 3000);
    } catch (err) {
        showNotification('❌ Could not copy link. Please copy manually from address bar.', 4000);
    }
    
    document.body.removeChild(textArea);
}

// Add share button to UI
function addShareButton() {
    const quickFilters = document.querySelector('.quick-filters');
    if (!quickFilters) return;
    
    const shareBtn = document.createElement('button');
    shareBtn.className = 'export-btn';
    shareBtn.innerHTML = '🔗 Share View';
    shareBtn.onclick = copyShareLink;
    shareBtn.title = 'Copy shareable link to clipboard';
    
    // Add at the end
    quickFilters.appendChild(shareBtn);
}

// Auto-save to URL when filters change (debounced)
let urlUpdateTimeout = null;
function autoUpdateURL() {
    clearTimeout(urlUpdateTimeout);
    urlUpdateTimeout = setTimeout(() => {
        updateURL(true); // Use replaceState to not pollute browser history
    }, 1000); // Wait 1 second after last change
}

// Hook into updateDiagram to auto-update URL
function hookURLUpdates() {
    const originalUpdateDiagram = window.updateDiagram;
    window.updateDiagram = function() {
        autoUpdateURL();
        originalUpdateDiagram.apply(this, arguments);
    };
}

// Initialize URL state management - DISABLED
function initializeURLState() {
    console.log('ℹ️ URL state management disabled per user request');
    
    // Still add share button (but it won't auto-sync)
    // Uncomment the next line if you want to remove the share button too:
    // return;
    
    // Share button still works manually
    setTimeout(addShareButton, 1000);
    
    /* DISABLED - Uncomment to re-enable URL auto-syncing:
    
    // Try to load from URL first
    const loaded = loadFromURL();
    
    if (loaded) {
        // Update UI to reflect loaded state
        document.getElementById('connection-input').value = minConnections;
        document.getElementById('connection-slider').value = minConnections;
        document.getElementById('connection-value').textContent = `${minConnections}+ connection${minConnections === 1 ? '' : 's'}`;
        
        updateSelectedYearsDisplay();
        updateSelectedPlayersDisplay();
        updateSelectedTeamsDisplay();
        
        // Update mode buttons
        document.getElementById('mode-show').classList.toggle('active', playerFilterMode === 'show');
        document.getElementById('mode-hide').classList.toggle('active', playerFilterMode === 'hide');
        document.getElementById('team-mode-show').classList.toggle('active', teamFilterMode === 'show');
        document.getElementById('team-mode-hide').classList.toggle('active', teamFilterMode === 'hide');
        
        // Render the network
        updateDiagram();
        
        showNotification('✅ Loaded view from shared link!', 3000);
    }
    
    // Setup auto-update (but not for the initial load)
    setTimeout(() => {
        hookURLUpdates();
    }, 1000);
    
    console.log('🔗 URL state management initialized');
    */
}