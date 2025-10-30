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
        
        // ✨ GET CUSTOM TITLES using the app's title functions
        let customTitleValue = null;
        let customSubtitleValue = null;
        
        if (typeof getCustomOrAutoTitle === 'function') {
            customTitleValue = getCustomOrAutoTitle(null);
            console.log('✅ Got custom title:', customTitleValue);
        } else if (typeof customTitle !== 'undefined' && customTitle) {
            customTitleValue = customTitle;
            console.log('✅ Got custom title from global var:', customTitleValue);
        }
        
        if (typeof getCustomOrAutoSubtitle === 'function') {
            customSubtitleValue = getCustomOrAutoSubtitle(null);
            console.log('✅ Got custom subtitle:', customSubtitleValue);
        } else if (typeof customSubtitle !== 'undefined' && customSubtitle) {
            customSubtitleValue = customSubtitle;
            console.log('✅ Got custom subtitle from global var:', customSubtitleValue);
        }
        
        drawChordDiagram(container, filteredTeamArray, matrix, customTitleValue, customSubtitleValue);
        
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
function drawChordDiagram(container, teams, matrix, customTitle = null, customSubtitle = null) {
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
    
    // ✨ LANDSCAPE ORIENTATION for on-screen display (better for websites)
    // Export will be portrait, but display is landscape to reduce vertical scroll
    const containerWidth = Math.min(container.clientWidth, 2400);  // Landscape width
    const containerHeight = Math.max(container.clientHeight, 1400); // Landscape height (reduced from 2400)
    
    // Reserve space for title at top - increased to prevent label overlap
    const titleHeight = 220; // Increased from 180 to clear team labels at top
    const availableHeight = containerHeight - titleHeight - 80; // Reduced bottom padding
    
    // Reduce diagram size for display to prevent overlap (PNG export uses separate sizing)
    const size = Math.min(containerWidth - 200, availableHeight, 950); // Reduced from 1100
    const outerRadius = size * 0.45; // Reduced from 0.48
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
    
    // ✨ NUCLEAR-LEVEL SANITIZATION - Catch corruption at the source
    function nuclearSanitizeText(text) {
        if (!text) return '';
        
        // Convert to string first
        let cleaned = String(text);
        
        // Step 1: Remove ALL control characters and problematic Unicode
        cleaned = cleaned
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')  // Control characters
            .replace(/[\u200B-\u200F\uFEFF]/g, '')  // Zero-width spaces
            .replace(/[\uFFFD]/g, '')  // Replacement character �
            .replace(/[^\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF]/g, ''); // Keep only safe ranges
        
        // Step 2: Normalize Unicode
        try {
            cleaned = cleaned.normalize('NFKC'); // Canonical decomposition + compatibility
        } catch(e) {
            console.warn('Unicode normalization failed, using raw text');
        }
        
        // Step 3: Replace any remaining non-ASCII with ASCII equivalents
        cleaned = cleaned
            .replace(/[""]/g, '"')
            .replace(/['']/g, "'")
            .replace(/[–—]/g, '-')
            .replace(/[…]/g, '...')
            .replace(/[•]/g, '*');
        
        // Step 4: Final cleanup
        cleaned = cleaned.trim();
        
        console.log('🧹 Sanitization:', { 
            original: text, 
            cleaned: cleaned,
            originalLength: text.length,
            cleanedLength: cleaned.length 
        });
        
        return cleaned;
    }
    
    // ✨ USE PASSED-IN CUSTOM TITLES with NUCLEAR sanitization
    let finalTitle = nuclearSanitizeText(customTitle || autoTitle);
    let finalSubtitle = nuclearSanitizeText(customSubtitle || autoSubtitle);
    
    // ✨ STORE CLEAN SUBTITLE GLOBALLY for PNG export to use
    window._chordCleanTitle = finalTitle;
    window._chordCleanSubtitle = finalSubtitle;
    
    console.log('📝 Using titles:', {
        finalTitle,
        finalSubtitle,
        titleLength: finalTitle.length,
        subtitleLength: finalSubtitle.length
    });
    
    // Main title - ROBOTO to match Network
    svg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 70)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .attr("font-size", "40px")
        .attr("font-weight", "bold")
        .attr("font-family", "Roboto, Arial, sans-serif")
        .style("dominant-baseline", "middle")
        .attr("data-chord-title", "true")
        .text(finalTitle);
    
    // Subtitle - ROBOTO with explicit rendering
    const subtitleEl = svg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 115)
        .attr("text-anchor", "middle")
        .attr("fill", "#d0d0d0")
        .attr("font-size", "24px")
        .attr("font-weight", "normal")
        .attr("font-family", "Roboto, Arial, sans-serif")
        .style("dominant-baseline", "middle")
        .attr("xml:space", "preserve")
        .attr("data-chord-subtitle", "true");
    
    // Set text directly - use sanitized text
    subtitleEl.text(finalSubtitle);
    
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
    
    // Create a defs section for gradients
    const defs = svg.append("defs");
    
    // Create a gradient for each chord ribbon
    chords.forEach((chord, i) => {
        const gradient = defs.append("linearGradient")
            .attr("id", `chord-gradient-${i}`)
            .attr("gradientUnits", "userSpaceOnUse");
        
        // Calculate the gradient direction based on ribbon geometry
        // Get the midpoints of source and target arcs
        const sourceAngle = (chord.source.startAngle + chord.source.endAngle) / 2;
        const targetAngle = (chord.target.startAngle + chord.target.endAngle) / 2;
        
        // Convert angles to coordinates for gradient
        const sourceX = Math.cos(sourceAngle - Math.PI / 2) * innerRadius;
        const sourceY = Math.sin(sourceAngle - Math.PI / 2) * innerRadius;
        const targetX = Math.cos(targetAngle - Math.PI / 2) * innerRadius;
        const targetY = Math.sin(targetAngle - Math.PI / 2) * innerRadius;
        
        gradient.attr("x1", sourceX)
            .attr("y1", sourceY)
            .attr("x2", targetX)
            .attr("y2", targetY);
        
        // Add color stops - source team color to target team color
        gradient.append("stop")
            .attr("offset", "0%")
            .attr("stop-color", teamColors[chord.source.index])
            .attr("stop-opacity", 1);
        
        gradient.append("stop")
            .attr("offset", "100%")
            .attr("stop-color", teamColors[chord.target.index])
            .attr("stop-opacity", 1);
    });
    
    // Draw ribbons with gradients
    g.append("g")
        .selectAll("path")
        .data(chords)
        .join("path")
        .attr("class", "ribbon")
        .attr("d", ribbon)
        .attr("fill", (d, i) => `url(#chord-gradient-${i})`)
        .attr("stroke", d => {
            // Create a blended stroke color
            const sourceColor = d3.rgb(teamColors[d.source.index]);
            const targetColor = d3.rgb(teamColors[d.target.index]);
            return d3.rgb(
                (sourceColor.r + targetColor.r) / 2,
                (sourceColor.g + targetColor.g) / 2,
                (sourceColor.b + targetColor.b) / 2
            ).darker();
        })
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
    
    // ✨ CRITICAL FIX: Only remove title/subtitle, KEEP team labels
    if (window._chordCleanTitle) {
        const titleEl = svgClone.querySelector('text[data-chord-title="true"]');
        if (titleEl) {
            titleEl.textContent = window._chordCleanTitle;
        }
    }
    
    if (window._chordCleanSubtitle) {
        const subtitleEl = svgClone.querySelector('text[data-chord-subtitle="true"]');
        if (subtitleEl) {
            subtitleEl.textContent = window._chordCleanSubtitle;
        }
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
    
    console.log('🎨 Starting PNG export...');
    console.log('   SVG element:', svgElement);
    console.log('   SVG viewBox:', svgElement.getAttribute('viewBox'));
    
    // Longer timeout to ensure SVG is fully rendered
    setTimeout(() => {
        try {
            // ✨ NEW APPROACH: Use canvas rendering for text (bypasses SVG serialization issues)
            const scale = 5;
            const baseWidth = 1800;
            const baseHeight = 2400;
            
            // Create final canvas
            const canvas = document.createElement('canvas');
            canvas.width = baseWidth * scale;
            canvas.height = baseHeight * scale;
            const ctx = canvas.getContext('2d', { alpha: false });
            
            // Scale context
            ctx.scale(scale, scale);
            
            // Fill background
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, baseWidth, baseHeight);
            
            // ✨ DRAW TITLES USING CANVAS (not SVG serialization)
            const titleText = window._chordCleanTitle || 'Team Connection Network';
            const subtitleText = window._chordCleanSubtitle || '';
            
            let currentY = 140; // Moved down from 100
            
            // Draw main title - EVEN LARGER
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 72px Roboto, Arial, sans-serif'; // Increased from 60px
            ctx.textAlign = 'center';
            ctx.fillText(titleText, baseWidth / 2, currentY);
            currentY += 80;
            
            // Draw subtitle - EVEN LARGER
            if (subtitleText) {
                ctx.fillStyle = '#d0d0d0';
                ctx.font = '42px Roboto, Arial, sans-serif'; // Increased from 36px
                ctx.fillText(subtitleText, baseWidth / 2, currentY);
                currentY += 70;
            } else {
                currentY += 40; // Less space if no subtitle
            }
            
            // Now render the SVG diagram
            const svgClone = svgElement.cloneNode(true);
            
            // ✨ CRITICAL: Only remove title/subtitle text, KEEP team labels
            // Title and subtitle have data attributes we added
            const titleEl = svgClone.querySelector('text[data-chord-title="true"]');
            if (titleEl) titleEl.remove();
            
            const subtitleEl = svgClone.querySelector('text[data-chord-subtitle="true"]');
            if (subtitleEl) subtitleEl.remove();
            
            // Remove the info line
            const infoLine = svgClone.querySelector('.chord-info-line');
            if (infoLine) infoLine.remove();
            
            // Get original SVG dimensions
            const viewBox = svgElement.getAttribute('viewBox');
            console.log('📐 Original viewBox:', viewBox);
            
            if (!viewBox) {
                throw new Error('SVG missing viewBox attribute');
            }
            
            const viewBoxParts = viewBox.split(' ').map(Number);
            if (viewBoxParts.length !== 4 || viewBoxParts.some(isNaN)) {
                throw new Error('Invalid viewBox format: ' + viewBox);
            }
            
            const [, , origWidth, origHeight] = viewBoxParts;
            console.log('📐 Parsed dimensions:', origWidth, 'x', origHeight);
            
            svgClone.setAttribute('width', origWidth);
            svgClone.setAttribute('height', origHeight);
            svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            
            // Serialize the SVG (WITH team labels)
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svgClone);
            
            console.log('📄 Serialized SVG length:', svgString.length, 'chars');
            console.log('📄 First 200 chars:', svgString.substring(0, 200));
            
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            console.log('🔗 Created blob URL:', url);
            
            // Load SVG as image
            const img = new Image();
            
            let imageLoaded = false;
            let imageErrored = false;
            
            // Set up a timeout to detect if image never loads
            const loadTimeout = setTimeout(() => {
                if (!imageLoaded && !imageErrored) {
                    console.error('❌ Image load timeout - image did not load within 5 seconds');
                    console.error('   This usually means the SVG cannot be rendered as an image');
                    console.error('   SVG blob URL:', url);
                    alert('❌ PNG export timed out. The chord diagram could not be converted to an image.\n\n' +
                          'Please try exporting as SVG instead.');
                    URL.revokeObjectURL(url);
                }
            }, 5000);
            
            img.onload = function() {
                clearTimeout(loadTimeout);
                imageLoaded = true;
                try {
                    console.log('✅ SVG image loaded successfully');
                    console.log('   Image dimensions:', img.width, 'x', img.height);
                    console.log('   Original SVG dimensions:', origWidth, 'x', origHeight);
                    
                    // Validate dimensions
                    if (!origWidth || !origHeight || origWidth <= 0 || origHeight <= 0) {
                        throw new Error('Invalid SVG dimensions');
                    }
                    
                    // Calculate positioning - MAXIMIZE DIAGRAM SIZE
                    const diagramStartY = currentY + 20; // Minimal gap after titles
                    const availableHeight = baseHeight - diagramStartY - 30; // MINIMAL bottom margin
                    const availableWidth = baseWidth - 40; // Minimal side margins
                    
                    // Calculate scale to fit diagram - MAXIMUM SCALING
                    const scaleX = availableWidth / origWidth;
                    const scaleY = availableHeight / origHeight;
                    const diagramScale = Math.min(scaleX, scaleY, 2.6); // Increased from 2.2x to 2.6x!
                    
                    const drawWidth = origWidth * diagramScale;
                    const drawHeight = origHeight * diagramScale;
                    
                    // Center the diagram perfectly in available space
                    const offsetX = (baseWidth - drawWidth) / 2;
                    const offsetY = diagramStartY + (availableHeight - drawHeight) / 2;
                    
                    console.log('🎨 Chord diagram layout:', {
                        titleStartY: 140,
                        titleEndY: currentY,
                        diagramStartY,
                        availableHeight,
                        availableWidth,
                        scale: diagramScale.toFixed(2),
                        drawSize: `${drawWidth.toFixed(0)}×${drawHeight.toFixed(0)}`,
                        centered: `X=${offsetX.toFixed(0)}, Y=${offsetY.toFixed(0)}`
                    });
                    
                    // Draw the SVG diagram (removed duplicate)
                    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
                    console.log('✅ SVG drawn to canvas');
                    
                    // Convert to PNG
                    canvas.toBlob(function(blob) {
                        if (!blob) {
                            alert('❌ Error creating PNG. Please try SVG export instead.');
                            return;
                        }
                        
                        console.log('✅ PNG blob created:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
                        
                        const pngUrl = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = pngUrl;
                        link.download = `team-chord-diagram-${Date.now()}.png`;
                        document.body.appendChild(link);
                        link.click();
                        
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
                    }, 'image/png', 1.0);
                } catch (error) {
                    console.error('❌ Error in img.onload:', error);
                    alert('❌ Error drawing diagram: ' + error.message);
                    URL.revokeObjectURL(url);
                }
            };
            
            img.onerror = function(error) {
                clearTimeout(loadTimeout);
                imageErrored = true;
                console.error('❌ Failed to load SVG for PNG conversion');
                console.error('   Error:', error);
                console.error('   Image src:', img.src);
                console.error('   SVG string length:', svgString.length);
                console.error('   SVG first 500 chars:', svgString.substring(0, 500));
                
                alert('❌ Failed to load SVG as image. This can happen if:\n' +
                      '1. The SVG contains external resources\n' +
                      '2. Browser security restrictions\n' +
                      '3. Invalid SVG structure\n\n' +
                      'Try exporting as SVG instead, which works more reliably.');
                URL.revokeObjectURL(url);
            };
            
            console.log('🔄 Setting image src to blob URL:', url);
            img.src = url;
            
        } catch (error) {
            console.error('PNG Export Error:', error);
            alert('❌ Error creating PNG: ' + error.message);
        }
    }, 500); // Increased from 100ms to allow SVG to fully render
}