// Enhanced Search with Preview - Show connection counts and metadata

// Get connection count for a player (cached)
const playerConnectionCache = new Map();

function getPlayerConnectionCount(playerName) {
    // Check cache first
    if (playerConnectionCache.has(playerName)) {
        return playerConnectionCache.get(playerName);
    }
    
    // Calculate from current filtered edges
    if (!networkData || !networkData.edges) return 0;
    
    const edges = networkData.edges.filter(e => selectedYears.size === 0 || selectedYears.has(e.year));
    const count = edges.filter(e => e.from === playerName || e.to === playerName).length;
    
    // Cache the result
    playerConnectionCache.set(playerName, count);
    return count;
}

// Get teams for a player
function getPlayerTeams(playerName) {
    if (!networkData || !networkData.edges) return [];
    
    const edges = networkData.edges.filter(e => 
        (e.from === playerName || e.to === playerName) &&
        (selectedYears.size === 0 || selectedYears.has(e.year))
    );
    
    const teams = [...new Set(edges.map(e => e.team))];
    return teams.sort();
}

// Get years for a player
function getPlayerYears(playerName) {
    if (!networkData || !networkData.edges) return [];
    
    const edges = networkData.edges.filter(e => 
        e.from === playerName || e.to === playerName
    );
    
    const years = [...new Set(edges.map(e => e.year))];
    return years.sort();
}

// Get total connections across all years for a player
function getPlayerTotalConnections(playerName) {
    if (!networkData || !networkData.edges) return 0;
    
    return networkData.edges.filter(e => 
        e.from === playerName || e.to === playerName
    ).length;
}

// Enhanced player search with preview
function setupEnhancedPlayerSearch() {
    const searchInput = document.getElementById('player-search');
    const suggestionsDiv = document.getElementById('player-suggestions');
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            playerConnectionCache.clear(); // Clear cache when search cleared
            return;
        }
        
        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const matches = playersData.players.filter(player => 
                player.toLowerCase().includes(query)
            ).slice(0, 20);
            
            if (matches.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            
            // Clear cache for new search
            playerConnectionCache.clear();
            
            // Show suggestions with metadata
            suggestionsDiv.innerHTML = matches.map(player => {
                const isSelected = selectedPlayers.has(player);
                const checkmark = isSelected ? '<span class="checkmark" style="color: #4CAF50; font-size: 1.2em;">✓</span>' : '';
                const selectedClass = isSelected ? 'selected' : '';
                
                // Get player metadata
                const connections = getPlayerTotalConnections(player);
                const teams = getPlayerTeams(player);
                const years = getPlayerYears(player);
                
                const yearRange = years.length > 0 ? 
                    `${Math.min(...years)}-${Math.max(...years)}` : 
                    'N/A';
                
                return `
                    <div class="player-suggestion ${selectedClass}" 
                         onclick="togglePlayer(event, '${player.replace(/'/g, "\\'")}')"
                         data-player="${player.replace(/"/g, '&quot;')}"
                         style="flex-direction: column; align-items: stretch; padding: 10px 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-weight: bold; font-size: 1em;">${player}</span>
                            ${checkmark}
                        </div>
                        <div style="display: flex; gap: 12px; font-size: 0.85em; color: #666; flex-wrap: wrap;">
                            <span style="background: #e3f2fd; padding: 2px 8px; border-radius: 12px; color: #1976d2;">
                                📊 ${connections} connections
                            </span>
                            <span style="background: #f3e5f5; padding: 2px 8px; border-radius: 12px; color: #7b1fa2;">
                                🏟️ ${teams.length} team${teams.length !== 1 ? 's' : ''}
                            </span>
                            <span style="background: #e8f5e9; padding: 2px 8px; border-radius: 12px; color: #388e3c;">
                                📅 ${yearRange}
                            </span>
                        </div>
                    </div>
                `;
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
    
    console.log('✅ Enhanced player search with preview initialized');
}

// Enhanced team search with preview
function setupEnhancedTeamSearch() {
    const searchInput = document.getElementById('team-search');
    const suggestionsDiv = document.getElementById('team-suggestions');
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
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
                const checkmark = isSelected ? '<span class="checkmark" style="color: #4CAF50; font-size: 1.2em;">✓</span>' : '';
                const selectedClass = isSelected ? 'selected' : '';
                const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
                
                // Get team metadata
                const edges = networkData.edges.filter(e => e.team === team);
                const players = new Set();
                edges.forEach(e => {
                    players.add(e.from);
                    players.add(e.to);
                });
                const years = [...new Set(edges.map(e => e.year))].sort();
                const yearRange = years.length > 0 ? 
                    `${Math.min(...years)}-${Math.max(...years)}` : 
                    'N/A';
                
                return `
                    <div class="player-suggestion ${selectedClass}" 
                         onclick="toggleTeam(event, '${team.replace(/'/g, "\\'")}')"
                         style="border-left: 4px solid ${color}; flex-direction: column; align-items: stretch; padding: 10px 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-weight: bold; font-size: 1em;">${team}</span>
                            ${checkmark}
                        </div>
                        <div style="display: flex; gap: 12px; font-size: 0.85em; color: #666; flex-wrap: wrap;">
                            <span style="background: #e3f2fd; padding: 2px 8px; border-radius: 12px; color: #1976d2;">
                                👥 ${players.size} players
                            </span>
                            <span style="background: #f3e5f5; padding: 2px 8px; border-radius: 12px; color: #7b1fa2;">
                                📊 ${edges.length} connections
                            </span>
                            <span style="background: #e8f5e9; padding: 2px 8px; border-radius: 12px; color: #388e3c;">
                                📅 ${yearRange}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
            
            suggestionsDiv.style.display = 'block';
        }, 200);
    });
    
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#team-search') && !e.target.closest('#team-suggestions')) {
            suggestionsDiv.style.display = 'none';
        }
    });
    
    console.log('✅ Enhanced team search with preview initialized');
}

// Override the original search functions in app.js
function initializeEnhancedSearch() {
    // Wait for DOM to be ready
    setTimeout(() => {
        setupEnhancedPlayerSearch();
        setupEnhancedTeamSearch();
    }, 100);
}