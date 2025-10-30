// Chord Diagram - Replaces Network View (Not a Modal)

// Use var to prevent redeclaration errors if file loaded multiple times
var chordMode = chordMode || false;
var chordButtonInitialized = chordButtonInitialized || false;

// Get chord button
function getChordButton() {
    const btn = document.getElementById('chord-diagram-btn');
    console.log('🔍 Looking for chord button:', btn ? 'Found!' : 'Not found');
    return btn;
}

// Initialize button (called after DOM is ready)
function initChordButton() {
    console.log('🔧 Attempting to initialize chord button...');
    
    if (chordButtonInitialized) {
        console.log('✅ Already initialized');
        return;
    }
    
    const btn = getChordButton();
    if (btn) {
        btn.onclick = function(e) {
            console.log('🖱️ Chord button clicked!');
            showChordDiagram();
        };
        chordButtonInitialized = true;
        console.log('✅ Chord diagram button initialized successfully');
    } else {
        console.log('⏳ Button not ready yet, will retry in 100ms...');
        // Button not ready yet, try again in a moment
        setTimeout(initChordButton, 100);
    }
}

// Auto-initialize when script loads
console.log('📜 chord-redesigned.js loaded');
setTimeout(() => {
    console.log('⏰ Starting initialization timer...');
    initChordButton();
}, 100);

// Toggle between network and chord diagram
function showChordDiagram() {
    console.log('🎯 showChordDiagram() called');
    console.log('   selectedYears.size:', selectedYears ? selectedYears.size : 'undefined');
    
    if (typeof selectedYears === 'undefined') {
        console.error('❌ selectedYears is undefined!');
        alert('⚠️ Data not loaded yet. Please wait a moment and try again.');
        return;
    }
    
    if (selectedYears.size === 0) {
        console.log('⚠️ No years selected');
        alert('⚠️ Please select at least one year first!');
        return;
    }
    
    chordMode = true;
    console.log('🔄 Switching to chord diagram mode...');
    
    // Update button appearance
    const btn = getChordButton();
    if (btn) {
        console.log('   Updating button text to "Back to Network"');
        btn.innerHTML = `
            <span class="plot-icon">🔙</span>
            <span class="plot-title">Back to Network</span>
            <span class="plot-desc">Return to player connection view</span>
        `;
        // Re-attach click handler after innerHTML change
        btn.onclick = function(e) {
            console.log('🖱️ Back button clicked!');
            returnToNetwork();
        };
    }
    
    // Hide the "Show Names" control (not relevant for chord)
    const namesControl = document.querySelector('.instructions').nextElementSibling;
    if (namesControl) {
        namesControl.style.display = 'none';
        console.log('   Hidden "Show Names" control');
    }
    
    // Generate and display chord diagram
    console.log('   Calling generateAndDisplayChord()...');
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
                    selectedPlayers.has(e.from)
                );
            } else {
                filteredEdges = filteredEdges.filter(e => 
                    !selectedPlayers.has(e.from)
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
        
        // ✨ FIXED: Apply minimum connections filter
        // Count how many teams each player has
        const playerTeamCount = {};
        filteredEdges.forEach(e => {
            if (!playerTeamCount[e.from]) {
                playerTeamCount[e.from] = new Set();
            }
            if (!playerTeamCount[e.to]) {
                playerTeamCount[e.to] = new Set();
            }
            playerTeamCount[e.from].add(e.team);
            playerTeamCount[e.to].add(e.team);
        });
        
        // Only include players with minConnections+ teams
        const qualifiedPlayers = new Set(
            Object.keys(playerTeamCount).filter(p => playerTeamCount[p].size >= minConnections)
        );
        
        console.log(`   Qualified players (${minConnections}+ teams): ${qualifiedPlayers.size} of ${Object.keys(playerTeamCount).length}`);
        
        // Filter to only include edges where BOTH players are qualified
        filteredEdges = filteredEdges.filter(e => 
            qualifiedPlayers.has(e.from) && qualifiedPlayers.has(e.to)
        );
        
        if (filteredEdges.length === 0) {
            console.warn('⚠️ No edges after filtering');
            showChordError('No Connections Found', 
                'No player connections found for the selected filters.',
                ['Select more years', 'Clear player/team filters', 'Lower minimum connections']);
            return;
        }
        
        // ✨ FIXED: Build team-to-team connection matrix
        const playerToTeams = {};
        
        // Track teams for BOTH players in each edge
        filteredEdges.forEach(e => {
            if (!playerToTeams[e.from]) {
                playerToTeams[e.from] = new Set();
            }
            if (!playerToTeams[e.to]) {
                playerToTeams[e.to] = new Set();
            }
            playerToTeams[e.from].add(e.team);
            playerToTeams[e.to].add(e.team);
        });
        
        console.log(`   Found ${Object.keys(playerToTeams).length} unique players`);
        
        // Get all unique teams from qualified players
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
        
        // ✨ FIXED: Filter teams to only include those with 2+ qualified players
        const teamQualifiedPlayerCount = {};
        Object.entries(playerToTeams).forEach(([player, teamSet]) => {
            teamSet.forEach(team => {
                if (!teamQualifiedPlayerCount[team]) {
                    teamQualifiedPlayerCount[team] = new Set();
                }
                teamQualifiedPlayerCount[team].add(player);
            });
        });
        
        // Only include teams with 2+ qualified players
        const qualifiedTeams = new Set(
            Object.keys(teamQualifiedPlayerCount).filter(team => 
                teamQualifiedPlayerCount[team].size >= 2
            )
        );
        
        console.log(`   Qualified teams (2+ qualified players): ${qualifiedTeams.size} of ${teamArray.length}`);
        
        // Filter to only qualified teams
        const filteredTeamArray = teamArray.filter(team => qualifiedTeams.has(team));
        
        if (filteredTeamArray.length < 2) {
            console.warn('⚠️ Not enough qualified teams');
            showChordError('Not Enough Teams', 
                `Only ${filteredTeamArray.length} team(s) have 2+ players with ${minConnections}+ connections.`,
                ['Lower minimum connections', 'Select more years', 'Clear team filters']);
            return;
        }
        
        // Rebuild playerToTeams with only qualified teams
        const filteredPlayerToTeams = {};
        Object.entries(playerToTeams).forEach(([player, teamSet]) => {
            const qualifiedTeamsForPlayer = Array.from(teamSet).filter(team => qualifiedTeams.has(team));
            if (qualifiedTeamsForPlayer.length > 0) {
                filteredPlayerToTeams[player] = new Set(qualifiedTeamsForPlayer);
            }
        });
        
        // Build connection matrix
        const matrix = Array(filteredTeamArray.length).fill(0).map(() => Array(filteredTeamArray.length).fill(0));
        
        Object.values(filteredPlayerToTeams).forEach(teamSet => {
            const teams = Array.from(teamSet);
            if (teams.length > 1) {
                for (let i = 0; i < teams.length; i++) {
                    for (let j = i + 1; j < teams.length; j++) {
                        const idx1 = filteredTeamArray.indexOf(teams[i]);
                        const idx2 = filteredTeamArray.indexOf(teams[j]);
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
                `Found ${filteredTeamArray.length} teams but no players moved between them.`,
                ['Select "All Years" to see more movement', 'Lower minimum connections to 1', 'Try different teams']);
            return;
        }
        
        // Success - draw the diagram
        console.log('✅ Drawing chord diagram...');
        drawChordDiagram(container, filteredTeamArray, matrix);
        
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
    
    // Function to adjust dark colors for better visibility on black background
    function adjustColorForVisibility(hexColor) {
        // Convert hex to RGB
        const hex = hexColor.replace('#', '');
        let r = parseInt(hex.substr(0, 2), 16);
        let g = parseInt(hex.substr(2, 2), 16);
        let b = parseInt(hex.substr(4, 2), 16);
        
        // Calculate perceived brightness (0-255)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        
        // If color is too dark (brightness < 80), lighten it
        if (brightness < 80) {
            // Lighten by increasing RGB values proportionally
            const factor = 80 / brightness;
            r = Math.min(255, Math.round(r * factor * 1.5));
            g = Math.min(255, Math.round(g * factor * 1.5));
            b = Math.min(255, Math.round(b * factor * 1.5));
            
            return `rgb(${r}, ${g}, ${b})`;
        }
        
        return hexColor;
    }
    
    container.innerHTML = '';
    
    const containerWidth = container.clientWidth;
    const containerHeight = Math.max(container.clientHeight, 1200);
    
    // Reserve space for title at top with more breathing room
    const titleHeight = 240;
    const availableHeight = containerHeight - titleHeight - 150;
    
    const size = Math.min(containerWidth - 150, availableHeight, 800);
    const outerRadius = size * 0.40;
    const innerRadius = outerRadius - 30;
    
    const svg = d3.select(container)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
        .attr("id", "chord-svg")
        .style("display", "block");
    
    // Background - pure black for better team color visibility
    svg.append("rect")
        .attr("width", containerWidth)
        .attr("height", containerHeight)
        .attr("fill", "#000000");
    
    // Create group for zoomable content (title stays fixed, diagram zooms)
    const zoomGroup = svg.append("g");
    
    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.5, 3])
        .on("zoom", (event) => {
            zoomGroup.attr("transform", event.transform);
        });
    
    svg.call(zoom);
    
    // Add zoom controls
    const zoomControls = d3.select(container)
        .append("div")
        .attr("class", "zoom-controls");
    
    zoomControls.append("button")
        .attr("class", "zoom-btn")
        .html("+")
        .on("click", () => svg.transition().call(zoom.scaleBy, 1.3));
    
    zoomControls.append("button")
        .attr("class", "zoom-btn")
        .html("−")
        .on("click", () => svg.transition().call(zoom.scaleBy, 0.7));
    
    zoomControls.append("button")
        .attr("class", "zoom-btn")
        .html("⟲")
        .on("click", () => svg.transition().call(zoom.transform, d3.zoomIdentity));
    
    // ✨ FIXED: Better title handling with custom titles
    // Dynamic subtitle based on filters
    let autoSubtitleParts = [];
    
    // Add year info
    if (selectedYears.size > 0) {
        const years = Array.from(selectedYears).sort((a, b) => a - b);
        if (years.length === 1) {
            autoSubtitleParts.push(`Year: ${years[0]}`);
        } else if (years.length <= 3) {
            autoSubtitleParts.push(`Years: ${years.join(', ')}`);
        } else {
            autoSubtitleParts.push(`${years.length} years (${years[0]}-${years[years.length-1]})`);
        }
    }
    
    // Add team info
    if (selectedTeams.size > 0) {
        autoSubtitleParts.push(`${selectedTeams.size} team${selectedTeams.size === 1 ? '' : 's'} filtered`);
    }
    
    // Add connection filter
    if (minConnections > 1) {
        autoSubtitleParts.push(`${minConnections}+ connections`);
    }
    
    const autoSubtitle = autoSubtitleParts.length > 0 
        ? autoSubtitleParts.join(' | ') 
        : `${teams.length} teams | Player movement`;
    
    // Default auto title for chord diagram
    const autoTitle = "Team Connection Network";
    
    // ✨ CUSTOM TITLES ENABLED - Try to get custom titles with safety checks
    let finalTitle = autoTitle;
    let finalSubtitle = autoSubtitle;
    
    // Check if custom title functions exist and are safe to use
    if (typeof window.getCustomChordTitle === 'function') {
        try {
            const customTitle = window.getCustomChordTitle();
            // Safety check: ensure it's a valid string with no encoding issues
            if (customTitle && typeof customTitle === 'string' && customTitle.trim().length > 0) {
                // Verify it's clean ASCII or valid UTF-8
                const hasWeirdChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/.test(customTitle);
                if (!hasWeirdChars) {
                    finalTitle = customTitle;
                    console.log('✅ Using custom chord title:', customTitle);
                } else {
                    console.warn('⚠️ Custom title has invalid characters, using auto title');
                }
            }
        } catch (e) {
            console.warn('⚠️ Error getting custom chord title:', e);
        }
    }
    
    if (typeof window.getCustomChordSubtitle === 'function') {
        try {
            const customSubtitle = window.getCustomChordSubtitle();
            // Safety check: ensure it's a valid string with no encoding issues
            if (customSubtitle && typeof customSubtitle === 'string' && customSubtitle.trim().length > 0) {
                // Verify it's clean ASCII or valid UTF-8
                const hasWeirdChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/.test(customSubtitle);
                if (!hasWeirdChars) {
                    finalSubtitle = customSubtitle;
                    console.log('✅ Using custom chord subtitle:', customSubtitle);
                } else {
                    console.warn('⚠️ Custom subtitle has invalid characters, using auto subtitle');
                }
            }
        } catch (e) {
            console.warn('⚠️ Error getting custom chord subtitle:', e);
        }
    }
    
    
    console.log('📝 Chord subtitle debug:', {
        autoSubtitleParts,
        autoSubtitle,
        finalSubtitle,
        finalSubtitleLength: finalSubtitle ? finalSubtitle.length : 0,
        finalSubtitleChars: finalSubtitle ? finalSubtitle.split('').map(c => c.charCodeAt(0)) : [],
        selectedYearsSize: selectedYears.size,
        teamsCount: teams.length
    });
    
    // Verify subtitle is clean ASCII
    const hasNonASCII = /[^\x20-\x7E]/.test(finalSubtitle);
    if (hasNonASCII) {
        console.warn('⚠️ Non-ASCII characters detected in subtitle!');
        console.log('Characters:', finalSubtitle.split('').map((c, i) => ({ char: c, code: c.charCodeAt(0), index: i })));
    } else {
        console.log('✅ Subtitle is clean ASCII, length:', finalSubtitle.length);
    }
    
    // Main title - ROBOTO to match Network
    svg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 70)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .attr("font-size", "40px")
        .attr("font-weight", "bold")
        .attr("font-family", "Roboto, Arial, sans-serif")
        .text(finalTitle);
    
    // Subtitle - ROBOTO with explicit rendering
    const subtitleEl = svg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 115)
        .attr("text-anchor", "middle")
        .attr("fill", "#d0d0d0")
        .attr("font-size", "24px")
        .attr("font-weight", "normal")
        .attr("font-family", "Roboto, Arial, sans-serif");
    
    // Set text directly
    subtitleEl.text(finalSubtitle);
    
    console.log('🎨 Subtitle element created:', {
        textContent: subtitleEl.text(),
        textLength: subtitleEl.text().length,
        fontFamily: subtitleEl.attr('font-family'),
        nodeValue: subtitleEl.node().textContent
    });
    
    // Additional info line (hidden in exports) - moved BELOW subtitle
    svg.append("text")
        .attr("class", "chord-info-line")  // Class for hiding during export
        .attr("x", containerWidth / 2)
        .attr("y", 145)
        .attr("text-anchor", "middle")
        .attr("fill", "#666")
        .attr("font-size", "14px")
        .attr("font-family", "Roboto, Arial, sans-serif")
        .text(`${teams.length} teams shown - Hover over ribbons to see player movement`);
    
    // Main group centered BELOW title
    const centerY = titleHeight + (availableHeight / 2);
    const g = zoomGroup.append("g")
        .attr("transform", `translate(${containerWidth / 2}, ${centerY})`);
    
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
    
    // Team colors with visibility adjustment
    const teamColors = teams.map(team => 
        adjustColorForVisibility(teamColorsData.teamColors[team] || teamColorsData.defaultColor)
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
    
    // Export buttons
    const exportDiv = document.createElement('div');
    exportDiv.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        display: flex;
        gap: 10px;
        z-index: 100;
    `;
    
    const exportSVGBtn = document.createElement('button');
    exportSVGBtn.textContent = '💾 Export SVG';
    exportSVGBtn.style.cssText = `
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
    exportSVGBtn.onclick = () => exportChordDiagramSVG();
    
    const exportPNGBtn = document.createElement('button');
    exportPNGBtn.textContent = '📸 Export PNG';
    exportPNGBtn.style.cssText = `
        padding: 12px 24px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        color: white;
        border-radius: 25px;
        cursor: pointer;
        font-size: 15px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    exportPNGBtn.onclick = () => exportChordDiagramPNG();
    
    exportDiv.appendChild(exportSVGBtn);
    exportDiv.appendChild(exportPNGBtn);
    container.style.position = 'relative';
    container.appendChild(exportDiv);
    
    console.log(`✅ Chord diagram rendered with ${teams.length} teams`);
}

// Export chord diagram as SVG
function exportChordDiagramSVG() {
    const svgElement = document.getElementById('chord-svg');
    if (!svgElement) return;
    
    // Clone the SVG so we don't modify the original
    const svgClone = svgElement.cloneNode(true);
    
    // Remove the info line (teams shown, hover instructions)
    const infoLine = svgClone.querySelector('.chord-info-line');
    if (infoLine) {
        infoLine.remove();
    }
    
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgClone);
    
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
        showNotification('✅ Chord diagram SVG exported!', 2000);
    } else {
        console.log('✅ Chord diagram SVG exported!');
    }
}

// Export chord diagram as PNG
function exportChordDiagramPNG() {
    const svgElement = document.getElementById('chord-svg');
    if (!svgElement) {
        alert('No chord diagram found to export!');
        return;
    }
    
    if (typeof showNotification === 'function') {
        showNotification('⏳ Generating PNG... This may take a few seconds.', 5000);
    }
    
    setTimeout(() => {
        try {
            // Get SVG dimensions
            const viewBox = svgElement.getAttribute('viewBox');
            const [, , origWidth, origHeight] = viewBox.split(' ').map(Number);
            
            // Clone the SVG
            const svgClone = svgElement.cloneNode(true);
            
            // Remove the info line (teams shown, hover instructions)
            const infoLine = svgClone.querySelector('.chord-info-line');
            if (infoLine) {
                infoLine.remove();
            }
            
            // Set explicit dimensions for rendering at original size
            svgClone.setAttribute('width', origWidth);
            svgClone.setAttribute('height', origHeight);
            
            // Serialize the SVG
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svgClone);
            
            // Create a blob from the SVG
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            
            // Create an image to load the SVG
            const img = new Image();
            
            img.onload = function() {
                // Render directly at final 5X resolution - NO double-scaling to prevent blur
                const targetWidth = 2400;
                const targetHeight = 1800;
                const scale = 5; // 5x for ultra-high quality (12000×9000)
                
                const finalCanvas = document.createElement('canvas');
                finalCanvas.width = targetWidth * scale;  // 12000 pixels
                finalCanvas.height = targetHeight * scale; // 9000 pixels
                
                const finalCtx = finalCanvas.getContext('2d', { alpha: false });
                
                // Enable high-quality rendering
                finalCtx.imageSmoothingEnabled = true;
                finalCtx.imageSmoothingQuality = 'high';
                
                // Fill background
                finalCtx.fillStyle = '#000000';
                finalCtx.fillRect(0, 0, targetWidth * scale, targetHeight * scale);
                
                // Calculate how to fit the original into 4:3
                const origAspect = origWidth / origHeight;
                const targetAspect = targetWidth / targetHeight;
                
                let drawWidth, drawHeight, offsetX, offsetY;
                
                if (origAspect > targetAspect) {
                    // Original is wider - fit to width
                    drawWidth = targetWidth * scale;
                    drawHeight = (targetWidth / origAspect) * scale;
                    offsetX = 0;
                    offsetY = ((targetHeight * scale) - drawHeight) / 2;
                } else {
                    // Original is taller - fit to height
                    drawHeight = targetHeight * scale;
                    drawWidth = (targetHeight * origAspect) * scale;
                    offsetX = ((targetWidth * scale) - drawWidth) / 2;
                    offsetY = 0;
                }
                
                // Draw SVG directly at 5X resolution (no intermediate scaling)
                finalCtx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
                
                // Convert canvas to PNG blob with MAXIMUM quality
                finalCanvas.toBlob(function(blob) {
                    if (!blob) {
                        alert('❌ Error creating PNG. Please try SVG export instead.');
                        return;
                    }
                    
                    // Create download link
                    const pngUrl = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = pngUrl;
                    link.download = `team-chord-diagram-${Date.now()}.png`;
                    document.body.appendChild(link);
                    link.click();
                    
                    // Cleanup
                    setTimeout(() => {
                        document.body.removeChild(link);
                        URL.revokeObjectURL(pngUrl);
                        URL.revokeObjectURL(url);
                    }, 100);
                    
                    if (typeof showNotification === 'function') {
                        showNotification('✅ Chord diagram PNG exported!', 3000);
                    } else {
                        console.log('✅ Chord diagram PNG exported!');
                    }
                }, 'image/png', 1.0); // Maximum quality
            };
            
            img.onerror = function() {
                console.error('Failed to load SVG for PNG conversion');
                alert('❌ Failed to export PNG. Please try SVG export instead.');
                URL.revokeObjectURL(url);
            };
            
            // Load the SVG
            img.src = url;
            
        } catch (error) {
            console.error('PNG Export Error:', error);
            alert('❌ Error creating PNG: ' + error.message);
        }
    }, 100);
}