// Chord Diagram - Replaces Network View (Not a Modal)

let chordMode = false;
let chordButtonInitialized = false;

// Get chord button
function getChordButton() {
    return document.getElementById('chord-diagram-btn');
}

// Initialize button (called after DOM is ready)
function initChordButton() {
    if (chordButtonInitialized) return;
    
    const btn = getChordButton();
    if (btn) {
        btn.onclick = showChordDiagram;
        chordButtonInitialized = true;
        console.log('✅ Chord diagram button initialized');
    } else {
        // Button not ready yet, try again in a moment
        setTimeout(initChordButton, 100);
    }
}

// Auto-initialize when script loads
setTimeout(initChordButton, 100);

// Toggle between network and chord diagram
function showChordDiagram() {
    if (selectedYears.size === 0) {
        alert('⚠️ Please select at least one year first!');
        return;
    }
    
    chordMode = true;
    console.log('🔄 Switching to chord diagram mode...');
    
    // Update button appearance
    const btn = getChordButton();
    if (btn) {
        btn.innerHTML = `
            <span class="plot-icon">🔙</span>
            <span class="plot-title">Back to Network</span>
            <span class="plot-desc">Return to player connection view</span>
        `;
        // Re-attach click handler after innerHTML change
        btn.onclick = returnToNetwork;
    }
    
    // Hide the "Show Names" control (not relevant for chord)
    const namesControl = document.querySelector('.instructions').nextElementSibling;
    if (namesControl) namesControl.style.display = 'none';
    
    // Generate and display chord diagram
    generateAndDisplayChord();
}

function returnToNetwork() {
    chordMode = false;
    console.log('🔄 Returning to network view...');
    
    // Update button appearance
    const btn = getChordButton();
    if (btn) {
        btn.innerHTML = `
            <span class="plot-icon">🔄</span>
            <span class="plot-title">Team Chord Diagram</span>
            <span class="plot-desc">View team-to-team player movement</span>
        `;
        // Re-attach click handler after innerHTML change
        btn.onclick = showChordDiagram;
    }
    
    // Show the "Show Names" control again
    const namesControl = document.querySelector('.instructions').nextElementSibling;
    if (namesControl) namesControl.style.display = 'flex';
    
    // Redraw network
    updateDiagram();
}

// Generate and display chord diagram
function generateAndDisplayChord() {
    const container = document.getElementById('network-container');
    
    try {
        console.log('📊 Generating chord diagram data...');
        
        // Filter edges by selected years
        let filteredEdges = networkData.edges.filter(e => selectedYears.has(e.year));
        console.log(`   Found ${filteredEdges.length} edges for selected years`);
        
        // Apply player filters
        if (selectedPlayers.size > 0) {
            const beforeCount = filteredEdges.length;
            if (playerFilterMode === 'show') {
                filteredEdges = filteredEdges.filter(e => 
                    selectedPlayers.has(e.from) || selectedPlayers.has(e.to)
                );
            } else {
                filteredEdges = filteredEdges.filter(e => 
                    !selectedPlayers.has(e.from) && !selectedPlayers.has(e.to)
                );
            }
            console.log(`   After player filter: ${filteredEdges.length} (was ${beforeCount})`);
        }
        
        // Apply team filters
        if (selectedTeams.size > 0) {
            const beforeCount = filteredEdges.length;
            if (teamFilterMode === 'show') {
                filteredEdges = filteredEdges.filter(e => selectedTeams.has(e.team));
            } else {
                filteredEdges = filteredEdges.filter(e => !selectedTeams.has(e.team));
            }
            console.log(`   After team filter: ${filteredEdges.length} (was ${beforeCount})`);
        }
        
        if (filteredEdges.length === 0) {
            console.warn('⚠️ No edges after filtering');
            showChordError('No Connections Found', 
                'No player connections found for the selected filters.',
                ['Select more years', 'Clear player/team filters', 'Lower minimum connections']);
            return;
        }
        
        // Build team-to-team connection matrix
        const playerToTeams = {};
        
        filteredEdges.forEach(e => {
            if (!playerToTeams[e.from]) playerToTeams[e.from] = new Set();
            if (!playerToTeams[e.to]) playerToTeams[e.to] = new Set();
            playerToTeams[e.from].add(e.team);
            playerToTeams[e.to].add(e.team);
        });
        
        console.log(`   Found ${Object.keys(playerToTeams).length} unique players`);
        
        // Get all unique teams
        const allTeams = new Set();
        Object.values(playerToTeams).forEach(teamSet => {
            teamSet.forEach(team => allTeams.add(team));
        });
        
        const teamArray = Array.from(allTeams).sort();
        console.log(`   Found ${teamArray.length} unique teams: ${teamArray.join(', ')}`);
        
        if (teamArray.length < 2) {
            console.warn('⚠️ Need at least 2 teams');
            showChordError('Need More Teams', 
                `Found only ${teamArray.length} team${teamArray.length !== 1 ? 's' : ''}: ${teamArray.join(', ')}`,
                ['Clear team filter to see all teams', 'Select 2+ teams', 'Select more years']);
            return;
        }
        
        // Build connection matrix
        const matrix = Array(teamArray.length).fill(0).map(() => Array(teamArray.length).fill(0));
        
        Object.values(playerToTeams).forEach(teamSet => {
            const teams = Array.from(teamSet);
            if (teams.length > 1) {
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
        
        // Check for connections
        const totalConnections = matrix.reduce((sum, row) => 
            sum + row.reduce((s, val) => s + val, 0), 0) / 2;
        
        console.log(`   Total connections: ${totalConnections}`);
        
        if (totalConnections === 0) {
            console.warn('⚠️ No team-to-team connections');
            showChordError('No Player Movement', 
                `Found ${teamArray.length} teams but no players moved between them.`,
                ['Select "All Years" to see more movement', 'Lower minimum connections to 1', 'Try different teams']);
            return;
        }
        
        // Success - draw the diagram
        console.log('✅ Drawing chord diagram...');
        drawChordDiagram(container, teamArray, matrix);
        
    } catch (error) {
        console.error('❌ Error generating chord diagram:', error);
        showChordError('Error', 
            `Failed to generate chord diagram: ${error.message}`,
            ['Check browser console for details', 'Try refreshing the page', 'Report this issue']);
    }
}

// Hook into the global updateDiagram to check if we're in chord mode
const originalUpdateDiagram = window.updateDiagram;
if (originalUpdateDiagram) {
    window.updateDiagram = function() {
        if (chordMode) {
            // Stay in chord mode, just regenerate chord diagram
            console.log('🔄 Filter changed, updating chord diagram...');
            generateAndDisplayChord();
        } else {
            // Normal network update
            originalUpdateDiagram.apply(this, arguments);
        }
    };
}

// Show error message in network container
function showChordError(title, message, suggestions) {
    const container = document.getElementById('network-container');
    container.innerHTML = `
        <div style="text-align: center; padding: 100px 40px; color: white; max-width: 800px; margin: 0 auto;">
            <h2 style="font-size: 2.5em; margin-bottom: 20px;">📊 ${title}</h2>
            <p style="font-size: 1.3em; color: #aaa; margin-bottom: 30px; line-height: 1.5;">
                ${message}
            </p>
            <div style="background: rgba(255,255,255,0.1); padding: 25px; border-radius: 15px; text-align: left;">
                <strong style="display: block; margin-bottom: 15px; font-size: 1.2em;">💡 Try this:</strong>
                <ul style="list-style: none; padding: 0; font-size: 1.1em;">
                    ${suggestions.map(s => `<li style="padding: 8px 0; padding-left: 30px; position: relative;">
                        <span style="position: absolute; left: 0;">✓</span> ${s}
                    </li>`).join('')}
                </ul>
            </div>
            <button onclick="returnToNetwork()" style="
                margin-top: 30px;
                padding: 15px 30px;
                background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
                border: none;
                color: white;
                border-radius: 25px;
                cursor: pointer;
                font-size: 1.1em;
                font-weight: bold;
            ">🔙 Back to Network View</button>
        </div>
    `;
}

// Draw the chord diagram
function drawChordDiagram(container, teams, matrix) {
    // Check D3 availability
    if (typeof d3 === 'undefined') {
        console.error('❌ D3.js not loaded');
        showChordError('Library Error', 'D3.js visualization library not found.', ['Refresh the page', 'Check internet connection']);
        return;
    }
    
    container.innerHTML = '';
    
    const containerWidth = container.clientWidth;
    const containerHeight = Math.max(container.clientHeight, 1000);
    const size = Math.min(containerWidth - 100, containerHeight - 200, 1200);
    const outerRadius = size * 0.45;
    const innerRadius = outerRadius - 30;
    
    const svg = d3.select(container)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
        .attr("id", "chord-svg")
        .style("display", "block");
    
    // Background
    svg.append("rect")
        .attr("width", containerWidth)
        .attr("height", containerHeight)
        .attr("fill", "#1a2332");
    
    // Main group centered
    const g = svg.append("g")
        .attr("transform", `translate(${containerWidth / 2}, ${containerHeight / 2})`);
    
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
        console.error('❌ Chord layout error:', e);
        showChordError('Layout Error', 'Could not create chord layout.', ['Try different filters', 'Check console for details']);
        return;
    }
    
    // Team colors
    const teamColors = teams.map(team => 
        teamColorsData.teamColors[team] || teamColorsData.defaultColor
    );
    
    // Tooltip
    let tooltip = d3.select("#chord-tooltip");
    if (tooltip.empty()) {
        tooltip = d3.select("body")
            .append("div")
            .attr("id", "chord-tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.95)")
            .style("color", "white")
            .style("padding", "12px 18px")
            .style("border-radius", "8px")
            .style("pointer-events", "none")
            .style("opacity", 0)
            .style("z-index", 10000)
            .style("font-size", "15px")
            .style("box-shadow", "0 4px 12px rgba(0,0,0,0.5)");
    }
    
    // Draw team arcs
    const group = g.append("g")
        .selectAll("g")
        .data(chords.groups)
        .join("g");
    
    group.append("path")
        .attr("fill", d => teamColors[d.index])
        .attr("stroke", "white")
        .attr("stroke-width", 2)
        .attr("d", arc)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.selectAll(".ribbon")
                .style("opacity", r => 
                    r.source.index === d.index || r.target.index === d.index ? 0.9 : 0.1
                );
            tooltip
                .style("opacity", 1)
                .html(`<strong>${teams[d.index]}</strong><br>${d.value} total connections`);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.selectAll(".ribbon").style("opacity", 0.75);
            tooltip.style("opacity", 0);
        });
    
    // Team labels
    group.append("text")
        .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
        .attr("dy", ".35em")
        .attr("transform", d => `
            rotate(${(d.angle * 180 / Math.PI - 90)})
            translate(${outerRadius + 25})
            ${d.angle > Math.PI ? "rotate(180)" : ""}
        `)
        .attr("text-anchor", d => d.angle > Math.PI ? "end" : "start")
        .attr("fill", "white")
        .attr("font-size", "14px")
        .attr("font-weight", "bold")
        .style("text-shadow", "2px 2px 4px rgba(0,0,0,0.8)")
        .text(d => teams[d.index]);
    
    // Draw ribbons
    g.append("g")
        .selectAll("path")
        .data(chords)
        .join("path")
        .attr("class", "ribbon")
        .attr("d", ribbon)
        .attr("fill", d => teamColors[d.source.index])
        .attr("stroke", d => d3.rgb(teamColors[d.source.index]).darker())
        .attr("stroke-width", 1)
        .style("opacity", 0.75)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.select(this).style("opacity", 1).style("stroke-width", 2);
            tooltip
                .style("opacity", 1)
                .html(`
                    <strong>${teams[d.source.index]}</strong> ↔ <strong>${teams[d.target.index]}</strong>
                    <br>${d.source.value} players moved between these teams
                `);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.select(this).style("opacity", 0.75).style("stroke-width", 1);
            tooltip.style("opacity", 0);
        });
    
    // Title
    svg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 40)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .attr("font-size", "28px")
        .attr("font-weight", "bold")
        .text("Team Connection Chord Diagram");
    
    svg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 70)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "16px")
        .text(`${teams.length} teams • Hover over ribbons to see player movement`);
    
    // Export button
    const exportDiv = document.createElement('div');
    exportDiv.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        display: flex;
        gap: 10px;
        z-index: 100;
    `;
    
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '💾 Export SVG';
    exportBtn.style.cssText = `
        padding: 12px 24px;
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        border: none;
        color: white;
        border-radius: 25px;
        cursor: pointer;
        font-size: 15px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    exportBtn.onclick = () => exportChordDiagramSVG();
    
    exportDiv.appendChild(exportBtn);
    container.style.position = 'relative';
    container.appendChild(exportDiv);
    
    console.log(`✅ Chord diagram rendered with ${teams.length} teams`);
}

// Export chord diagram as SVG
function exportChordDiagramSVG() {
    const svgElement = document.getElementById('chord-svg');
    if (!svgElement) return;
    
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
    
    if (typeof showNotification === 'function') {
        showNotification('✅ Chord diagram exported!', 2000);
    }
}