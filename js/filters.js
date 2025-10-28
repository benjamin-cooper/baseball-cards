// Filter functions for year and player selection

// Initialize filters
function initializeFilters() {
    setupYearSelector();
    setupConnectionSlider();
}

// Setup year selector buttons
function setupYearSelector() {
    const selector = document.getElementById('year-selector');
    networkData.years.forEach(year => {
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
    const valueDisplay = document.getElementById('slider-value');
    
    slider.addEventListener('input', function() {
        minConnections = parseInt(this.value);
        valueDisplay.textContent = minConnections + '+ connections';
        updateDiagram();
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
    selectedYears = new Set(networkData.years);
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
    networkData.years.forEach(year => {
        if (Math.floor(year / 10) * 10 === startYear) {
            selectedYears.add(year);
        }
    });
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
    document.getElementById('selected-years').textContent = selectedYears.size;
    
    if (selectedYears.size === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">Select at least one year to view the network...</div>';
        document.getElementById('unique-players').textContent = '0';
        document.getElementById('connection-count').textContent = '0';
        document.getElementById('teams-count').textContent = '0';
        document.getElementById('team-legend').innerHTML = '';
        return;
    }
    
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
    
    if (filteredEdges.length === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">No connections found for current filters.</div>';
        return;
    }
    
    // Get unique players and teams
    const players = new Set();
    const teams = new Set();
    filteredEdges.forEach(e => {
        players.add(e.from);
        players.add(e.to);
        teams.add(e.team);
    });
    
    // Count connections per player
    const connectionCount = {};
    filteredEdges.forEach(e => {
        connectionCount[e.from] = (connectionCount[e.from] || 0) + 1;
        connectionCount[e.to] = (connectionCount[e.to] || 0) + 1;
    });
    
    // Filter by minimum connections
    const qualifiedPlayers = new Set(
        Object.keys(connectionCount).filter(p => connectionCount[p] >= minConnections)
    );
    
    // Filter edges again by qualified players
    filteredEdges = filteredEdges.filter(e => 
        qualifiedPlayers.has(e.from) && qualifiedPlayers.has(e.to)
    );
    
    if (filteredEdges.length === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">No players meet the minimum connection threshold. Try lowering it.</div>';
        return;
    }
    
    // Recount after filtering
    players.clear();
    teams.clear();
    filteredEdges.forEach(e => {
        players.add(e.from);
        players.add(e.to);
        teams.add(e.team);
    });
    
    // Update stats
    document.getElementById('unique-players').textContent = players.size;
    document.getElementById('connection-count').textContent = filteredEdges.length;
    document.getElementById('teams-count').textContent = teams.size;
    
    // Update team legend
    updateTeamLegend(teams);
    
    // Update the network visualization
    updateNetwork(filteredEdges, Array.from(players));
}

// Update team legend
function updateTeamLegend(teams) {
    const legend = document.getElementById('team-legend');
    const sortedTeams = Array.from(teams).sort();
    
    legend.innerHTML = sortedTeams.map(team => {
        const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
        return `<div class="legend-item">
            <span class="legend-color" style="background: ${color}"></span>
            <span class="legend-label">${team}</span>
        </div>`;
    }).join('');
}
