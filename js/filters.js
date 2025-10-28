// Filter functions for year and player selection

// Filter cache for performance
const filterCache = new Map();
let lastFilterKey = '';
let updateTimeout = null;
let filterWorker = null;

// Initialize web worker for background processing
try {
    filterWorker = new Worker('js/filter-worker.js');
    console.log('✅ Filter worker initialized');
} catch (e) {
    console.log('⚠️ Worker not available, using main thread');
}

// Initialize filters
function initializeFilters() {
    setupYearSelector();
    setupConnectionSlider();
}

// Setup year selector buttons
function setupYearSelector() {
    const selector = document.getElementById('year-selector');
    
    // Handle both array and object formats
    let years = [];
    if (Array.isArray(networkData)) {
        // Old format: array of edges, extract years from edges
        const yearSet = new Set();
        networkData.forEach(edge => {
            if (edge.year) yearSet.add(edge.year);
        });
        years = Array.from(yearSet).sort((a, b) => a - b);
        console.log('⚠️ Using old networkData format (array). Please regenerate data files.');
    } else if (networkData.years) {
        // New format: object with years array
        years = networkData.years;
    } else {
        console.error('❌ Invalid networkData format');
        return;
    }
    
    years.forEach(year => {
        const btn = document.createElement('button');
        btn.className = 'year-btn';
        btn.textContent = year;
        btn.dataset.year = year;
        btn.onclick = () => toggleYear(year);
        selector.appendChild(btn);
    });
}

// Setup connection slider
function setupConnectionSlider() {
    const slider = document.getElementById('connection-slider');
    const input = document.getElementById('connection-input');
    const valueDisplay = document.getElementById('connection-value');
    
    // Slider changes update input
    slider.addEventListener('input', function() {
        const value = parseInt(this.value);
        input.value = value;
        minConnections = value;
        valueDisplay.textContent = `${value}+ team${value === 1 ? '' : 's'}`;
        updateDiagram();
    });
    
    // Input changes update slider
    input.addEventListener('input', function() {
        const value = parseInt(this.value);
        if (!isNaN(value) && value >= 1 && value <= 150) {
            slider.value = value;
        }
    });
}

// Toggle a single year
function toggleYear(year) {
    if (selectedYears.has(year)) {
        selectedYears.delete(year);
    } else {
        selectedYears.add(year);
    }
    updateYearButtons();
    updateDiagram();
}

// Select a specific year (clear others)
function selectYear(year) {
    selectedYears.clear();
    selectedYears.add(year);
    updateYearButtons();
    updateDiagram();
}

// Select all years
function selectAllYears() {
    if (networkData && networkData.years) {
        selectedYears = new Set(networkData.years);
    }
    updateYearButtons();
    updateDiagram();
}

// Clear all year selections
function clearSelection() {
    selectedYears.clear();
    updateYearButtons();
    updateDiagram();
}

// Select a decade of years
function selectDecade(startYear) {
    selectedYears.clear();
    if (networkData && networkData.years) {
        networkData.years.forEach(year => {
            if (Math.floor(year / 10) * 10 === startYear) {
                selectedYears.add(year);
            }
        });
    }
    updateYearButtons();
    updateDiagram();
}

// Update year button states
function updateYearButtons() {
    document.querySelectorAll('.year-btn').forEach(btn => {
        const year = parseInt(btn.dataset.year);
        if (selectedYears.has(year)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Main update function - filters data and updates visualization
function updateDiagram() {
    // Debounce multiple rapid changes
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
        updateDiagramImmediate();
    }, 100);
}

// Immediate update (after debounce)
function updateDiagramImmediate() {
    document.getElementById('selected-years').textContent = selectedYears.size;
    
    // Generate cache key
    const filterKey = JSON.stringify({
        years: Array.from(selectedYears).sort(),
        players: Array.from(selectedPlayers).sort(),
        teams: Array.from(selectedTeams).sort(),
        playerMode: playerFilterMode,
        teamMode: teamFilterMode,
        minConn: minConnections
    });
    
    // Check cache first
    if (filterCache.has(filterKey) && filterKey === lastFilterKey) {
        console.log('📦 Using cached filter results');
        const cached = filterCache.get(filterKey);
        renderFilteredData(cached.edges, cached.players, cached.teams);
        return;
    }
    
    lastFilterKey = filterKey;
    
    if (selectedYears.size === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">Select at least one year to view the network...</div>';
        document.getElementById('unique-players').textContent = '0';
        document.getElementById('connection-count').textContent = '0';
        document.getElementById('teams-count').textContent = '0';
        document.getElementById('team-legend').innerHTML = '';
        return;
    }
    
    // Show loading message
    const loadingMsg = document.getElementById('network-container').querySelector('.loading');
    if (loadingMsg) {
        loadingMsg.textContent = 'Processing filters...';
    }
    
    // Use web worker for large datasets (10,000+ edges)
    const edgesToProcess = networkData.edges.filter(e => selectedYears.has(e.year));
    
    if (filterWorker && edgesToProcess.length > 10000) {
        console.log('🔄 Using worker for large dataset');
        
        // Setup worker response handler
        filterWorker.onmessage = function(e) {
            if (e.data.type === 'filterComplete') {
                const { edges, players, teams } = e.data.data;
                
                // Cache results
                filterCache.set(filterKey, {
                    edges,
                    players,
                    teams
                });
                
                renderFilteredData(edges, players, teams);
            }
        };
        
        // Send work to worker
        filterWorker.postMessage({
            type: 'filter',
            data: {
                edges: networkData.edges,
                selectedYears: Array.from(selectedYears),
                selectedPlayers: Array.from(selectedPlayers),
                selectedTeams: Array.from(selectedTeams),
                playerFilterMode,
                teamFilterMode,
                minConnections
            }
        });
        
        return; // Exit - worker will call renderFilteredData when done
    }
    
    // Otherwise process on main thread (faster for small datasets)
    console.log('⚡ Processing on main thread');
    
    // Filter edges by selected years
    let filteredEdges = networkData.edges.filter(e => 
        selectedYears.has(e.year)
    );
    
    // Apply player filter
    if (selectedPlayers.size > 0) {
        if (playerFilterMode === 'show') {
            // Show only selected players and their connections
            filteredEdges = filteredEdges.filter(e => 
                selectedPlayers.has(e.from) || selectedPlayers.has(e.to)
            );
        } else {
            // Hide selected players
            filteredEdges = filteredEdges.filter(e => 
                !selectedPlayers.has(e.from) && !selectedPlayers.has(e.to)
            );
        }
    }
    
    // Apply team filter
    if (selectedTeams.size > 0) {
        if (teamFilterMode === 'show') {
            // Show only selected teams
            filteredEdges = filteredEdges.filter(e => 
                selectedTeams.has(e.team)
            );
        } else {
            // Hide selected teams
            filteredEdges = filteredEdges.filter(e => 
                !selectedTeams.has(e.team)
            );
        }
    }
    
    if (filteredEdges.length === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">No connections found for current filters.</div>';
        return;
    }
    
    // Get unique players and teams
    // e.from = player, e.to = another player (teammate), e.team = team name
    const players = new Set();
    const teams = new Set();
    filteredEdges.forEach(e => {
        players.add(e.from);
        players.add(e.to);    // e.to is also a player (teammate)
        teams.add(e.team);    // Only e.team is the team name
    });
    
    // Count unique teams per player (this is the real "connection" count)
    const playerTeamCount = {};
    filteredEdges.forEach(e => {
        if (!playerTeamCount[e.from]) {
            playerTeamCount[e.from] = new Set();
        }
        playerTeamCount[e.from].add(e.team);
    });
    
    // Filter by minimum connections
    // A player needs minConnections TEAMS to be included
    // (e.g., minConnections=2 means player must have played for 2+ teams)
    const qualifiedPlayers = new Set(
        Object.keys(playerTeamCount).filter(p => playerTeamCount[p].size >= minConnections)
    );
    
    console.log(`   Players with ${minConnections}+ teams: ${qualifiedPlayers.size}`);
    
    // Filter edges to only include qualified players
    filteredEdges = filteredEdges.filter(e => 
        qualifiedPlayers.has(e.from)
    );
    
    if (filteredEdges.length === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">No players meet the minimum connection threshold. Try lowering it.</div>';
        return;
    }
    
    // Recount after filtering
    // e.from and e.to are both players, e.team is the team
    players.clear();
    teams.clear();
    filteredEdges.forEach(e => {
        players.add(e.from);
        players.add(e.to);
        teams.add(e.team);
    });
    
    // ✨ NEW: Filter teams by minimum qualified players
    // Count how many qualified players each team has
    const teamQualifiedPlayerCount = {};
    filteredEdges.forEach(e => {
        // Count both players in the connection
        if (qualifiedPlayers.has(e.from)) {
            if (!teamQualifiedPlayerCount[e.team]) {
                teamQualifiedPlayerCount[e.team] = new Set();
            }
            teamQualifiedPlayerCount[e.team].add(e.from);
        }
        if (qualifiedPlayers.has(e.to)) {
            if (!teamQualifiedPlayerCount[e.team]) {
                teamQualifiedPlayerCount[e.team] = new Set();
            }
            teamQualifiedPlayerCount[e.team].add(e.to);
        }
    });
    
    // Only include teams that have at least 2 qualified players
    // (i.e., at least 2 players who each have minConnections+ teams)
    const qualifiedTeams = new Set(
        Object.keys(teamQualifiedPlayerCount).filter(team => 
            teamQualifiedPlayerCount[team].size >= 2
        )
    );
    
    console.log(`   Teams with 2+ qualified players: ${qualifiedTeams.size} (filtered from ${teams.size})`);
    
    // Filter edges to only include qualified teams
    filteredEdges = filteredEdges.filter(e => 
        qualifiedTeams.has(e.team)
    );
    
    if (filteredEdges.length === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">No teams have enough qualified players. Try lowering the minimum connections.</div>';
        return;
    }
    
    // Final recount after team filtering
    // NOTE: Only e.from is a player, e.to and e.team are both teams
    players.clear();
    teams.clear();
    filteredEdges.forEach(e => {
        players.add(e.from);  // Only e.from is a player
        teams.add(e.team);
        teams.add(e.to);      // e.to is also a team
    });
    
    // Cache results for future use
    const playersArray = Array.from(players);
    const teamsArray = Array.from(teams);
    filterCache.set(filterKey, {
        edges: filteredEdges,
        players: playersArray,
        teams: teamsArray
    });
    
    // Render the filtered data
    renderFilteredData(filteredEdges, playersArray, teamsArray);
}

// Render filtered data (separated for reuse)
function renderFilteredData(filteredEdges, playersArray, teamsArray) {
    // Update stats
    document.getElementById('unique-players').textContent = playersArray.length;
    document.getElementById('connection-count').textContent = filteredEdges.length;
    document.getElementById('teams-count').textContent = teamsArray.length;
    
    // Update insights panel
    updateInsightsPanel(playersArray.length, filteredEdges.length, teamsArray.length);
    
    // Update team legend
    updateTeamLegend(new Set(teamsArray));
    
    // Update the network visualization
    updateNetwork(filteredEdges, playersArray);
}

// Update team legend
function updateTeamLegend(teams) {
    const legend = document.getElementById('team-legend');
    const sortedTeams = Array.from(teams).sort();
    
    legend.innerHTML = sortedTeams.map(team => {
        const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
        return `<div class="team-legend-item">
            <div class="team-color-box" style="background-color: ${color}"></div>
            <span>${team}</span>
        </div>`;
    }).join('');
}

// Update insights panel with performance tips
function updateInsightsPanel(playerCount, edgeCount, teamCount) {
    const panel = document.getElementById('insights-panel');
    
    if (playerCount > 500 || edgeCount > 5000) {
        // Large network - show warnings and tips
        panel.className = 'insights-panel warning';
        panel.style.display = 'block';
        panel.innerHTML = `
            <strong>⚠️ Large Network Detected (${playerCount} players, ${edgeCount.toLocaleString()} connections)</strong>
            <ul>
                <li>Try increasing minimum connections to 10+ for faster loading</li>
                <li>Select fewer years or use decade filters</li>
                <li>Use team filters to focus on 2-3 teams</li>
                <li>Labels hidden until you zoom in (zoom > 1.5x)</li>
            </ul>
        `;
    } else if (playerCount > 200) {
        // Medium network - show helpful tips
        panel.className = 'insights-panel';
        panel.style.display = 'block';
        panel.innerHTML = `
            <strong>💡 Network Size: ${playerCount} players, ${edgeCount} connections</strong>
            <ul>
                <li>Drag nodes to rearrange the layout</li>
                <li>Zoom in to see player names</li>
                <li>Hover over players to see their connections</li>
            </ul>
        `;
    } else if (playerCount < 50 && edgeCount < 200) {
        // Small network - encourage exploration
        panel.className = 'insights-panel success';
        panel.style.display = 'block';
        panel.innerHTML = `
            <strong>✅ Focused Network (${playerCount} players, ${edgeCount} connections)</strong>
            <ul>
                <li>Perfect size for detailed analysis!</li>
                <li>Try expanding to more years or teams</li>
                <li>Use "Fit to Screen" for best view</li>
            </ul>
        `;
    } else {
        // Good size - hide panel
        panel.style.display = 'none';
    }
}