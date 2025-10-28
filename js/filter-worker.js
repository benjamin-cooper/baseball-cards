// Filter Worker - processes data in background thread
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'filter') {
        const { 
            edges, 
            selectedYears, 
            selectedPlayers, 
            selectedTeams, 
            playerFilterMode, 
            teamFilterMode, 
            minConnections 
        } = data;
        
        // Filter edges by selected years
        let filteredEdges = edges.filter(e => selectedYears.includes(e.year));
        
        // Apply player filter
        if (selectedPlayers.length > 0) {
            if (playerFilterMode === 'show') {
                filteredEdges = filteredEdges.filter(e => 
                    selectedPlayers.includes(e.from) || selectedPlayers.includes(e.to)
                );
            } else {
                filteredEdges = filteredEdges.filter(e => 
                    !selectedPlayers.includes(e.from) && !selectedPlayers.includes(e.to)
                );
            }
        }
        
        // Apply team filter
        if (selectedTeams.length > 0) {
            if (teamFilterMode === 'show') {
                filteredEdges = filteredEdges.filter(e => 
                    selectedTeams.includes(e.team)
                );
            } else {
                filteredEdges = filteredEdges.filter(e => 
                    !selectedTeams.includes(e.team)
                );
            }
        }
        
        // Get unique players and teams
        const players = new Set();
        const teams = new Set();
        filteredEdges.forEach(e => {
            players.add(e.from);
            players.add(e.to);
            teams.add(e.team);
        });
        
        // Count unique teams per player
        const playerTeamCount = {};
        filteredEdges.forEach(e => {
            if (!playerTeamCount[e.from]) {
                playerTeamCount[e.from] = new Set();
            }
            playerTeamCount[e.from].add(e.team);
        });
        
        // Filter by minimum connections - players must have played for minConnections+ teams
        const qualifiedPlayers = new Set(
            Object.keys(playerTeamCount).filter(p => playerTeamCount[p].size >= minConnections)
        );
        
        // Filter edges to only include qualified players
        filteredEdges = filteredEdges.filter(e => 
            qualifiedPlayers.has(e.from)
        );
        
        // Recalculate after player connection filter
        const finalPlayers = new Set();
        const finalTeams = new Set();
        filteredEdges.forEach(e => {
            finalPlayers.add(e.from);
            finalPlayers.add(e.to);
            finalTeams.add(e.team);
        });
        
        // ✨ NEW: Filter teams by minimum qualified players
        // Count how many qualified players each team has
        const teamQualifiedPlayerCount = {};
        filteredEdges.forEach(e => {
            if (qualifiedPlayers.has(e.from)) {
                if (!teamQualifiedPlayerCount[e.team]) {
                    teamQualifiedPlayerCount[e.team] = new Set();
                }
                teamQualifiedPlayerCount[e.team].add(e.from);
            }
        });
        
        // Only include teams that have at least 2 qualified players
        const qualifiedTeams = new Set(
            Object.keys(teamQualifiedPlayerCount).filter(team => 
                teamQualifiedPlayerCount[team].size >= 2
            )
        );
        
        // Filter edges to only include qualified teams
        filteredEdges = filteredEdges.filter(e => 
            qualifiedTeams.has(e.team)
        );
        
        // Final recalculation
        finalPlayers.clear();
        finalTeams.clear();
        filteredEdges.forEach(e => {
            finalPlayers.add(e.from);
            finalPlayers.add(e.to);
            finalTeams.add(e.team);
        });
        
        // Send results back
        self.postMessage({
            type: 'filterComplete',
            data: {
                edges: filteredEdges,
                players: Array.from(finalPlayers),
                teams: Array.from(finalTeams)
            }
        });
    }
};