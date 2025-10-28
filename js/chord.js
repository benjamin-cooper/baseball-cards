// Chord Diagram for Team Connections

let chordDiagramVisible = false;

// Toggle between player network and team chord diagram
function toggleVisualization() {
    chordDiagramVisible = !chordDiagramVisible;
    const btn = document.getElementById('toggle-viz-btn');
    
    if (chordDiagramVisible) {
        btn.textContent = '🔄 Show Player Network';
        btn.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        showChordDiagram();
    } else {
        btn.textContent = '🔄 Show Team Connections';
        btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        // Redraw player network
        if (selectedYears.size > 0) {
            updateDiagram();
        }
    }
}

// Create chord diagram showing team-to-team connections
function showChordDiagram() {
    if (selectedYears.size === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">Select at least one year to view team connections...</div>';
        return;
    }
    
    // Filter edges by selected years
    let filteredEdges = networkData.edges.filter(e => selectedYears.has(e.year));
    
    // Apply player and team filters
    if (selectedPlayers.size > 0) {
        if (playerFilterMode === 'show') {
            filteredEdges = filteredEdges.filter(e => 
                selectedPlayers.has(e.from) || selectedPlayers.has(e.to)
            );
        } else {
            filteredEdges = filteredEdges.filter(e => 
                !selectedPlayers.has(e.from) && !selectedPlayers.has(e.to)
            );
        }
    }
    
    if (selectedTeams.size > 0) {
        if (teamFilterMode === 'show') {
            filteredEdges = filteredEdges.filter(e => selectedTeams.has(e.team));
        } else {
            filteredEdges = filteredEdges.filter(e => !selectedTeams.has(e.team));
        }
    }
    
    if (filteredEdges.length === 0) {
        document.getElementById('network-container').innerHTML = 
            '<div class="loading">No connections found for current filters.</div>';
        return;
    }
    
    // Build team-to-team connection matrix
    const teamConnections = {};
    const teams = new Set();
    
    // Group edges by players to find team transitions
    const playerTeams = {};
    filteredEdges.forEach(e => {
        teams.add(e.team);
        
        // Track which teams each player was on
        if (!playerTeams[e.from]) playerTeams[e.from] = new Set();
        if (!playerTeams[e.to]) playerTeams[e.to] = new Set();
        playerTeams[e.from].add(e.team);
        playerTeams[e.to].add(e.team);
    });
    
    // Count connections between teams (players who played for both)
    const teamArray = Array.from(teams).sort();
    const matrix = Array(teamArray.length).fill(0).map(() => Array(teamArray.length).fill(0));
    
    Object.values(playerTeams).forEach(playerTeamSet => {
        const playerTeamArray = Array.from(playerTeamSet);
        for (let i = 0; i < playerTeamArray.length; i++) {
            for (let j = i + 1; j < playerTeamArray.length; j++) {
                const idx1 = teamArray.indexOf(playerTeamArray[i]);
                const idx2 = teamArray.indexOf(playerTeamArray[j]);
                matrix[idx1][idx2]++;
                matrix[idx2][idx1]++;
            }
        }
    });
    
    // Draw chord diagram
    drawChordDiagram(teamArray, matrix);
}

// Draw the chord diagram using D3
function drawChordDiagram(teams, matrix) {
    document.getElementById('network-container').innerHTML = '';
    
    const width = 1200;
    const height = 1200;
    const outerRadius = Math.min(width, height) * 0.5 - 100;
    const innerRadius = outerRadius - 30;
    
    const svg = d3.select("#network-container")
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("id", "chord-svg");
    
    // Set background
    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "#0a1929");
    
    const g = svg.append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);
    
    // Create chord layout
    const chord = d3.chord()
        .padAngle(0.05)
        .sortSubgroups(d3.descending);
    
    const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);
    
    const ribbon = d3.ribbon()
        .radius(innerRadius);
    
    const chords = chord(matrix);
    
    // Create color map
    const teamColors = teams.map(team => 
        teamColorsData.teamColors[team] || teamColorsData.defaultColor
    );
    
    // Draw outer arcs (team segments)
    const group = g.append("g")
        .selectAll("g")
        .data(chords.groups)
        .join("g");
    
    group.append("path")
        .attr("fill", d => teamColors[d.index])
        .attr("stroke", "white")
        .attr("stroke-width", 2)
        .attr("d", arc)
        .on("mouseover", function(event, d) {
            d3.selectAll(".chord")
                .style("opacity", chord => 
                    chord.source.index === d.index || chord.target.index === d.index ? 0.9 : 0.1
                );
            tooltip
                .style("opacity", 1)
                .html(`<strong>${teams[d.index]}</strong><br>${d.value} connections`);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.selectAll(".chord").style("opacity", 0.7);
            tooltip.style("opacity", 0);
        });
    
    // Add team labels
    group.append("text")
        .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
        .attr("dy", ".35em")
        .attr("transform", d => `
            rotate(${(d.angle * 180 / Math.PI - 90)})
            translate(${outerRadius + 20})
            ${d.angle > Math.PI ? "rotate(180)" : ""}
        `)
        .attr("text-anchor", d => d.angle > Math.PI ? "end" : "start")
        .attr("fill", "white")
        .attr("font-size", "12px")
        .attr("font-weight", "bold")
        .text(d => teams[d.index]);
    
    // Draw ribbons (connections between teams)
    g.append("g")
        .attr("fill-opacity", 0.7)
        .selectAll("path")
        .data(chords)
        .join("path")
        .attr("class", "chord")
        .attr("d", ribbon)
        .attr("fill", d => teamColors[d.source.index])
        .attr("stroke", d => d3.rgb(teamColors[d.source.index]).darker())
        .style("opacity", 0.7)
        .on("mouseover", function(event, d) {
            d3.select(this).style("opacity", 1);
            tooltip
                .style("opacity", 1)
                .html(`<strong>${teams[d.source.index]}</strong> ↔ <strong>${teams[d.target.index]}</strong><br>${d.source.value} shared players`);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.select(this).style("opacity", 0.7);
            tooltip.style("opacity", 0);
        });
    
    // Add title
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", 40)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .attr("font-size", "24px")
        .attr("font-weight", "bold")
        .text("Team Connection Chord Diagram");
    
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", 70)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "16px")
        .text("Ribbons show players who moved between teams");
    
    console.log(`✅ Chord diagram created with ${teams.length} teams`);
}
