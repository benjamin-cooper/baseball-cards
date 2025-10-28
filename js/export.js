// Export functions for SVG and PNG

// Create legend SVG with smart placement
function createLegendSVG(teams, nodes = []) {
    const legendWidth = 2400;
    const itemsPerRow = 6;
    const legendHeight = Math.ceil(teams.length / itemsPerRow) * 40 + 60;
    
    // Determine best placement (top, bottom, or side) based on node positions
    let placement = 'top'; // default
    
    if (nodes && nodes.length > 0) {
        // Calculate node density in different areas
        const topDensity = nodes.filter(n => n.y < 300).length;
        const bottomDensity = nodes.filter(n => n.y > 1500).length;
        const middleDensity = nodes.filter(n => n.y >= 300 && n.y <= 1500).length;
        
        // Choose placement with least density
        if (bottomDensity < topDensity && bottomDensity < middleDensity) {
            placement = 'bottom';
        } else if (middleDensity < topDensity && middleDensity < bottomDensity) {
            placement = 'side';
        } else {
            placement = 'top';
        }
        
        console.log(`📍 Legend placement: ${placement} (top: ${topDensity}, bottom: ${bottomDensity}, middle: ${middleDensity})`);
    }
    
    let legendSVG = '';
    
    if (placement === 'side') {
        // Vertical legend on the right side
        const legendWidth = 350;
        const legendHeight = teams.length * 30 + 60;
        
        legendSVG = `
            <g class="legend-group" transform="translate(2050, 100)">
                <rect width="${legendWidth}" height="${legendHeight}" fill="rgba(26, 35, 50, 0.95)" rx="10" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
                <text x="${legendWidth / 2}" y="35" text-anchor="middle" font-size="20" fill="white" font-weight="bold">Team Colors</text>
        `;
        
        teams.sort().forEach((team, i) => {
            const y = i * 30 + 65;
            const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
            
            legendSVG += `
                <rect x="15" y="${y}" width="20" height="20" fill="${color}" stroke="white" stroke-width="1"/>
                <text x="45" y="${y + 15}" font-size="13" fill="white" font-family="Segoe UI, sans-serif">${team}</text>
            `;
        });
        
        legendSVG += `</g>`;
        return { svg: legendSVG, height: 0, placement: 'side', width: legendWidth };
    } else {
        // Horizontal legend (top or bottom)
        legendSVG = `
            <g class="legend-group" transform="translate(0, 0)">
                <rect width="${legendWidth}" height="${legendHeight}" fill="rgba(26, 35, 50, 0.95)" rx="10" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
                <text x="${legendWidth / 2}" y="35" text-anchor="middle" font-size="24" fill="white" font-weight="bold">Team Color Legend</text>
        `;
        
        const itemWidth = legendWidth / itemsPerRow;
        
        teams.sort().forEach((team, i) => {
            const row = Math.floor(i / itemsPerRow);
            const col = i % itemsPerRow;
            const x = col * itemWidth + 20;
            const y = row * 40 + 60;
            
            const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
            
            legendSVG += `
                <rect x="${x}" y="${y}" width="20" height="20" fill="${color}" stroke="white" stroke-width="1"/>
                <text x="${x + 30}" y="${y + 15}" font-size="14" fill="white" font-family="Segoe UI, sans-serif">${team}</text>
            `;
        });
        
        legendSVG += `</g>`;
        return { svg: legendSVG, height: legendHeight, placement: placement, width: legendWidth };
    }
}

// Export network as SVG
function exportAsSVG(includeNames = true) {
    const svgElement = document.getElementById('poster-svg');
    if (!svgElement) {
        alert('Please select at least one year first!');
        return;
    }
    
    // Get current teams for legend
    const teams = Array.from(new Set(
        networkData.edges
            .filter(e => selectedYears.has(e.year))
            .map(e => e.team)
    ));
    
    // Get node positions for smart placement
    const nodes = simulation ? simulation.nodes() : [];
    
    const svgClone = svgElement.cloneNode(true);
    const legend = createLegendSVG(teams, nodes);
    
    // Remove labels if not requested
    if (!includeNames) {
        svgClone.querySelectorAll('.node-label').forEach(label => label.remove());
    }
    
    const currentHeight = parseInt(svgClone.getAttribute('viewBox').split(' ')[3]) || 1800;
    let totalHeight, totalWidth;
    
    if (legend.placement === 'side') {
        // Side legend - expand width
        totalWidth = 2400 + legend.width + 50;
        totalHeight = currentHeight;
    } else if (legend.placement === 'bottom') {
        // Bottom legend
        totalWidth = 2400;
        totalHeight = currentHeight + legend.height + 40;
    } else {
        // Top legend (default)
        totalWidth = 2400;
        totalHeight = currentHeight + legend.height + 40;
    }
    
    svgClone.setAttribute('width', totalWidth);
    svgClone.setAttribute('height', totalHeight);
    svgClone.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    
    // Add background
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", totalWidth);
    rect.setAttribute("height", totalHeight);
    rect.setAttribute("fill", "#1a2332");
    svgClone.insertBefore(rect, svgClone.firstChild);
    
    // Position main content based on legend placement
    const mainGroup = svgClone.querySelector('g');
    if (mainGroup) {
        if (legend.placement === 'top') {
            // Shift main content down
            const currentTransform = mainGroup.getAttribute('transform') || '';
            mainGroup.setAttribute('transform', `translate(0, ${legend.height + 20}) ${currentTransform}`);
        }
        // For 'bottom' and 'side', no shift needed
    }
    
    // Add legend
    const legendGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    if (legend.placement === 'bottom') {
        // Position at bottom
        legendGroup.innerHTML = legend.svg.replace(
            'transform="translate(0, 0)"',
            `transform="translate(0, ${currentHeight + 20})"`
        );
    } else {
        legendGroup.innerHTML = legend.svg;
    }
    
    if (legend.placement === 'side') {
        svgClone.appendChild(legendGroup);
    } else {
        svgClone.insertBefore(legendGroup, mainGroup);
    }
    
    // Add embedded styles
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
        text { font-family: 'Segoe UI', sans-serif; font-size: 16px; fill: white; text-shadow: 2px 2px 4px rgba(0,0,0,1); font-weight: 600; }
        circle { stroke: white; stroke-width: 3; }
        line { stroke-opacity: 0.5; }
    `;
    defs.appendChild(style);
    svgClone.insertBefore(defs, svgClone.firstChild.nextSibling);
    
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgClone);
    
    if (!source.match(/^<\?xml/)) {
        source = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n' + source;
    }
    
    const blob = new Blob([source], {type: "image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = includeNames ? 'baseball-player-network-with-names.svg' : 'baseball-player-network-no-names.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showNotification(`✅ SVG downloaded ${includeNames ? 'with' : 'without'} names! Legend placed at ${legend.placement}.`, 3000);
}

// Export network as PNG
function exportAsPNG(includeNames = true) {
    const svgElement = document.getElementById('poster-svg');
    if (!svgElement) {
        alert('Please select at least one year first!');
        return;
    }
    
    alert(`⏳ Preparing PNG export ${includeNames ? 'with' : 'without'} names... This may take a few seconds.\n\nClick OK and wait for the download.`);
    
    setTimeout(() => {
        try {
            // Get current teams for legend
            const teams = Array.from(new Set(
                networkData.edges
                    .filter(e => selectedYears.has(e.year))
                    .map(e => e.team)
            ));
            
            // Create a new canvas
            const canvas = document.createElement('canvas');
            const width = 2400;
            const legend = createLegendSVG(teams);
            const totalHeight = 1800 + legend.height + 40;
            
            canvas.width = width;
            canvas.height = totalHeight;
            const ctx = canvas.getContext('2d');
            
            // Fill background
            ctx.fillStyle = '#1a2332';
            ctx.fillRect(0, 0, width, totalHeight);
            
            // Draw legend
            ctx.fillStyle = 'rgba(26, 35, 50, 0.95)';
            ctx.fillRect(0, 0, width, legend.height);
            
            ctx.fillStyle = 'white';
            ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Team Color Legend', width / 2, 30);
            
            // Draw legend items
            const sortedTeams = teams.sort();
            const itemsPerRow = 6;
            const itemWidth = width / itemsPerRow;
            
            ctx.font = '14px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'left';
            
            sortedTeams.forEach((team, i) => {
                const row = Math.floor(i / itemsPerRow);
                const col = i % itemsPerRow;
                const x = col * itemWidth + 20;
                const y = row * 40 + 60;
                
                // Draw color box
                const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 20, 20);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, 20, 20);
                
                // Draw team name
                ctx.fillStyle = 'white';
                ctx.fillText(team, x + 30, y + 15);
            });
            
            // Now draw the network
            const networkY = legend.height + 20;
            
            // Get all links and nodes
            const links = d3.selectAll('#poster-svg line').nodes();
            const nodes = d3.selectAll('#poster-svg circle').nodes();
            const labels = d3.selectAll('#poster-svg text').nodes();
            
            // Get current transform
            const transform = d3.zoomTransform(svg.node());
            
            ctx.save();
            ctx.translate(0, networkY);
            ctx.translate(transform.x, transform.y);
            ctx.scale(transform.k, transform.k);
            
            // Draw links
            links.forEach(link => {
                const x1 = parseFloat(link.getAttribute('x1'));
                const y1 = parseFloat(link.getAttribute('y1'));
                const x2 = parseFloat(link.getAttribute('x2'));
                const y2 = parseFloat(link.getAttribute('y2'));
                const stroke = link.getAttribute('stroke');
                const strokeWidth = parseFloat(link.getAttribute('stroke-width'));
                
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth;
                ctx.globalAlpha = 0.5;
                ctx.stroke();
                ctx.globalAlpha = 1;
            });
            
            // Draw nodes
            nodes.forEach(node => {
                const parent = node.parentElement;
                const transform = parent.getAttribute('transform');
                const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
                if (!match) return;
                
                const cx = parseFloat(match[1]);
                const cy = parseFloat(match[2]);
                const r = parseFloat(node.getAttribute('r'));
                const fill = node.getAttribute('fill');
                
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, 2 * Math.PI);
                ctx.fillStyle = fill;
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 3;
                ctx.stroke();
            });
            
            // Draw labels (if requested)
            if (includeNames) {
                ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'white';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                
                labels.forEach(label => {
                    const parent = label.parentElement;
                    const transform = parent.getAttribute('transform');
                    const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
                    if (!match) return;
                    
                    const text = label.textContent;
                    const x = parseFloat(match[1]) + parseFloat(label.getAttribute('dx') || 0);
                    const y = parseFloat(match[2]) + parseFloat(label.getAttribute('dy') || 0);
                    
                    if (text && !isNaN(x) && !isNaN(y)) {
                        ctx.fillText(text, x, y);
                    }
                });
            }
            
            ctx.restore();
            
            // Convert to PNG
            canvas.toBlob(function(blob) {
                if (!blob) {
                    alert('❌ Error creating PNG. Please try again or use SVG export.');
                    return;
                }
                
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                const suffix = includeNames ? 'with-names' : 'no-names';
                link.download = `baseball-player-network-${suffix}-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                
                setTimeout(() => {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 100);
                
                alert(`✅ PNG downloaded successfully ${includeNames ? 'with' : 'without'} player names!`);
            }, 'image/png');
            
        } catch (error) {
            console.error('PNG Export Error:', error);
            alert('❌ Error creating PNG: ' + error.message + '\n\nPlease try the SVG export instead.');
        }
    }, 100);
}