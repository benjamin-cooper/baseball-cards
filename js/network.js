// Network visualization using D3.js

let currentZoom = null;

// Initialize the network visualization
function initializeNetwork() {
    tooltip = d3.select("#tooltip");
}

// Update the network with new data
function updateNetwork(edges, players) {
    if (simulation) simulation.stop();
    
    document.getElementById('network-container').innerHTML = '';
    
    const width = 2400;
    const height = 1800;
    
    svg = d3.select("#network-container")
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("id", "poster-svg");
    
    g = svg.append("g");
    
    currentZoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
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
        .on("click", () => svg.transition().call(currentZoom.transform, d3.zoomIdentity));
    
    // Create nodes and links
    const nodes = players.map(player => ({
        id: player,
        name: player
    }));
    
    const links = edges.map(e => ({
        source: e.from,
        target: e.to,
        team: e.team,
        year: e.year
    }));
    
    // Create force simulation
    simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(100).strength(0.5))
        .force("charge", d3.forceManyBody().strength(-500))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(40));
    
    // Draw links
    link = g.append("g")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("class", "link")
        .attr("stroke", d => teamColorsData.teamColors[d.team] || teamColorsData.defaultColor)
        .attr("stroke-width", 3)
        .attr("opacity", 0.6)
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
        .data(nodes)
        .join("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));
    
    node.append("circle")
        .attr("r", 10)
        .attr("fill", d => selectedPlayers.has(d.id) ? "#FF6B6B" : "#4CAF50")
        .attr("stroke", "white")
        .attr("stroke-width", 3)
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
    
    // Add labels
    label = node.append("text")
        .attr("dx", 0)
        .attr("dy", 25)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .attr("fill", "white")
        .attr("stroke", "#000")
        .attr("stroke-width", 0.5)
        .attr("paint-order", "stroke")
        .text(d => d.name);
    
    // Update positions on each tick
    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        
        node.attr("transform", d => `translate(${d.x},${d.y})`);
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
}

// Fit network to screen
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
    
    const width = maxX - minX;
    const height = maxY - minY;
    const padding = 100;
    
    const svgElement = document.getElementById('poster-svg');
    const svgWidth = svgElement.clientWidth;
    const svgHeight = svgElement.clientHeight;
    
    const scale = Math.min(
        svgWidth / (width + padding * 2),
        svgHeight / (height + padding * 2)
    );
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    const translateX = svgWidth / 2 - centerX * scale;
    const translateY = svgHeight / 2 - centerY * scale;
    
    svg.transition()
        .duration(750)
        .call(
            currentZoom.transform,
            d3.zoomIdentity
                .translate(translateX, translateY)
                .scale(scale)
        );
}
