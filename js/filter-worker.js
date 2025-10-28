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
        
        // Count connections per player
        const connectionCounts = {};
        filteredEdges.forEach(e => {
            connectionCounts[e.from] = (connectionCounts[e.from] || 0) + 1;
            connectionCounts[e.to] = (connectionCounts[e.to] || 0) + 1;
        });
        
        // Filter by minimum connections
        const qualifyingPlayers = new Set(
            Object.entries(connectionCounts)
                .filter(([player, count]) => count >= minConnections)
                .map(([player]) => player)
        );
        
        // Final edge filter
        filteredEdges = filteredEdges.filter(e => 
            qualifyingPlayers.has(e.from) && qualifyingPlayers.has(e.to)
        );
        
        // Recalculate after connection filter
        const finalPlayers = new Set();
        const finalTeams = new Set();
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