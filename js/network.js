// Network visualization using D3.js

let currentZoom = null;
let nodesVisible = true;  // Control node visibility
let nodeSize = 10;        // Control node size (radius)
let selectedNode = null;  // Track currently selected node

// Initialize the network visualization
function initializeNetwork() {
    tooltip = d3.select("#tooltip");
}

// Update the network with new data
function updateNetwork(edges, players) {
    if (simulation) simulation.stop();
    
    document.getElementById('network-container').innerHTML = '';
    
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
            const factor = 80 / brightness; // How much to brighten
            r = Math.min(255, Math.round(r * factor * 1.5));
            g = Math.min(255, Math.round(g * factor * 1.5));
            b = Math.min(255, Math.round(b * factor * 1.5));
            
            return `rgb(${r}, ${g}, ${b})`;
        }
        
        return hexColor;
    }
    
    // Warn if network is very large
    if (players.length > 500 || edges.length > 10000) {
        console.log(`⚠️ Large network: ${players.length} players, ${edges.length} connections`);
        console.log('💡 Tip: Use filters to reduce network size for better performance');
    }
    
    // Adaptive canvas size based on network size
    // ✨ LANDSCAPE orientation for better website display (export stays portrait)
    let width, height;
    if (players.length < 50) {
        // Small network - use more space per node
        width = 2400;
        height = 1400;  // Changed from 2400 to landscape
    } else if (players.length < 150) {
        // Medium network
        width = 2400;
        height = 1300;  // Changed from 2000 to landscape
    } else {
        // Large network
        width = 2400;
        height = 1200;  // Changed from 1800 to landscape
    }
    
    svg = d3.select("#network-container")
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("id", "poster-svg");
    
    // Set background color to pure black for maximum color contrast
    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "#000000");
    
    // Add custom titles if they exist (BEFORE creating g group so they don't zoom/pan)
    // This ensures titles appear in exports and stay fixed on screen
    let titleHeight = 0; // Track total height used by titles
    if (typeof getCustomOrAutoTitle === 'function') {
        const title = getCustomOrAutoTitle('Player Connection Network');
        const subtitle = getCustomOrAutoSubtitle('');
        
        let titleY = 40;
        
        if (title) {
            svg.append("text")
                .attr("x", width / 2)
                .attr("y", titleY)
                .attr("text-anchor", "middle")
                .attr("font-size", "32px")
                .attr("font-weight", "bold")
                .attr("fill", "#ffffff")
                .attr("font-family", "Roboto, Helvetica Neue, Arial, sans-serif")
                .attr("class", "title-text")  // Class for identification
                .text(title);
            titleY += 40;
            titleHeight = titleY;
        }
        
        if (subtitle) {
            svg.append("text")
                .attr("x", width / 2)
                .attr("y", titleY)
                .attr("text-anchor", "middle")
                .attr("font-size", "20px")
                .attr("fill", "#d0d0d0")
                .attr("font-family", "Roboto, Helvetica Neue, Arial, sans-serif")
                .attr("class", "subtitle-text")  // Class for identification
                .text(subtitle);
            titleHeight = titleY + 30; // Add spacing after subtitle
        }
    }
    
    g = svg.append("g");
    
    currentZoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            // Update LOD based on zoom level
            if (typeof updateLOD === 'function') {
                updateLOD(event.transform.k);
            }
        });
    
    svg.call(currentZoom);
    
    // Add zoom controls
    const zoomControls = d3.select("#network-container")
        .append("div")
        .attr("class", "zoom-controls");
    
    zoomControls.append("button")
        .attr("class", "zoom-btn")
        .html("+")
        .on("click", () => svg.transition().call(currentZoom.scaleBy, 1.3));
    
    zoomControls.append("button")
        .attr("class", "zoom-btn")
        .html("−")
        .on("click", () => svg.transition().call(currentZoom.scaleBy, 0.7));
    
    zoomControls.append("button")
        .attr("class", "zoom-btn")
        .html("⟲")
        .on("click", () => {
            // Reset zoom/pan while preserving selected node
            svg.transition().call(currentZoom.transform, d3.zoomIdentity);
            if (selectedNode) {
                console.log(`📐 View reset - selected node preserved: ${selectedNode.id}`);
            }
        });
    
    // Create nodes and links
    const nodes = players.map(player => ({
        id: player,
        name: player
    }));
    
    // Transform player-team edges into player-player connections
    // Players are connected if they played on the same team in the same year
    const playerTeamYears = {};
    
    edges.forEach(e => {
        const key = `${e.team}-${e.year}`;
        if (!playerTeamYears[key]) {
            playerTeamYears[key] = [];
        }
        playerTeamYears[key].push(e.from);
    });
    
    // Create links between players on the same team
    const links = [];
    Object.entries(playerTeamYears).forEach(([teamYear, playerList]) => {
        // Connect each pair of players on this team
        for (let i = 0; i < playerList.length; i++) {
            for (let j = i + 1; j < playerList.length; j++) {
                const [team, year] = teamYear.split('-');
                links.push({
                    source: playerList[i],
                    target: playerList[j],
                    team: team,
                    year: parseInt(year)
                });
            }
        }
    });
    
    console.log(`🔗 Created ${links.length} player-to-player connections from ${edges.length} player-team edges`);
    
    // ✨ FIX: Remove players with 0 connections
    // Count connections per player
    const playerConnectionCount = {};
    links.forEach(link => {
        playerConnectionCount[link.source] = (playerConnectionCount[link.source] || 0) + 1;
        playerConnectionCount[link.target] = (playerConnectionCount[link.target] || 0) + 1;
    });
    
    // Filter nodes to only include players with connections
    const connectedPlayers = new Set(Object.keys(playerConnectionCount));
    const filteredNodes = nodes.filter(node => connectedPlayers.has(node.id));
    
    const removedCount = nodes.length - filteredNodes.length;
    if (removedCount > 0) {
        console.log(`🧹 Removed ${removedCount} isolated players with 0 connections`);
    }
    
    // Use filtered nodes for the rest of the visualization
    const finalNodes = filteredNodes;
    
    // Show loading message with progress
    const container = document.getElementById('network-container');
    const loadingDiv = container.querySelector('.loading');
    if (loadingDiv) {
        loadingDiv.textContent = `Preparing network: ${nodes.length} players, ${links.length} connections...`;
    }
    
    // Create force simulation with adaptive settings based on network size
    const nodeCount = finalNodes.length;
    const linkCount = links.length;
    
    // Adaptive settings for better performance
    let linkDistance = 80;
    let linkStrength = 0.3;
    let chargeStrength = -300;
    let alphaDecay = 0.02;
    let velocityDecay = 0.3;
    let collisionRadius = 35;
    
    if (nodeCount > 500) {
        // Large network - optimize for speed
        linkDistance = 60;
        linkStrength = 0.2;
        chargeStrength = -200;
        alphaDecay = 0.05; // Faster settling
        velocityDecay = 0.4; // More friction
        collisionRadius = 30;
        console.log('🚀 Using optimized settings for large network');
    } else if (nodeCount > 200) {
        // Medium network - balanced
        linkDistance = 70;
        linkStrength = 0.25;
        chargeStrength = -250;
        alphaDecay = 0.03;
        velocityDecay = 0.35;
        collisionRadius = 32;
        console.log('⚡ Using balanced settings for medium network');
    }
    
    // Calculate adjusted center Y position to avoid title overlap
    // Add extra padding to ensure network doesn't overlap with titles
    const centerYOffset = Math.max(titleHeight + 50, 0); // Add 50px padding
    const adjustedCenterY = (height / 2) + (centerYOffset / 2);
    
    simulation = d3.forceSimulation(finalNodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(linkDistance).strength(linkStrength))
        .force("charge", d3.forceManyBody().strength(chargeStrength))
        .force("center", d3.forceCenter(width / 2, adjustedCenterY))
        .force("collision", d3.forceCollide().radius(collisionRadius))
        // Add stronger centering force to pull outliers in
        .force("x", d3.forceX(width / 2).strength(0.1))
        .force("y", d3.forceY(adjustedCenterY).strength(0.1))
        // Stronger radial force to keep nodes from spreading too far
        .force("radial", d3.forceRadial(Math.min(width, height) / 3.5, width / 2, adjustedCenterY).strength(0.15))
        .alphaDecay(alphaDecay)
        .velocityDecay(velocityDecay)
        .stop(); // Stop initially so we can warm it up
    
    // Pre-warm the simulation (run initial iterations without rendering)
    // Fewer iterations for large networks to avoid initial delay
    let initialIterations;
    if (nodeCount > 500) {
        initialIterations = 50; // Quick pre-warm for large networks
    } else if (nodeCount > 200) {
        initialIterations = 75; // Medium pre-warm
    } else {
        initialIterations = 100; // Full pre-warm for small networks
    }
    
    console.log(`🔥 Pre-warming with ${initialIterations} iterations`);
    for (let i = 0; i < initialIterations; ++i) {
        simulation.tick();
    }
    
    if (loadingDiv) {
        loadingDiv.textContent = `Rendering visualization...`;
    }
    
    // Draw links with optimization for large networks
    const tooManyLinks = links.length > 5000;
    
    link = g.append("g")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("class", "link")
        .attr("stroke", d => adjustColorForVisibility(teamColorsData.teamColors[d.team] || teamColorsData.defaultColor))
        .attr("stroke-width", tooManyLinks ? 1 : 3) // Thinner lines for many connections
        .attr("opacity", tooManyLinks ? 0.3 : 0.6)
        .on("mouseover", function(event, d) {
            d3.select(this).classed("highlighted", true).attr("opacity", 1);
            tooltip
                .style("opacity", 1)
                .html(`<strong>${d.source.id}</strong> ↔ <strong>${d.target.id}</strong><br><strong>Team:</strong> ${d.team}<br><strong>Year:</strong> ${d.year}`);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.select(this).classed("highlighted", false).attr("opacity", 0.6);
            tooltip.style("opacity", 0);
        });
    
    // Draw nodes
    node = g.append("g")
        .selectAll("g")
        .data(finalNodes)
        .join("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));
    
    node.append("circle")
        .attr("r", nodeSize)
        .attr("fill", d => {
            // Priority: selected node > selected players > default
            if (selectedNode && selectedNode.id === d.id) return "#FFD700"; // Gold for selected
            if (selectedPlayers.has(d.id)) return "#FF6B6B"; // Red for filtered players
            return "#4CAF50"; // Green default
        })
        .attr("stroke", d => (selectedNode && selectedNode.id === d.id) ? "#FFA500" : "white")
        .attr("stroke-width", d => (selectedNode && selectedNode.id === d.id) ? 5 : 3)
        .style("display", nodesVisible ? "block" : "none")  // Control visibility
        .on("click", function(event, d) {
            // Toggle selection on click
            if (selectedNode && selectedNode.id === d.id) {
                selectedNode = null; // Deselect if clicking same node
            } else {
                selectedNode = d; // Select this node
            }
            
            // Update all node styles to reflect selection
            node.selectAll("circle")
                .attr("fill", nd => {
                    if (selectedNode && selectedNode.id === nd.id) return "#FFD700";
                    if (selectedPlayers.has(nd.id)) return "#FF6B6B";
                    return "#4CAF50";
                })
                .attr("stroke", nd => (selectedNode && selectedNode.id === nd.id) ? "#FFA500" : "white")
                .attr("stroke-width", nd => (selectedNode && selectedNode.id === nd.id) ? 5 : 3);
            
            console.log(`🎯 ${selectedNode ? 'Selected' : 'Deselected'} node: ${d.id}`);
        })
        .on("mouseover", function(event, d) {
            // Highlight connected links
            link.classed("highlighted", function(l) {
                return l.source.id === d.id || l.target.id === d.id;
            });
            link.attr("opacity", function(l) {
                return (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.2;
            });
            
            const connections = links.filter(l => 
                l.source.id === d.id || l.target.id === d.id
            );
            
            const teamList = [...new Set(connections.map(c => c.team))].join(', ');
            
            tooltip
                .style("opacity", 1)
                .html(`<strong>${d.name}</strong><br><strong>Connections:</strong> ${connections.length}<br><strong>Teams:</strong> ${teamList}`);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            link.classed("highlighted", false).attr("opacity", 0.6);
            tooltip.style("opacity", 0);
        });
    
    // Add labels - HIDE by default, show when zoomed in or toggled
    const showLabelsInitially = false; // Changed from conditional to always false
    
    label = node.append("text")
        .attr("dx", 0)
        .attr("dy", 25)
        .attr("text-anchor", "middle")
        .attr("font-size", finalNodes.length < 50 ? "14px" : "12px")
        .attr("fill", "white")
        .attr("stroke", "#000")
        .attr("stroke-width", 0.5)
        .attr("paint-order", "stroke")
        .attr("class", "node-label")
        .style("display", "none") // Always hide initially
        .text(d => d.name);
    
    // Keep global state as false
    if (labelsVisible) {
        labelsVisible = false;
        const btn = document.getElementById('toggle-labels-btn');
        if (btn) {
            btn.textContent = '🏷️ Show Names';
            btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
    }
    
    // Update positions on each tick - throttled for performance
    let tickCount = 0;
    let animationFrame = null;
    
    simulation.on("tick", () => {
        tickCount++;
        // Only update every 2nd tick for smoother performance with many nodes
        if (finalNodes.length > 200 && tickCount % 2 !== 0) return;
        
        // Use requestAnimationFrame for smoother rendering
        if (animationFrame) return; // Already scheduled
        
        animationFrame = requestAnimationFrame(() => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            
            node.attr("transform", d => `translate(${d.x},${d.y})`);
            
            animationFrame = null;
        });
    });
    
    // Restart simulation after pre-warming and rendering
    simulation.restart();
    
    // Auto-stop after settling for better performance
    simulation.on("end", () => {
        console.log("✅ Network layout complete");
    });
    
    // Drag functions
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
    
    // Add export buttons at the bottom of the visualization (similar to chord diagram)
    // Remove any existing export buttons first
    const existingExportDiv = container.querySelector('.network-export-buttons');
    if (existingExportDiv) {
        existingExportDiv.remove();
    }
    
    const exportDiv = document.createElement('div');
    exportDiv.className = 'network-export-buttons'; // Unique class name
    exportDiv.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        display: flex;
        gap: 10px;
        z-index: 100;
    `;
    
    // SVG Export Button (with names)
    const exportSVGWithNamesBtn = document.createElement('button');
    exportSVGWithNamesBtn.textContent = '💾 SVG (with names)';
    exportSVGWithNamesBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        border: none;
        color: white;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
    `;
    exportSVGWithNamesBtn.onmouseover = () => {
        exportSVGWithNamesBtn.style.transform = 'translateY(-2px)';
        exportSVGWithNamesBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    };
    exportSVGWithNamesBtn.onmouseout = () => {
        exportSVGWithNamesBtn.style.transform = 'translateY(0)';
        exportSVGWithNamesBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };
    exportSVGWithNamesBtn.onclick = () => {
        if (typeof exportAsSVG === 'function') {
            exportAsSVG(true);
        } else {
            console.error('❌ exportAsSVG not found. Check if export.js is loaded.');
            console.log('Available functions:', Object.keys(window).filter(k => k.includes('export')));
            alert('Export function not available. Please ensure export.js is loaded.\n\nCheck console for details.');
        }
    };
    
    // SVG Export Button (without names)
    const exportSVGNoNamesBtn = document.createElement('button');
    exportSVGNoNamesBtn.textContent = '💾 SVG (no names)';
    exportSVGNoNamesBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, #66bb6a 0%, #4caf50 100%);
        border: none;
        color: white;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
    `;
    exportSVGNoNamesBtn.onmouseover = () => {
        exportSVGNoNamesBtn.style.transform = 'translateY(-2px)';
        exportSVGNoNamesBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    };
    exportSVGNoNamesBtn.onmouseout = () => {
        exportSVGNoNamesBtn.style.transform = 'translateY(0)';
        exportSVGNoNamesBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };
    exportSVGNoNamesBtn.onclick = () => {
        if (typeof exportAsSVG === 'function') {
            exportAsSVG(false);
        } else {
            console.error('❌ exportAsSVG not found. Check if export.js is loaded.');
            alert('Export function not available. Please ensure export.js is loaded.\n\nCheck console for details.');
        }
    };
    
    // PNG Export Button (with names)
    const exportPNGWithNamesBtn = document.createElement('button');
    exportPNGWithNamesBtn.textContent = '📸 PNG (with names)';
    exportPNGWithNamesBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
        border: none;
        color: white;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
    `;
    exportPNGWithNamesBtn.onmouseover = () => {
        exportPNGWithNamesBtn.style.transform = 'translateY(-2px)';
        exportPNGWithNamesBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    };
    exportPNGWithNamesBtn.onmouseout = () => {
        exportPNGWithNamesBtn.style.transform = 'translateY(0)';
        exportPNGWithNamesBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };
    exportPNGWithNamesBtn.onclick = () => {
        if (typeof exportAsPNG === 'function') {
            exportAsPNG(true);
        } else {
            console.error('❌ exportAsPNG not found. Check if export.js is loaded.');
            alert('Export function not available. Please ensure export.js is loaded.\n\nCheck console for details.');
        }
    };
    
    // PNG Export Button (without names)
    const exportPNGNoNamesBtn = document.createElement('button');
    exportPNGNoNamesBtn.textContent = '📸 PNG (no names)';
    exportPNGNoNamesBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, #42A5F5 0%, #2196F3 100%);
        border: none;
        color: white;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
    `;
    exportPNGNoNamesBtn.onmouseover = () => {
        exportPNGNoNamesBtn.style.transform = 'translateY(-2px)';
        exportPNGNoNamesBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    };
    exportPNGNoNamesBtn.onmouseout = () => {
        exportPNGNoNamesBtn.style.transform = 'translateY(0)';
        exportPNGNoNamesBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };
    exportPNGNoNamesBtn.onclick = () => {
        if (typeof exportAsPNG === 'function') {
            exportAsPNG(false);
        } else {
            console.error('❌ exportAsPNG not found. Check if export.js is loaded.');
            alert('Export function not available. Please ensure export.js is loaded.\n\nCheck console for details.');
        }
    };
    
    // Append all buttons to export div
    exportDiv.appendChild(exportSVGWithNamesBtn);
    exportDiv.appendChild(exportSVGNoNamesBtn);
    exportDiv.appendChild(exportPNGWithNamesBtn);
    exportDiv.appendChild(exportPNGNoNamesBtn);
    
    // Make container position relative and append export div
    container.style.position = 'relative';
    container.appendChild(exportDiv);
    
    console.log('✅ Export buttons added to network visualization');
}

// Fit network to screen with smart centering
function fitToScreen() {
    if (!svg || !simulation) {
        alert('Please select at least one year first!');
        return;
    }
    
    const nodes = simulation.nodes();
    if (nodes.length === 0) return;
    
    // Calculate bounding box
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    nodes.forEach(node => {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
    });
    
    // Calculate center of mass (weighted by connections) for better centering
    let centerX = 0, centerY = 0, totalWeight = 0;
    const links = simulation.force("link").links();
    const connectionCounts = {};
    
    // Count connections per node
    links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        connectionCounts[sourceId] = (connectionCounts[sourceId] || 0) + 1;
        connectionCounts[targetId] = (connectionCounts[targetId] || 0) + 1;
    });
    
    // Calculate weighted center
    nodes.forEach(node => {
        const weight = Math.max(1, connectionCounts[node.id] || 1);
        centerX += node.x * weight;
        centerY += node.y * weight;
        totalWeight += weight;
    });
    
    centerX /= totalWeight;
    centerY /= totalWeight;
    
    // Use weighted center for better visual balance
    // But also consider outliers by using a blend
    const blendFactor = 0.7; // 70% weighted center, 30% geometric center
    const geometricCenterX = (minX + maxX) / 2;
    const geometricCenterY = (minY + maxY) / 2;
    
    const finalCenterX = centerX * blendFactor + geometricCenterX * (1 - blendFactor);
    const finalCenterY = centerY * blendFactor + geometricCenterY * (1 - blendFactor);
    
    // Calculate bounding box around the weighted center with padding
    const width = maxX - minX;
    const height = maxY - minY;
    const padding = 100;
    
    const svgElement = document.getElementById('poster-svg');
    const svgWidth = svgElement.clientWidth;
    const svgHeight = svgElement.clientHeight;
    
    // Calculate scale to fit with padding
    const scale = Math.min(
        svgWidth / (width + padding * 2),
        svgHeight / (height + padding * 2),
        2.5 // Max zoom to prevent over-zooming on small networks
    );
    
    // Calculate translation to center the weighted center point
    const translateX = svgWidth / 2 - finalCenterX * scale;
    const translateY = svgHeight / 2 - finalCenterY * scale;
    
    console.log(`📐 Fit to screen: center (${Math.round(finalCenterX)}, ${Math.round(finalCenterY)}), scale ${scale.toFixed(2)}x`);
    
    svg.transition()
        .duration(750)
        .call(
            currentZoom.transform,
            d3.zoomIdentity
                .translate(translateX, translateY)
                .scale(scale)
        );
    
    showNotification('📐 View centered and fitted!', 2000);
}
// Toggle node visibility
function toggleNodes() {
    nodesVisible = !nodesVisible;
    
    if (!node) {
        alert('Please select at least one year first!');
        return;
    }
    
    node.selectAll("circle")
        .style("display", nodesVisible ? "block" : "none");
    
    // Also hide labels when nodes are hidden
    if (!nodesVisible && label) {
        label.style("display", "none");
        // Update label button if it exists
        const labelBtn = document.getElementById('toggle-labels-btn');
        if (labelBtn && labelsVisible) {
            labelsVisible = false;
            labelBtn.textContent = '🏷️ Show Names';
            labelBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
    }
    
    // Update button
    const btn = document.getElementById('toggle-nodes-btn');
    if (btn) {
        if (nodesVisible) {
            btn.textContent = '⚫ Hide Nodes';
            btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        } else {
            btn.textContent = '⚪ Show Nodes';
            btn.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        }
    }
    
    showNotification(nodesVisible ? '⚪ Nodes shown' : '⚫ Nodes hidden', 1500);
}

// Update node size
function updateNodeSize(size) {
    nodeSize = parseInt(size);
    
    if (!node) return;
    
    node.selectAll("circle")
        .attr("r", nodeSize);
    
    // Update label position based on node size
    if (label) {
        label.attr("dy", nodeSize + 15);
    }
    
    // Update slider value display if it exists
    const sizeValue = document.getElementById('node-size-value');
    if (sizeValue) {
        sizeValue.textContent = nodeSize;
    }
}

// Toggle node visibility
function toggleNodes() {
    nodesVisible = !nodesVisible;
    
    if (!node) return;
    
    node.selectAll("circle")
        .style("display", nodesVisible ? "block" : "none");
    
    // Update button text
    const btn = document.getElementById('toggle-nodes-btn');
    if (btn) {
        if (nodesVisible) {
            btn.innerHTML = '⚪ Hide Nodes';
            btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        } else {
            btn.innerHTML = '⚫ Show Nodes';
            btn.style.background = 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)';
        }
    }
    
    console.log(`🔘 Nodes ${nodesVisible ? 'shown' : 'hidden'}`);
}