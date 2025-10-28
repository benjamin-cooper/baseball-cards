// Global variables
let networkData = null;
let playersData = null;
let teamsData = null;
let teamColorsData = null;

// State
let selectedYears = new Set();
let selectedPlayers = new Set();
let playerFilterMode = 'show';
let minConnections = 2;

// D3 elements
let svg, g, simulation, link, node, label, tooltip;
let zoom;

// Load all data files
async function loadAllData() {
    try {
        const loadingEl = document.querySelector('.loading');
        if (loadingEl) loadingEl.textContent = 'Loading data...';

        // Load all data files in parallel
        const [networkResp, playersResp, teamsResp, colorsResp] = await Promise.all([
            fetch(DATA_URLS.network),
            fetch(DATA_URLS.players),
            fetch(DATA_URLS.teams),
            fetch(DATA_URLS.colors)
        ]);

        networkData = await networkResp.json();
        playersData = await playersResp.json();
        teamsData = await teamsResp.json();
        teamColorsData = await colorsResp.json();

        console.log('✅ Data loaded successfully');
        console.log(`Years: ${networkData.years.length}`);
        console.log(`Players: ${playersData.count}`);
        console.log(`Teams: ${teamsData.count}`);
        console.log(`Edges: ${networkData.edges.length}`);

        // Initialize the application
        initializeApp();
    } catch (error) {
        console.error('Error loading data:', error);
        const loadingEl = document.querySelector('.loading');
        if (loadingEl) {
            loadingEl.textContent = 'Error loading data. Please refresh the page.';
            loadingEl.style.color = '#ff4444';
        }
    }
}

// Initialize the application
function initializeApp() {
    // Create the UI
    createUI();
    
    // Initialize the network visualization
    initializeNetwork();
    
    // Setup player search
    setupPlayerSearch();
    
    // Initialize filters
    initializeFilters();
}

// Create the main UI structure
function createUI() {
    const app = document.getElementById('app');
    
    app.innerHTML = `
        <div class="container">
            <h1>⚾ Ben & Marty's Baseball Card Collection ⚾</h1>
            <div class="subtitle">Interactive Player Connection Network</div>
            
            <div class="controls">
                <div class="filter-section">
                    <label>🔍 SEARCH FOR PLAYERS:</label>
                    <div class="player-search-container">
                        <input 
                            type="text" 
                            id="player-search" 
                            class="player-search" 
                            placeholder="Type player name (e.g., Jim Thome, Kenny Lofton...) - Team cards already filtered out">
                        <div class="player-suggestions" id="player-suggestions"></div>
                    </div>
                    <div class="filter-mode">
                        <button class="mode-btn active" id="mode-show" onclick="setFilterMode('show')">
                            ✓ Show Only These Players
                        </button>
                        <button class="mode-btn" id="mode-hide" onclick="setFilterMode('hide')">
                            ✗ Hide These Players
                        </button>
                        <button class="quick-filter-btn" onclick="clearPlayerFilter()">Clear All Players</button>
                        <button class="quick-filter-btn" onclick="updateDiagram()" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);">
                            🔄 Apply Filter
                        </button>
                    </div>
                    <div class="selected-players" id="selected-players"></div>
                </div>
                
                <div class="filter-section">
                    <label>🎯 Minimum Connections Filter:</label>
                    <div class="slider-container">
                        <span>2</span>
                        <input type="range" min="2" max="20" value="2" class="slider" id="connection-slider">
                        <span>20+</span>
                        <div class="slider-value" id="slider-value">2+ connections</div>
                    </div>
                </div>
                
                <div class="filter-section">
                    <label>📅 FILTER BY YEAR:</label>
                    <div class="year-selector" id="year-selector"></div>
                </div>
                
                <div class="filter-section">
                    <label>🎛️ Quick Filters:</label>
                    <div class="quick-filters">
                        <button class="quick-filter-btn" onclick="selectAllYears()">📅 All Years</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1950)">1950s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1960)">1960s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1970)">1970s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1980)">1980s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1990)">1990s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(2000)">2000s</button>
                        <button class="quick-filter-btn" onclick="selectYear(1991)">🎯 1991 Only</button>
                        <button class="quick-filter-btn" onclick="clearSelection()">🔄 Clear Years</button>
                        <button class="export-btn" onclick="fitToScreen()">📐 Fit to Screen</button>
                        <button class="export-btn" onclick="exportAsSVG()">💾 Download SVG</button>
                        <button class="export-btn" onclick="exportAsPNG()">📸 Download PNG</button>
                    </div>
                </div>
            </div>
            
            <div class="stats">
                <div class="stat-box">
                    <span class="stat-number" id="selected-years">0</span>
                    <span class="stat-label">Years Selected</span>
                </div>
                <div class="stat-box">
                    <span class="stat-number" id="unique-players">0</span>
                    <span class="stat-label">Players</span>
                </div>
                <div class="stat-box">
                    <span class="stat-number" id="connection-count">0</span>
                    <span class="stat-label">Connections</span>
                </div>
                <div class="stat-box">
                    <span class="stat-number" id="teams-count">0</span>
                    <span class="stat-label">Teams</span>
                </div>
            </div>
            
            <div class="filter-section">
                <label>🎨 Team Color Legend:</label>
                <div class="team-legend" id="team-legend"></div>
            </div>
            
            <div class="instructions">
                🔍 Search for players above • Drag to pan • Scroll to zoom • Drag players to rearrange • Hover for details
            </div>
            
            <div id="network-container">
                <div class="loading">Select at least one year to view the network...</div>
            </div>
        </div>
        
        <div class="tooltip" id="tooltip"></div>
    `;
}

// Player search functionality
function setupPlayerSearch() {
    const searchInput = document.getElementById('player-search');
    const suggestionsDiv = document.getElementById('player-suggestions');
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        const matches = playersData.players.filter(player => 
            player.toLowerCase().includes(query)
        ).slice(0, 10);
        
        if (matches.length === 0) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        suggestionsDiv.innerHTML = matches.map(player => 
            `<div class="suggestion-item" onclick="addPlayerFilter('${player.replace(/'/g, "\\'")}')">${player}</div>`
        ).join('');
        
        suggestionsDiv.style.display = 'block';
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.player-search-container')) {
            suggestionsDiv.style.display = 'none';
        }
    });
}

// Add player to filter
function addPlayerFilter(player) {
    selectedPlayers.add(player);
    updateSelectedPlayersDisplay();
    document.getElementById('player-search').value = '';
    document.getElementById('player-suggestions').style.display = 'none';
}

// Remove player from filter
function removePlayerFilter(player) {
    selectedPlayers.delete(player);
    updateSelectedPlayersDisplay();
}

// Clear all player filters
function clearPlayerFilter() {
    selectedPlayers.clear();
    updateSelectedPlayersDisplay();
    updateDiagram();
}

// Update selected players display
function updateSelectedPlayersDisplay() {
    const container = document.getElementById('selected-players');
    if (selectedPlayers.size === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = Array.from(selectedPlayers).map(player => 
        `<span class="player-tag">
            ${player}
            <span class="remove-player" onclick="removePlayerFilter('${player.replace(/'/g, "\\'")}')">&times;</span>
        </span>`
    ).join('');
}

// Set filter mode
function setFilterMode(mode) {
    playerFilterMode = mode;
    document.getElementById('mode-show').classList.toggle('active', mode === 'show');
    document.getElementById('mode-hide').classList.toggle('active', mode === 'hide');
    
    if (selectedPlayers.size > 0) {
        updateDiagram();
    }
}

// Start the application when DOM is ready
window.addEventListener('DOMContentLoaded', loadAllData);
