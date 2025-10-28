// Global variables
let networkData = null;
let playersData = null;
let teamsData = null;
let teamColorsData = null;

// State
let selectedYears = new Set();
let selectedPlayers = new Set();
let selectedTeams = new Set();
let playerFilterMode = 'show';
let teamFilterMode = 'show';
let minConnections = 2;

// Cache for performance
let filteredDataCache = null;
let lastFilterString = '';

// D3 elements
let svg, g, simulation, link, node, label, tooltip;
let zoom;

// Load all data files
async function loadAllData() {
    try {
        const loadingEl = document.querySelector('.loading');
        if (loadingEl) loadingEl.textContent = 'Loading data... 0%';

        // Track progress
        let loaded = 0;
        const total = 4;
        
        const updateProgress = () => {
            loaded++;
            const percent = Math.round((loaded / total) * 100);
            if (loadingEl) loadingEl.textContent = `Loading data... ${percent}%`;
        };

        // Load all data files in parallel with progress tracking
        networkData = await fetch(DATA_URLS.network).then(r => r.json()).then(data => { updateProgress(); return data; });
        playersData = await fetch(DATA_URLS.players).then(r => r.json()).then(data => { updateProgress(); return data; });
        teamsData = await fetch(DATA_URLS.teams).then(r => r.json()).then(data => { updateProgress(); return data; });
        teamColorsData = await fetch(DATA_URLS.colors).then(r => r.json()).then(data => { updateProgress(); return data; });

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
    
    // Setup team search
    setupTeamSearch();
    
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
                    <label>🏟️ SEARCH FOR TEAMS:</label>
                    <div class="player-search-container">
                        <input 
                            type="text" 
                            id="team-search" 
                            class="player-search" 
                            placeholder="Type team name (e.g., Cleveland Indians, Boston Red Sox...)">
                        <div class="player-suggestions" id="team-suggestions"></div>
                    </div>
                    <div class="filter-mode">
                        <button class="mode-btn active" id="team-mode-show" onclick="setTeamFilterMode('show')">
                            ✓ Show Only These Teams
                        </button>
                        <button class="mode-btn" id="team-mode-hide" onclick="setTeamFilterMode('hide')">
                            ✗ Hide These Teams
                        </button>
                        <button class="quick-filter-btn" onclick="clearTeamFilter()">Clear All Teams</button>
                        <button class="quick-filter-btn" onclick="updateDiagram()" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);">
                            🔄 Apply Filter
                        </button>
                    </div>
                    <div class="selected-players" id="selected-teams"></div>
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
            
            <div class="insights-panel" id="insights-panel" style="display: none;">
                <!-- Dynamic insights appear here -->
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
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        // Debounce search - wait 200ms after typing stops
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const matches = playersData.players.filter(player => 
                player.toLowerCase().includes(query)
            ).slice(0, 10);
            
            console.log(`Search query: "${query}", Found ${matches.length} matches`);
            
            if (matches.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            
            suggestionsDiv.innerHTML = matches.map(player => 
                `<div class="player-suggestion" onclick="addPlayerFilter('${player.replace(/'/g, "\\'")}')">${player}</div>`
            ).join('');
            
            suggestionsDiv.style.display = 'block';
        }, 200);
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.player-search-container')) {
            suggestionsDiv.style.display = 'none';
        }
    });
}

// Team search functionality
function setupTeamSearch() {
    const searchInput = document.getElementById('team-search');
    const suggestionsDiv = document.getElementById('team-suggestions');
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        // Debounce search - wait 200ms after typing stops
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const matches = teamsData.teams.filter(team => 
                team.toLowerCase().includes(query)
            ).slice(0, 10);
            
            console.log(`Team search query: "${query}", Found ${matches.length} matches`);
            
            if (matches.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            
            suggestionsDiv.innerHTML = matches.map(team => 
                `<div class="player-suggestion" onclick="addTeamFilter('${team.replace(/'/g, "\\'")}')">${team}</div>`
            ).join('');
            
            suggestionsDiv.style.display = 'block';
        }, 200);
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
        `<div class="player-chip">
            ${player}
            <span class="player-chip-remove" onclick="removePlayerFilter('${player.replace(/'/g, "\\'")}')">&times;</span>
        </div>`
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

// Add team to filter
function addTeamFilter(team) {
    selectedTeams.add(team);
    updateSelectedTeamsDisplay();
    document.getElementById('team-search').value = '';
    document.getElementById('team-suggestions').style.display = 'none';
}

// Remove team from filter
function removeTeamFilter(team) {
    selectedTeams.delete(team);
    updateSelectedTeamsDisplay();
}

// Clear all team filters
function clearTeamFilter() {
    selectedTeams.clear();
    updateSelectedTeamsDisplay();
    updateDiagram();
}

// Update selected teams display
function updateSelectedTeamsDisplay() {
    const container = document.getElementById('selected-teams');
    if (selectedTeams.size === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = Array.from(selectedTeams).map(team => {
        const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
        return `<div class="player-chip" style="border-left: 4px solid ${color}">
            ${team}
            <span class="player-chip-remove" onclick="removeTeamFilter('${team.replace(/'/g, "\\'")}')">&times;</span>
        </div>`;
    }).join('');
}

// Set team filter mode
function setTeamFilterMode(mode) {
    teamFilterMode = mode;
    document.getElementById('team-mode-show').classList.toggle('active', mode === 'show');
    document.getElementById('team-mode-hide').classList.toggle('active', mode === 'hide');
    
    if (selectedTeams.size > 0) {
        updateDiagram();
    }
}

// Start the application when DOM is ready
window.addEventListener('DOMContentLoaded', loadAllData);