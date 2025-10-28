// Filter History - Undo/Redo functionality

const filterHistory = [];
let historyIndex = -1;
const MAX_HISTORY = 50;
let suppressHistorySave = false;

// Save current filter state to history
function saveFilterState() {
    if (suppressHistorySave) return;
    
    const state = {
        years: Array.from(selectedYears),
        players: Array.from(selectedPlayers),
        teams: Array.from(selectedTeams),
        minConnections,
        playerMode: playerFilterMode,
        teamMode: teamFilterMode,
        timestamp: Date.now()
    };
    
    // Remove any "future" history if we're not at the end
    if (historyIndex < filterHistory.length - 1) {
        filterHistory.splice(historyIndex + 1);
    }
    
    // Don't save duplicate states
    if (filterHistory.length > 0) {
        const lastState = filterHistory[filterHistory.length - 1];
        if (JSON.stringify(state) === JSON.stringify(lastState)) {
            return;
        }
    }
    
    filterHistory.push(state);
    historyIndex = filterHistory.length - 1;
    
    // Limit history size
    if (filterHistory.length > MAX_HISTORY) {
        filterHistory.shift();
        historyIndex--;
    }
    
    updateHistoryButtons();
    console.log(`📝 Saved filter state (${historyIndex + 1}/${filterHistory.length})`);
}

// Undo to previous filter state
function undoFilter() {
    if (historyIndex <= 0) {
        showNotification('Nothing to undo', 1500);
        return;
    }
    
    historyIndex--;
    restoreFilterState(filterHistory[historyIndex]);
    showNotification(`⏪ Undo (${historyIndex + 1}/${filterHistory.length})`, 1500);
    updateHistoryButtons();
}

// Redo to next filter state
function redoFilter() {
    if (historyIndex >= filterHistory.length - 1) {
        showNotification('Nothing to redo', 1500);
        return;
    }
    
    historyIndex++;
    restoreFilterState(filterHistory[historyIndex]);
    showNotification(`⏩ Redo (${historyIndex + 1}/${filterHistory.length})`, 1500);
    updateHistoryButtons();
}

// Restore a filter state from history
function restoreFilterState(state) {
    suppressHistorySave = true; // Don't save while restoring
    
    selectedYears = new Set(state.years);
    selectedPlayers = new Set(state.players);
    selectedTeams = new Set(state.teams);
    minConnections = state.minConnections;
    playerFilterMode = state.playerMode;
    teamFilterMode = state.teamMode;
    
    // Update UI
    document.getElementById('connection-input').value = state.minConnections;
    document.getElementById('connection-slider').value = state.minConnections;
    document.getElementById('connection-value').textContent = `${state.minConnections}+ connection${state.minConnections === 1 ? '' : 's'}`;
    
    updateSelectedYearsDisplay();
    updateSelectedPlayersDisplay();
    updateSelectedTeamsDisplay();
    
    // Update mode buttons
    document.getElementById('mode-show').classList.toggle('active', playerFilterMode === 'show');
    document.getElementById('mode-hide').classList.toggle('active', playerFilterMode === 'hide');
    document.getElementById('team-mode-show').classList.toggle('active', teamFilterMode === 'show');
    document.getElementById('team-mode-hide').classList.toggle('active', teamFilterMode === 'hide');
    
    updateDiagram();
    
    suppressHistorySave = false;
}

// Update undo/redo button states
function updateHistoryButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    
    if (undoBtn) {
        undoBtn.disabled = historyIndex <= 0;
        undoBtn.style.opacity = historyIndex <= 0 ? '0.5' : '1';
        undoBtn.style.cursor = historyIndex <= 0 ? 'not-allowed' : 'pointer';
    }
    
    if (redoBtn) {
        redoBtn.disabled = historyIndex >= filterHistory.length - 1;
        redoBtn.style.opacity = historyIndex >= filterHistory.length - 1 ? '0.5' : '1';
        redoBtn.style.cursor = historyIndex >= filterHistory.length - 1 ? 'not-allowed' : 'pointer';
    }
}

// Format state for display
function formatState(state) {
    const parts = [];
    if (state.years.length > 0) parts.push(`${state.years.length} years`);
    if (state.players.length > 0) parts.push(`${state.players.length} players`);
    if (state.teams.length > 0) parts.push(`${state.teams.length} teams`);
    if (state.minConnections > 2) parts.push(`${state.minConnections}+ conn`);
    return parts.join(', ') || 'empty state';
}

// Add undo/redo buttons to UI (DISABLED - not needed per user request)
function addHistoryButtons() {
    // Commented out - user doesn't want these buttons
    /*
    const quickFilters = document.querySelector('.quick-filters');
    if (!quickFilters) return;
    
    const undoBtn = document.createElement('button');
    undoBtn.id = 'undo-btn';
    undoBtn.className = 'quick-filter-btn';
    undoBtn.innerHTML = '↶ Undo (Ctrl+Z)';
    undoBtn.onclick = undoFilter;
    undoBtn.disabled = true;
    undoBtn.style.opacity = '0.5';
    
    const redoBtn = document.createElement('button');
    redoBtn.id = 'redo-btn';
    redoBtn.className = 'quick-filter-btn';
    redoBtn.innerHTML = '↷ Redo (Ctrl+Y)';
    redoBtn.onclick = redoFilter;
    redoBtn.disabled = true;
    redoBtn.style.opacity = '0.5';
    
    // Insert after shortcuts button or at start
    const shortcutsBtn = quickFilters.querySelector('button');
    if (shortcutsBtn) {
        shortcutsBtn.after(undoBtn);
        undoBtn.after(redoBtn);
    } else {
        quickFilters.insertBefore(redoBtn, quickFilters.firstChild);
        quickFilters.insertBefore(undoBtn, redoBtn);
    }
    */
    console.log('ℹ️ Undo/Redo buttons disabled (use Ctrl+Z/Y for keyboard shortcuts)');
}

// Hook into filter changes to save history
function hookFilterChanges() {
    // Override updateDiagram to save history before changes
    const originalUpdateDiagram = window.updateDiagram;
    window.updateDiagram = function() {
        saveFilterState();
        originalUpdateDiagram.apply(this, arguments);
    };
}