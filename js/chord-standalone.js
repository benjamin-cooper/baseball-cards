// Standalone Chord Diagram - Separate feature (not a toggle)

// Show chord diagram in a new window/view
function showChordDiagram() {
    if (selectedYears.size === 0) {
        alert('⚠️ Please select at least one year first!\n\nThe chord diagram shows player movement between teams for the selected years.');
        return;
    }
    
    // Create a modal/overlay for the chord diagram
    const modal = document.createElement('div');
    modal.id = 'chord-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;
    
    const container = document.createElement('div');
    container.id = 'chord-container';
    container.style.cssText = `
        background: #1a2332;
        border-radius: 20px;
        padding: 20px;
        max-width: 1400px;
        max-height: 90vh;
        width: 100%;
        overflow: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.8);
        position: relative;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        border: none;
        color: white;
        padding: 10px 20px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        z-index: 10001;
    `;
    closeBtn.onclick = () => modal.remove();
    
    container.appendChild(closeBtn);
    modal.appendChild(container);
    document.body.appendChild(modal);
    
    // Show loading
    container.innerHTML += `
        <div id="chord-loading" style="text-align: center; padding: 100px; color: white;">
            <h2 style="font-size: 2em; margin-bottom: 20px;">🔄 Analyzing Player Movement...</h2>
            <p style="font-size: 1.2em; color: #aaa;">Processing ${selectedYears.size} year${selectedYears.size !== 1 ? 's' : ''} of data</p>
        </div>
    `;
    
    // Close on escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    });
    
    // Generate the chord diagram
    setTimeout(() => {
        // Remove loading message
        const loading = container.querySelector('#chord-loading');
        if (loading) loading.remove();
        
        generateChordDiagram(container);
    }, 100);
}

// Generate chord diagram
function generateChordDiagram(container) {
    console.log('🔄 Starting chord diagram generation...');
    
    // Filter edges by selected years
    let filteredEdges = networkData.edges.filter(e => selectedYears.has(e.year));
    console.log(`📊 Filtered edges: ${filteredEdges.length}`);
    
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
        console.log(`📊 After player filter: ${filteredEdges.length}`);
    }
    
    if (selectedTeams.size > 0) {
        if (teamFilterMode === 'show') {
            filteredEdges = filteredEdges.filter(e => selectedTeams.has(e.team));
        } else {
            filteredEdges = filteredEdges.filter(e => !selectedTeams.has(e.team));
        }
        console.log(`📊 After team filter: ${filteredEdges.length}`);
    }
    
    if (filteredEdges.length === 0) {
        console.warn('⚠️ No filtered edges found');
        container.innerHTML = `
            <div style="text-align: center; padding: 100px 40px; color: white;">
                <h2 style="font-size: 2em; margin-bottom: 20px;">📊 No Connections Found</h2>
                <p style="font-size: 1.2em; color: #aaa; margin-bottom: 30px;">
                    The chord diagram shows players who moved between teams.
                </p>
                <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; max-width: 600px; margin: 0 auto; text-align: left;">
                    <strong style="display: block; margin-bottom: 10px;">Try this:</strong>
                    <ul style="list-style: none; padding: 0;">
                        <li style="padding: 5px 0;">✓ Select multiple teams (need at least 2-3 teams)</li>
                        <li style="padding: 5px 0;">✓ Select more years (more years = more player movement)</li>
                        <li style="padding: 5px 0;">✓ Lower minimum connections filter</li>
                        <li style="padding: 5px 0;">✓ Try "All Years" for the full picture</li>
                    </ul>
                </div>
            </div>
        `;
        return;
    }
    
    // Build team-to-team connection matrix
    // We need to track which players appeared on which teams
    const playerToTeams = {};
    
    // First pass: collect all player-team relationships
    filteredEdges.forEach(e => {
        // Both players in the edge were on this team together
        if (!playerToTeams[e.from]) playerToTeams[e.from] = new Set();
        if (!playerToTeams[e.to]) playerToTeams[e.to] = new Set();
        playerToTeams[e.from].add(e.team);
        playerToTeams[e.to].add(e.team);
    });
    
    // Get all unique teams
    const allTeams = new Set();
    Object.values(playerToTeams).forEach(teamSet => {
        teamSet.forEach(team => allTeams.add(team));
    });
    
    const teamArray = Array.from(allTeams).sort();
    
    // Check if we have enough teams
    if (teamArray.length < 2) {
        container.innerHTML = `
            <div style="text-align: center; padding: 100px 40px; color: white;">
                <h2 style="font-size: 2em; margin-bottom: 20px;">📊 Need More Teams</h2>
                <p style="font-size: 1.2em; color: #aaa; margin-bottom: 30px;">
                    Found only ${teamArray.length} team${teamArray.length !== 1 ? 's' : ''}: <strong>${teamArray.join(', ')}</strong>
                </p>
                <p style="font-size: 1.1em; color: #aaa;">
                    The chord diagram needs at least 2 teams to show player movement between them.
                </p>
                <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; max-width: 600px; margin: 20px auto; text-align: left;">
                    <strong style="display: block; margin-bottom: 10px;">Quick Fixes:</strong>
                    <ul style="list-style: none; padding: 0;">
                        <li style="padding: 5px 0;">✓ Clear team filters (or select more teams)</li>
                        <li style="padding: 5px 0;">✓ Select more years</li>
                        <li style="padding: 5px 0;">✓ Lower minimum connections</li>
                    </ul>
                </div>
            </div>
        `;
        return;
    }
    
    // Count connections between teams (players who played for multiple teams)
    const matrix = Array(teamArray.length).fill(0).map(() => Array(teamArray.length).fill(0));
    
    // For each player, if they played for multiple teams, that's a connection
    Object.values(playerToTeams).forEach(teamSet => {
        const teams = Array.from(teamSet);
        if (teams.length > 1) {
            // This player connects multiple teams
            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    const idx1 = teamArray.indexOf(teams[i]);
                    const idx2 = teamArray.indexOf(teams[j]);
                    if (idx1 !== -1 && idx2 !== -1) {
                        matrix[idx1][idx2]++;
                        matrix[idx2][idx1]++;
                    }
                }
            }
        }
    });
    
    // Check if there are any connections
    const totalConnections = matrix.reduce((sum, row) => sum + row.reduce((s, val) => s + val, 0), 0) / 2;
    
    if (totalConnections === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 100px 40px; color: white;">
                <h2 style="font-size: 2em; margin-bottom: 20px;">📊 No Team Connections</h2>
                <p style="font-size: 1.2em; color: #aaa; margin-bottom: 30px;">
                    Found ${teamArray.length} teams, but no players moved between them in the selected time period.
                </p>
                <p style="font-size: 1.1em; color: #aaa; margin-bottom: 20px;">
                    Teams: <strong>${teamArray.join(', ')}</strong>
                </p>
                <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; max-width: 600px; margin: 0 auto; text-align: left;">
                    <strong style="display: block; margin-bottom: 10px;">This might mean:</strong>
                    <ul style="list-style: none; padding: 0;">
                        <li style="padding: 5px 0;">• Players in your collection didn't move between these specific teams</li>
                        <li style="padding: 5px 0;">• Time period is too narrow to capture movement</li>
                        <li style="padding: 5px 0;">• Minimum connections filter is too high</li>
                    </ul>
                    <strong style="display: block; margin: 20px 0 10px;">Try:</strong>
                    <ul style="list-style: none; padding: 0;">
                        <li style="padding: 5px 0;">✓ Select "All Years" for maximum coverage</li>
                        <li style="padding: 5px 0;">✓ Lower minimum connections to 1</li>
                        <li style="padding: 5px 0;">✓ Try different teams (AL East, NL West, etc.)</li>
                    </ul>
                </div>
            </div>
        `;
        return;
    }
    
    // Success! Draw the diagram
    console.log(`✅ Chord diagram data ready: ${teamArray.length} teams, ${totalConnections} connections`);
    drawChordDiagram(container, teamArray, matrix);
}

// Draw the chord diagram using D3
function drawChordDiagram(container, teams, matrix) {
    // Check if D3 is available
    if (typeof d3 === 'undefined') {
        container.innerHTML = `
            <div style="text-align: center; padding: 100px; color: white;">
                <h2>❌ Error Loading Chord Diagram</h2>
                <p>D3.js library not found. Please refresh the page.</p>
            </div>
        `;
        return;
    }
    
    const width = Math.min(container.clientWidth - 40, 1200);
    const height = Math.min(container.clientHeight - 40, 1200);
    const outerRadius = Math.min(width, height) * 0.5 - 100;
    const innerRadius = outerRadius - 30;
    
    // Clear container first
    container.innerHTML = '';
    
    const svg = d3.select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("id", "chord-svg")
        .style("display", "block")
        .style("margin", "0 auto");
    
    // Set background
    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "#1a2332")
        .attr("rx", 15);
    
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
    
    let chords;
    try {
        chords = chord(matrix);
    } catch (e) {
        console.error('Error creating chord layout:', e);
        container.innerHTML = `
            <div style="text-align: center; padding: 100px; color: white;">
                <h2>❌ Error Creating Diagram</h2>
                <p>Could not process team connection data.</p>
                <p style="color: #aaa; font-size: 0.9em;">Error: ${e.message}</p>
            </div>
        `;
        return;
    }
    
    // Create color map
    const teamColors = teams.map(team => 
        teamColorsData.teamColors[team] || teamColorsData.defaultColor
    );
    
    // Create tooltip - attach to body to avoid z-index issues
    let tooltip = d3.select("#chord-tooltip");
    if (tooltip.empty()) {
        tooltip = d3.select("body")
            .append("div")
            .attr("id", "chord-tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.9)")
            .style("color", "white")
            .style("padding", "10px 15px")
            .style("border-radius", "8px")
            .style("pointer-events", "none")
            .style("opacity", 0)
            .style("z-index", 20000)
            .style("font-size", "14px");
    }
    
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
                .html(`<strong>${teams[d.index]}</strong><br>${d.value} total connections`);
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
        .attr("font-size", "13px")
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
                .html(`
                    <strong>${teams[d.source.index]}</strong> ↔ <strong>${teams[d.target.index]}</strong>
                    <br>${d.source.value} shared players
                `);
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
        .attr("y", 35)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .attr("font-size", "24px")
        .attr("font-weight", "bold")
        .text("Team Connection Chord Diagram");
    
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", 60)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "14px")
        .text(`Showing ${teams.length} teams • Ribbons represent players who moved between teams`);
    
    // Add export button
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '💾 Download SVG';
    exportBtn.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        border: none;
        color: white;
        padding: 10px 20px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
    `;
    exportBtn.onclick = () => exportChordDiagram(svg.node());
    container.appendChild(exportBtn);
    
    console.log(`✅ Chord diagram created with ${teams.length} teams`);
}

// Export chord diagram as SVG
function exportChordDiagram(svgElement) {
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgElement);
    
    if (!source.match(/^<\?xml/)) {
        source = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n' + source;
    }
    
    const blob = new Blob([source], {type: "image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `team-chord-diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showNotification('✅ Chord diagram downloaded!', 2000);
}