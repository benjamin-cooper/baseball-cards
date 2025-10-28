// Keyboard Shortcuts Module

// Track if help dialog is open
let helpDialogOpen = false;

// Initialize keyboard shortcuts
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', handleKeyboardShortcut);
    console.log('⌨️ Keyboard shortcuts enabled');
}

function handleKeyboardShortcut(e) {
    // Don't trigger if typing in input or help dialog is open
    if (e.target.matches('input, textarea') || helpDialogOpen) return;
    
    // Prevent default for keys we handle
    const handledKeys = [' ', 'r', 'R', 'f', 'F', 'v', 'V', 'c', 'C', 'z', 'y', '+', '=', '-', '_', '?'];
    if (handledKeys.includes(e.key) || ((e.ctrlKey || e.metaKey) && handledKeys.includes(e.key))) {
        e.preventDefault();
    }
    
    switch(e.key) {
        case ' ': // Space: Toggle labels
            e.preventDefault();
            toggleLabels();
            showNotification('Labels ' + (labelsVisible ? 'shown' : 'hidden'));
            break;
            
        case 'r': // R: Reset/fit view
        case 'R':
            fitToScreen();
            showNotification('View reset');
            break;
            
        case 'f': // Ctrl+F: Focus search
        case 'F':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                document.getElementById('player-search').focus();
                showNotification('Search focused');
            }
            break;
            
        case '+': // +: Zoom in
        case '=':
            if (svg) {
                svg.transition().call(currentZoom.scaleBy, 1.3);
                showNotification('Zoomed in');
            }
            break;
            
        case '-': // -: Zoom out
        case '_':
            if (svg) {
                svg.transition().call(currentZoom.scaleBy, 0.7);
                showNotification('Zoomed out');
            }
            break;
            
        case 'z': // Ctrl+Z: Undo
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                undoFilter();
            }
            break;
            
        case 'y': // Ctrl+Y: Redo  
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                redoFilter();
            }
            break;
            
        case 'c': // Shift+C: Clear filters
        case 'C':
            if (e.shiftKey) {
                clearAllFilters();
                showNotification('All filters cleared');
            }
            break;
            
        case '?': // ?: Show help
            showKeyboardHelp();
            break;
    }
}

// Clear all filters at once
function clearAllFilters() {
    selectedYears.clear();
    selectedPlayers.clear();
    selectedTeams.clear();
    updateSelectedYearsDisplay();
    updateSelectedPlayersDisplay();
    updateSelectedTeamsDisplay();
    updateDiagram();
}

// Show keyboard shortcuts help dialog
function showKeyboardHelp() {
    helpDialogOpen = true;
    
    const dialog = document.createElement('div');
    dialog.id = 'keyboard-help-dialog';
    dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #0f2027 0%, #203a43 100%);
        padding: 30px;
        border-radius: 15px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.8);
        z-index: 10000;
        max-width: 600px;
        color: white;
        border: 2px solid rgba(76, 175, 80, 0.5);
    `;
    
    dialog.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0;">⌨️ Keyboard Shortcuts</h2>
            <button onclick="closeKeyboardHelp()" style="
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                line-height: 1;
            ">&times;</button>
        </div>
        
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px 30px; font-size: 14px;">
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">Space</div>
            <div>Toggle player name labels</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">R</div>
            <div>Center view (smart fit to main cluster)</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">Ctrl+F</div>
            <div>Focus player search</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">+ / -</div>
            <div>Zoom in / Zoom out</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">Ctrl+Z</div>
            <div>Undo last filter change (no button, keyboard only)</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">Ctrl+Y</div>
            <div>Redo filter change (no button, keyboard only)</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">Shift+C</div>
            <div>Clear all filters</div>
            
            <div style="text-align: right; color: #4CAF50; font-weight: bold;">?</div>
            <div>Show this help (press again to close)</div>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; color: #aaa; text-align: center;">
            Press any key or click outside to close
        </div>
    `;
    
    // Add backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'keyboard-help-backdrop';
    backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.7);
        z-index: 9999;
        backdrop-filter: blur(5px);
    `;
    backdrop.onclick = closeKeyboardHelp;
    
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    
    // Close on any key press
    document.addEventListener('keydown', closeKeyboardHelpOnKey);
}

function closeKeyboardHelpOnKey(e) {
    if (helpDialogOpen) {
        closeKeyboardHelp();
        document.removeEventListener('keydown', closeKeyboardHelpOnKey);
    }
}

function closeKeyboardHelp() {
    helpDialogOpen = false;
    const dialog = document.getElementById('keyboard-help-dialog');
    const backdrop = document.getElementById('keyboard-help-backdrop');
    if (dialog) dialog.remove();
    if (backdrop) backdrop.remove();
}

// Show notification toast
function showNotification(message, duration = 2000) {
    // Remove existing notification
    const existing = document.getElementById('notification-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'notification-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        font-weight: 600;
        animation: slideIn 0.3s ease-out;
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Add keyboard shortcut button to UI (now in app.js directly)
function addKeyboardShortcutButton() {
    // No longer needed - button is directly in the UI HTML
    console.log('ℹ️ Keyboard shortcut button already in UI');
}