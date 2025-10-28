// Export functions for SVG and PNG

// Create legend SVG
function createLegendSVG(teams) {
    const legendWidth = 2400;
    const legendHeight = Math.ceil(teams.length / 6) * 40 + 60; // 6 teams per row
    
    let legendSVG = `
        <g class="legend-group" transform="translate(0, 0)">
            <rect width="${legendWidth}" height="${legendHeight}" fill="rgba(15, 32, 39, 0.95)" rx="10"/>
            <text x="${legendWidth / 2}" y="30" text-anchor="middle" font-size="24" fill="white" font-weight="bold">Team Color Legend</text>
    `;
    
    const itemsPerRow = 6;
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
    return { svg: legendSVG, height: legendHeight };
}

// Export network as SVG
function exportAsSVG() {
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
    
    const svgClone = svgElement.cloneNode(true);
    const legend = createLegendSVG(teams);
    
    const totalHeight = 1800 + legend.height + 40;
    
    svgClone.setAttribute('width', '2400');
    svgClone.setAttribute('height', totalHeight);
    svgClone.setAttribute('viewBox', `0 0 2400 ${totalHeight}`);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    
    // Add background
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "2400");
    rect.setAttribute("height", totalHeight);
    rect.setAttribute("fill", "#0f2027");
    svgClone.insertBefore(rect, svgClone.firstChild);
    
    // Shift main content down to make room for legend
    const mainGroup = svgClone.querySelector('g');
    if (mainGroup) {
        const currentTransform = mainGroup.getAttribute('transform') || '';
        mainGroup.setAttribute('transform', `translate(0, ${legend.height + 20}) ${currentTransform}`);
    }
    
    // Add legend at top
    const legendGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    legendGroup.innerHTML = legend.svg;
    svgClone.insertBefore(legendGroup, svgClone.children[1]);
    
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
    link.download = 'baseball-player-network.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert('✅ SVG downloaded with team legend!');
}

// Export network as PNG
function exportAsPNG() {
    const svgElement = document.getElementById('poster-svg');
    if (!svgElement) {
        alert('Please select at least one year first!');
        return;
    }
    
    alert('⏳ Preparing PNG export... This may take a few seconds.\n\nClick OK and wait for the download.');
    
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
            ctx.fillStyle = '#0f2027';
            ctx.fillRect(0, 0, width, totalHeight);
            
            // Draw legend
            ctx.fillStyle = 'rgba(15, 32, 39, 0.95)';
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
            
            // Draw labels
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
                link.download = 'baseball-player-network-' + Date.now() + '.png';
                document.body.appendChild(link);
                link.click();
                
                setTimeout(() => {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 100);
                
                alert('✅ PNG downloaded successfully with team legend!');
            }, 'image/png');
            
        } catch (error) {
            console.error('PNG Export Error:', error);
            alert('❌ Error creating PNG: ' + error.message + '\n\nPlease try the SVG export instead.');
        }
    }, 100);
}
