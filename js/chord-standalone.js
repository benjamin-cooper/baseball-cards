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
    generateChordDiagram(container);
}

// Generate chord diagram
function generateChordDiagram(container) {
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
        container.innerHTML = `
            <div style="text-align: center; padding: 100px; color: white;">
                <h2>No connections found</h2>
                <p>Try adjusting your filters or selecting more years.</p>
            </div>
        `;
        return;
    }
    
    // Build team-to-team connection matrix
    const playerTeams = {};
    const teams = new Set();
    
    // Track which teams each player was on
    filteredEdges.forEach(e => {
        teams.add(e.team);
        
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
    drawChordDiagram(container, teamArray, matrix);
}

// Draw the chord diagram using D3
function drawChordDiagram(container, teams, matrix) {
    const width = Math.min(container.clientWidth - 40, 1200);
    const height = Math.min(container.clientHeight - 40, 1200);
    const outerRadius = Math.min(width, height) * 0.5 - 100;
    const innerRadius = outerRadius - 30;
    
    const svg = d3.select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("id", "chord-svg");
    
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
    
    const chords = chord(matrix);
    
    // Create color map
    const teamColors = teams.map(team => 
        teamColorsData.teamColors[team] || teamColorsData.defaultColor
    );
    
    // Create tooltip
    const tooltip = d3.select("body")
        .append("div")
        .attr("class", "chord-tooltip")
        .style("position", "absolute")
        .style("background", "rgba(0, 0, 0, 0.9)")
        .style("color", "white")
        .style("padding", "10px 15px")
        .style("border-radius", "8px")
        .style("pointer-events", "none")
        .style("opacity", 0)
        .style("z-index", 10002);
    
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
