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

// Label visibility state
let labelsVisible = false;

// Load all data files
async function loadData() {
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
                <div class="filters-row">
                    <div class="filter-section filter-half">
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
                    
                    <div class="filter-section filter-half">
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
                </div>
                
                <div class="filter-section">
                    <label>🎯 Minimum Connections Filter:</label>
                    <div class="connection-controls">
                        <button class="connection-btn" onclick="decreaseConnections()">−</button>
                        <input type="number" min="1" max="150" value="2" class="connection-input" id="connection-input" 
                               onchange="updateConnectionsFromInput()" placeholder="Min">
                        <button class="connection-btn" onclick="increaseConnections()">+</button>
                        <div class="connection-value" id="connection-value">2+ connections</div>
                    </div>
                    <div class="slider-container">
                        <input type="range" min="1" max="150" value="2" class="slider" id="connection-slider">
                        <div class="slider-labels">
                            <span>1</span>
                            <span>25</span>
                            <span>75</span>
                            <span>150</span>
                        </div>
                    </div>
                </div>
                
                <div class="filter-section">
                    <label>📅 FILTER BY YEAR:</label>
                    <div class="year-selector" id="year-selector"></div>
                </div>
                
                <div class="filter-section">
                    <label>🎛️ Quick Filters:</label>
                    <div class="quick-filters">
                        <button class="quick-filter-btn" onclick="showKeyboardHelp()" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);">⌨️ Shortcuts (?)</button>
                        <button class="quick-filter-btn" onclick="selectAllYears()">📅 All Years</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1950)">1950s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1960)">1960s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1970)">1970s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1980)">1980s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(1990)">1990s</button>
                        <button class="quick-filter-btn" onclick="selectDecade(2000)">2000s</button>
                        <button class="quick-filter-btn" onclick="selectYear(1991)">🎯 1991 Only</button>
                        <button class="quick-filter-btn" onclick="clearSelection()">🔄 Clear Years</button>
                        <button class="export-btn" onclick="exportAsSVG(true)">💾 SVG (With Names)</button>
                        <button class="export-btn" onclick="exportAsSVG(false)">💾 SVG (No Names)</button>
                        <button class="export-btn" onclick="exportAsPNG(true)">📸 PNG (With Names)</button>
                        <button class="export-btn" onclick="exportAsPNG(false)">📸 PNG (No Names)</button>
                    </div>
                </div>
                
                <div class="filter-section">
                    <label>✨ SUGGESTED PLOTS - One-Click Stories:</label>
                    <div class="suggested-plots">
                        <button class="plot-btn" onclick="loadSuggestedPlot('elite13')">
                            <span class="plot-icon">👑</span>
                            <span class="plot-title">Elite 13</span>
                            <span class="plot-desc">Most connected players (100+)</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('halloffame')">
                            <span class="plot-icon">🏛️</span>
                            <span class="plot-title">Hall of Famers</span>
                            <span class="plot-desc">Known HOF inductees</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('allstars')">
                            <span class="plot-icon">🌟</span>
                            <span class="plot-title">All-Stars</span>
                            <span class="plot-desc">Multiple All-Star selections</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('1992boom')">
                            <span class="plot-icon">💥</span>
                            <span class="plot-title">1992 Boom</span>
                            <span class="plot-desc">Rico Brogna's 75-connection year</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('indians90s')">
                            <span class="plot-icon">⚾</span>
                            <span class="plot-title">90s Indians Dynasty</span>
                            <span class="plot-desc">Cleveland's golden era</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('alrivalry')">
                            <span class="plot-icon">🔥</span>
                            <span class="plot-title">AL East Rivalry</span>
                            <span class="plot-desc">Yankees vs Red Sox vs Orioles</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('starpower')">
                            <span class="plot-icon">⭐</span>
                            <span class="plot-title">Star Power</span>
                            <span class="plot-desc">50+ connection superstars</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('crosstown')">
                            <span class="plot-icon">🏙️</span>
                            <span class="plot-title">Crosstown Classics</span>
                            <span class="plot-desc">Cubs vs White Sox, Mets vs Yankees</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('jeffrobinson')">
                            <span class="plot-icon">🎖️</span>
                            <span class="plot-title">Jeff Robinson</span>
                            <span class="plot-desc">The most connected player (155!)</span>
                        </button>
                        <button class="plot-btn" onclick="loadSuggestedPlot('westcoast')">
                            <span class="plot-icon">🌊</span>
                            <span class="plot-title">West Coast Battle</span>
                            <span class="plot-desc">Dodgers, Giants, Athletics rivalry</span>
                        </button>
                        <button class="plot-btn" id="chord-diagram-btn" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                            <span class="plot-icon">🔄</span>
                            <span class="plot-title">Team Chord Diagram</span>
                            <span class="plot-desc">View team-to-team player movement</span>
                        </button>
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
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 20px 0; padding: 15px; background: rgba(255, 255, 255, 0.1); border-radius: 10px;">
                <div style="color: #aaa; font-size: 1em;">
                    💡 <strong>Tip:</strong> Toggle player names on/off, or zoom in to see them automatically
                </div>
                <button class="quick-filter-btn" id="toggle-labels-btn" onclick="toggleLabels()" style="margin: 0;">
                    🏷️ Show Names
                </button>
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
            ).slice(0, 20);
            
            console.log(`Search query: "${query}", Found ${matches.length} matches`);
            
            if (matches.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            
            // Show suggestions with checkmarks for selected players
            suggestionsDiv.innerHTML = matches.map(player => {
                const isSelected = selectedPlayers.has(player);
                const checkmark = isSelected ? '<span class="checkmark">✓</span>' : '';
                const selectedClass = isSelected ? 'selected' : '';
                return `<div class="player-suggestion ${selectedClass}" 
                             onclick="togglePlayer(event, '${player.replace(/'/g, "\\'")}')"
                             data-player="${player.replace(/"/g, '&quot;')}">
                            <span>${player}</span>
                            ${checkmark}
                        </div>`;
            }).join('');
            
            suggestionsDiv.style.display = 'block';
        }, 200);
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.player-search-container')) {
            suggestionsDiv.style.display = 'none';
        }
    });
    
    // Keep suggestions open when clicking inside
    suggestionsDiv.addEventListener('click', function(e) {
        e.stopPropagation();
    });
}

// Toggle player selection (for multi-select)
function togglePlayer(event, player) {
    event.stopPropagation();
    
    if (selectedPlayers.has(player)) {
        selectedPlayers.delete(player);
    } else {
        selectedPlayers.add(player);
    }
    
    updateSelectedPlayersDisplay();
    
    // Refresh search to update checkmarks
    const searchInput = document.getElementById('player-search');
    searchInput.dispatchEvent(new Event('input'));
}

// Update the display of selected players
function updateSelectedPlayersDisplay() {
    const container = document.getElementById('selected-players');
    
    if (selectedPlayers.size === 0) {
        container.innerHTML = '<div style="color: #aaa; font-style: italic;">No players selected</div>';
        return;
    }
    
    container.innerHTML = Array.from(selectedPlayers).map(player => 
        `<div class="player-chip">
            ${player}
            <span class="player-chip-remove" onclick="removePlayerFilter('${player.replace(/'/g, "\\'")}')">&times;</span>
        </div>`
    ).join('');
}

// Remove a player from the filter
function removePlayerFilter(player) {
    selectedPlayers.delete(player);
    updateSelectedPlayersDisplay();
    
    // Refresh search to update checkmarks
    const searchInput = document.getElementById('player-search');
    if (searchInput.value) {
        searchInput.dispatchEvent(new Event('input'));
    }
    
    if (selectedYears.size > 0) {
        updateDiagram();
    }
}

// Clear all player filters
function clearPlayerFilter() {
    selectedPlayers.clear();
    updateSelectedPlayersDisplay();
    document.getElementById('player-search').value = '';
    document.getElementById('player-suggestions').style.display = 'none';
    
    if (selectedYears.size > 0) {
        updateDiagram();
    }
}

// Set player filter mode
function setFilterMode(mode) {
    playerFilterMode = mode;
    document.getElementById('mode-show').classList.toggle('active', mode === 'show');
    document.getElementById('mode-hide').classList.toggle('active', mode === 'hide');
    
    if (selectedPlayers.size > 0 && selectedYears.size > 0) {
        updateDiagram();
    }
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
        
        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const matches = teamsData.teams.filter(team => 
                team.toLowerCase().includes(query)
            ).slice(0, 20);
            
            if (matches.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            
            suggestionsDiv.innerHTML = matches.map(team => {
                const isSelected = selectedTeams.has(team);
                const checkmark = isSelected ? '<span class="checkmark">✓</span>' : '';
                const selectedClass = isSelected ? 'selected' : '';
                const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
                return `<div class="player-suggestion ${selectedClass}" 
                             onclick="toggleTeam(event, '${team.replace(/'/g, "\\'")}')"
                             style="border-left: 4px solid ${color}">
                            <span>${team}</span>
                            ${checkmark}
                        </div>`;
            }).join('');
            
            suggestionsDiv.style.display = 'block';
        }, 200);
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#team-search') && !e.target.closest('#team-suggestions')) {
            suggestionsDiv.style.display = 'none';
        }
    });
}

// Toggle team selection
function toggleTeam(event, team) {
    event.stopPropagation();
    
    if (selectedTeams.has(team)) {
        selectedTeams.delete(team);
    } else {
        selectedTeams.add(team);
    }
    
    updateSelectedTeamsDisplay();
    
    // Refresh search to update checkmarks
    const searchInput = document.getElementById('team-search');
    searchInput.dispatchEvent(new Event('input'));
}

// Update selected teams display
function updateSelectedTeamsDisplay() {
    const container = document.getElementById('selected-teams');
    
    if (selectedTeams.size === 0) {
        container.innerHTML = '<div style="color: #aaa; font-style: italic;">No teams selected</div>';
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

// Remove team filter
function removeTeamFilter(team) {
    selectedTeams.delete(team);
    updateSelectedTeamsDisplay();
    
    const searchInput = document.getElementById('team-search');
    if (searchInput.value) {
        searchInput.dispatchEvent(new Event('input'));
    }
    
    if (selectedYears.size > 0) {
        updateDiagram();
    }
}

// Clear team filter
function clearTeamFilter() {
    selectedTeams.clear();
    updateSelectedTeamsDisplay();
    document.getElementById('team-search').value = '';
    document.getElementById('team-suggestions').style.display = 'none';
    
    if (selectedYears.size > 0) {
        updateDiagram();
    }
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

// Connection filter controls
function increaseConnections() {
    const input = document.getElementById('connection-input');
    const newValue = Math.min(150, parseInt(input.value) + 1);
    input.value = newValue;
    updateConnectionsFromInput();
}

function decreaseConnections() {
    const input = document.getElementById('connection-input');
    const newValue = Math.max(1, parseInt(input.value) - 1);
    input.value = newValue;
    updateConnectionsFromInput();
}

function updateConnectionsFromInput() {
    const input = document.getElementById('connection-input');
    const slider = document.getElementById('connection-slider');
    const display = document.getElementById('connection-value');
    
    let value = parseInt(input.value);
    
    // Validate
    if (isNaN(value) || value < 1) value = 1;
    if (value > 150) value = 150;
    
    input.value = value;
    slider.value = value;
    minConnections = value;
    
    display.textContent = `${value}+ connection${value === 1 ? '' : 's'}`;
    
    // Auto-update diagram if data is loaded
    if (selectedYears.size > 0) {
        updateDiagram();
    }
}

// Update selected years display
function updateSelectedYearsDisplay() {
    document.getElementById('selected-years').textContent = selectedYears.size;
    
    // Update year buttons
    document.querySelectorAll('.year-btn').forEach(btn => {
        const year = parseInt(btn.dataset.year);
        if (selectedYears.has(year)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Load suggested plot presets
function loadSuggestedPlot(plotId) {
    // Clear existing filters first
    selectedYears.clear();
    selectedPlayers.clear();
    selectedTeams.clear();
    
    const plots = {
        elite13: {
            name: "Elite 13",
            years: 'all',
            minConnections: 100,
            players: [],
            teams: [],
            playerMode: 'show',
            teamMode: 'show'
        },
        halloffame: {
            name: "Hall of Fame Inductees",
            years: 'all',
            minConnections: 1,
            players: [
                'Jim Thome', 'Roberto Alomar', 'Kenny Lofton', 'Don Mattingly',
                'Darryl Strawberry', 'Dave Winfield', 'Wade Boggs',
                'Kirby Puckett', 'Ryne Sandberg', 'Ozzie Smith', 'Gary Carter',
                'Dennis Eckersley', 'Rickey Henderson', 'Paul Molitor', 'Eddie Murray',
                'Nolan Ryan', 'George Brett', 'Robin Yount', 'Andre Dawson',
                'Tim Raines', 'Barry Larkin', 'Frank Thomas', 'Jeff Bagwell',
                'Craig Biggio', 'Ivan Rodriguez', 'Mike Piazza'
            ],
            teams: [],
            playerMode: 'show',
            teamMode: 'show'
        },
        allstars: {
            name: "All-Star Selections",
            years: 'all',
            minConnections: 1,
            players: [
                'Jim Thome', 'Kenny Lofton', 'Manny Ramirez', 'Roberto Alomar',
                'Sandy Alomar, Jr', 'Albert Belle', 'Carlos Baerga', 'Omar Vizquel',
                'Don Mattingly', 'Darryl Strawberry', 'Wade Boggs', 'Frank Thomas',
                'Will Clark', 'Matt Williams', 'Barry Bonds', 'Randy Johnson',
                'Greg Maddux', 'Pedro Martinez', 'Chipper Jones', 'Derek Jeter',
                'David Ortiz', 'Mariano Rivera', 'Ivan Rodriguez', 'Mike Piazza'
            ],
            teams: [],
            playerMode: 'show',
            teamMode: 'show'
        },
        '1992boom': {
            name: "1992 Boom",
            years: [1992],
            minConnections: 1,
            players: ['Rico Brogna'],
            teams: [],
            playerMode: 'show',
            teamMode: 'show'
        },
        indians90s: {
            name: "90s Indians Dynasty",
            years: [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999],
            minConnections: 5,
            players: [],
            teams: ['Cleveland Indians'],
            playerMode: 'show',
            teamMode: 'show'
        },
        alrivalry: {
            name: "AL East Rivalry",
            years: 'all',
            minConnections: 10,
            players: [],
            teams: ['New York Yankees', 'Boston Red Sox', 'Baltimore Orioles'],
            playerMode: 'show',
            teamMode: 'show'
        },
        starpower: {
            name: "Star Power",
            years: 'all',
            minConnections: 50,
            players: [],
            teams: [],
            playerMode: 'show',
            teamMode: 'show'
        },
        crosstown: {
            name: "Crosstown Classics",
            years: 'all',
            minConnections: 5,
            players: [],
            teams: ['Chicago Cubs', 'Chicago White Sox', 'New York Mets', 'New York Yankees'],
            playerMode: 'show',
            teamMode: 'show'
        },
        jeffrobinson: {
            name: "Jeff Robinson - #1 Most Connected",
            years: 'all',
            minConnections: 1,
            players: ['Jeff Robinson'],
            teams: [],
            playerMode: 'show',
            teamMode: 'show'
        },
        westcoast: {
            name: "West Coast Battle",
            years: [1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999],
            minConnections: 10,
            players: [],
            teams: ['Los Angeles Dodgers', 'San Francisco Giants', 'Oakland Athletics'],
            playerMode: 'show',
            teamMode: 'show'
        }
    };
    
    const plot = plots[plotId];
    if (!plot) return;
    
    console.log(`🎬 Loading suggested plot: ${plot.name}`);
    
    // Set years
    if (plot.years === 'all') {
        networkData.years.forEach(year => selectedYears.add(year));
    } else {
        plot.years.forEach(year => selectedYears.add(year));
    }
    
    // Set players
    plot.players.forEach(player => selectedPlayers.add(player));
    playerFilterMode = plot.playerMode;
    
    // Set teams
    plot.teams.forEach(team => selectedTeams.add(team));
    teamFilterMode = plot.teamMode;
    
    // Set min connections
    minConnections = plot.minConnections;
    document.getElementById('connection-input').value = plot.minConnections;
    document.getElementById('connection-slider').value = plot.minConnections;
    document.getElementById('connection-value').textContent = `${plot.minConnections}+ connection${plot.minConnections === 1 ? '' : 's'}`;
    
    // Update UI
    updateSelectedYearsDisplay();
    updateSelectedPlayersDisplay();
    updateSelectedTeamsDisplay();
    
    // Update mode buttons
    document.getElementById('mode-show').classList.toggle('active', playerFilterMode === 'show');
    document.getElementById('mode-hide').classList.toggle('active', playerFilterMode === 'hide');
    document.getElementById('team-mode-show').classList.toggle('active', teamFilterMode === 'show');
    document.getElementById('team-mode-hide').classList.toggle('active', teamFilterMode === 'hide');
    
    // Load the network
    updateDiagram();
    
    // Show notification
    setTimeout(() => {
        alert(`✨ Loaded: ${plot.name}\n\nExplore this curated view of your collection!`);
    }, 100);
}

// Toggle player name labels
function toggleLabels() {
    labelsVisible = !labelsVisible;
    const btn = document.getElementById('toggle-labels-btn');
    
    if (labelsVisible) {
        btn.textContent = '🏷️ Hide Names';
        btn.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    } else {
        btn.textContent = '🏷️ Show Names';
        btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
    
    // Update labels visibility
    if (label) {
        label.style('display', labelsVisible ? 'block' : 'none');
    }
}

// Start the application when DOM is ready
window.addEventListener('DOMContentLoaded', loadData);