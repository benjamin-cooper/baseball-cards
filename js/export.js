// Export functions for SVG and PNG
// VERSION: 2.0 - COMPACT LEGEND FIX
// Last updated: 2025-01-29
console.log('📦 export.js VERSION 2.0 loaded - Compact Legend Fix');
// 
// PNG QUALITY SETTINGS - OPTIMIZED FOR 24" × 18" PRINTS:
// - Target dimensions: 2400 × 1800 pixels (perfect 4:3 aspect ratio for 24" × 18")
// - Scale factor: 5x (produces 12,000 × 9,000 pixel images)
// - Image smoothing: enabled with 'high' quality
// - PNG quality: 1.0 (maximum)
// - Final resolution: 500 DPI at 24" × 18" (professional print quality)
//
// This configuration ensures NO white space when uploading to print services like Printful.
// The 4:3 aspect ratio perfectly matches 24" × 18" poster dimensions.

// Create legend SVG with smart placement
function createLegendSVG(teams, nodes = [], hasCustomTitles = false) {
    const legendWidth = 2400;
    const itemsPerRow = 8; // Match PNG export
    const rowHeight = 24; // Match PNG export
    const legendHeaderHeight = 50; // Match PNG export
    const legendHeight = Math.ceil(teams.length / itemsPerRow) * rowHeight + legendHeaderHeight;
    
    // Determine best placement (top, bottom, or side) based on node positions
    let placement = 'top'; // default
    
    // If custom titles exist, always place legend at bottom to avoid overlap
    if (hasCustomTitles) {
        placement = 'bottom';
        console.log('📍 Legend placement: bottom (custom titles detected)');
    } else if (nodes && nodes.length > 0) {
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
                <rect width="${legendWidth}" height="${legendHeight}" fill="rgba(20, 20, 20, 0.95)" rx="10" stroke="#3498db" stroke-width="3"/>
                <text x="${legendWidth / 2}" y="35" text-anchor="middle" font-size="20" fill="white" font-weight="bold" font-family="Roboto, Helvetica Neue, Arial, sans-serif">Team Colors</text>
        `;
        
        teams.sort().forEach((team, i) => {
            const y = i * 30 + 65;
            const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
            
            legendSVG += `
                <rect x="15" y="${y}" width="20" height="20" fill="${color}" stroke="white" stroke-width="1"/>
                <text x="45" y="${y + 15}" font-size="13" fill="white" font-family="Roboto, Helvetica Neue, Arial, sans-serif">${team}</text>
            `;
        });
        
        legendSVG += `</g>`;
        return { svg: legendSVG, height: 0, placement: 'side', width: legendWidth };
    } else {
        // Horizontal legend (top or bottom)
        legendSVG = `
            <g class="legend-group" transform="translate(0, 0)">
                <rect width="${legendWidth}" height="${legendHeight}" fill="rgba(20, 20, 20, 0.95)" rx="10" stroke="#3498db" stroke-width="3"/>
                <text x="${legendWidth / 2}" y="35" text-anchor="middle" font-size="24" fill="white" font-weight="bold" font-family="Roboto, Helvetica Neue, Arial, sans-serif">Team Color Legend</text>
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
                <text x="${x + 30}" y="${y + 15}" font-size="14" fill="white" font-family="Roboto, Helvetica Neue, Arial, sans-serif">${team}</text>
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
    
    // Check if custom titles exist
    const hasTitles = svgElement.querySelector('.title-text') || svgElement.querySelector('.subtitle-text');
    
    const svgClone = svgElement.cloneNode(true);
    const legend = createLegendSVG(teams, nodes, hasTitles);
    
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
        // Bottom legend - add space at bottom
        totalWidth = 2400;
        totalHeight = currentHeight + legend.height + 40;
    } else {
        // Top legend (only when no custom titles)
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
    rect.setAttribute("fill", "#000000");
    svgClone.insertBefore(rect, svgClone.firstChild);
    
    // Position main content based on legend placement
    const mainGroup = svgClone.querySelector('g');
    if (mainGroup) {
        if (legend.placement === 'top' && !hasTitles) {
            // Only shift down for top legend when there are no titles
            const currentTransform = mainGroup.getAttribute('transform') || '';
            mainGroup.setAttribute('transform', `translate(0, ${legend.height + 20}) ${currentTransform}`);
        }
        // For 'bottom' and 'side', no shift needed
        // For 'top' with titles, titles provide the spacing
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
        mainGroup.parentNode.insertBefore(legendGroup, mainGroup.nextSibling);
    }
    
    // Add embedded styles
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
        text { font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif; font-size: 16px; fill: white; text-shadow: 2px 2px 4px rgba(0,0,0,1); font-weight: 600; }
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

// Export network as PNG - OPTIMIZED FOR 24" × 18" (4:3 ratio)
function exportAsPNG(includeNames = true) {
    const svgElement = document.getElementById('poster-svg');
    if (!svgElement) {
        alert('Please select at least one year first!');
        return;
    }
    
    // Check if custom titles exist
    const hasTitles = svgElement.querySelector('.title-text') || svgElement.querySelector('.subtitle-text');
    
    alert(`⏳ Preparing PNG export ${includeNames ? 'with' : 'without'} names... This may take a few seconds.\n\nClick OK and wait for the download.`);
    
    setTimeout(() => {
        try {
            // Get current teams for legend
            const teams = Array.from(new Set(
                networkData.edges
                    .filter(e => selectedYears.has(e.year))
                    .map(e => e.team)
            ));
            
            // Get node positions
            const nodes = simulation ? simulation.nodes() : [];
            
            // Create legend with title detection (for placement logic only)
            const legend = createLegendSVG(teams, nodes, hasTitles);
            
            // REDESIGNED LAYOUT - Fit everything within 4:3 (24" × 18") from the start
            const scale = 5; // Final scale for 12,000 × 9,000 output
            const baseWidth = 2400;
            const baseHeight = 1800; // Fixed 4:3 aspect ratio
            
            // Get titles if they exist
            let titleHeight = 0;
            const titleElement = svgElement.querySelector('.title-text');
            const subtitleElement = svgElement.querySelector('.subtitle-text');
            
            if (titleElement) {
                titleHeight = 110; // Main title space (moved lower from 90)
            }
            
            if (subtitleElement) {
                titleHeight += 50; // Subtitle space (increased from 45)
            }
            
            if (titleHeight > 0) {
                titleHeight += 30; // Extra spacing after titles (keeps this)
            }
            
            // Calculate COMPACT legend dimensions
            const itemsPerRow = 8; // Increased from 6 to reduce rows
            const rowHeight = 24; // Even tighter for 12px text (was 26)
            const legendHeaderHeight = 50; // Reduced header space
            
            // Debug: log the calculation step by step
            const rows = Math.ceil(teams.length / itemsPerRow);
            const compactLegendHeight = rows * rowHeight + legendHeaderHeight;
            const legendSpacing = 40; // Reduced spacing before legend
            
            console.log('🔍 Legend calculation DEBUG:', {
                teamCount: teams.length,
                itemsPerRow,
                rows,
                rowHeight,
                legendHeaderHeight,
                calculated: `${rows} × ${rowHeight} + ${legendHeaderHeight} = ${compactLegendHeight}`,
                compactLegendHeight
            });
            
            // Calculate network area (what's left after title and legend)
            const networkHeight = baseHeight - titleHeight - legendSpacing - compactLegendHeight - 20; // 20px bottom margin
            
            console.log(`📐 Layout (fits 4:3): title=${titleHeight}, network=${networkHeight}, spacing=${legendSpacing}, legend=${compactLegendHeight}, total=${baseHeight}`);
            
            // Create canvas at FINAL 4:3 resolution - NO CROPPING NEEDED
            const canvas = document.createElement('canvas');
            canvas.width = baseWidth * scale;   // 12,000 pixels
            canvas.height = baseHeight * scale; // 9,000 pixels (4:3 ratio)
            const ctx = canvas.getContext('2d', { alpha: false });
            
            // Scale context once
            ctx.scale(scale, scale);
            
            // Fill background
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, baseWidth, baseHeight);
            
            // Draw titles LOWER to avoid being cut by frame
            if (titleElement || subtitleElement) {
                ctx.textAlign = 'center';
                let currentY = 80; // Start even lower (was 60)
                
                if (titleElement) {
                    const titleText = titleElement.textContent;
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 38px Roboto, Arial, sans-serif';
                    ctx.fillText(titleText, baseWidth / 2, currentY);
                    currentY += 50;
                }
                
                if (subtitleElement) {
                    const subtitleText = subtitleElement.textContent;
                    ctx.fillStyle = '#d0d0d0';
                    ctx.font = '22px Roboto, Arial, sans-serif';
                    ctx.fillText(subtitleText, baseWidth / 2, currentY);
                }
            }
            
            // Network area starts after titles
            const networkStartY = titleHeight;
            
            // Calculate center position for network (ignore zoom/pan, center the graph)
            const networkCenterX = baseWidth / 2;
            const networkCenterY = networkStartY + (networkHeight / 2);
            
            // Get all links and nodes
            const links = d3.selectAll('#poster-svg line').nodes();
            const nodesElements = d3.selectAll('#poster-svg circle').nodes();
            const labels = d3.selectAll('#poster-svg text.node-label').nodes();
            
            // Find bounds of the network to center it properly
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            nodesElements.forEach(node => {
                const parent = node.parentElement;
                const transform = parent.getAttribute('transform');
                const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
                if (match) {
                    const x = parseFloat(match[1]);
                    const y = parseFloat(match[2]);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            });
            
            const graphWidth = maxX - minX;
            const graphHeight = maxY - minY;
            const graphCenterX = (minX + maxX) / 2;
            const graphCenterY = (minY + maxY) / 2;
            
            // Calculate offset to center the graph in available space
            const offsetX = networkCenterX - graphCenterX;
            const offsetY = networkCenterY - graphCenterY;
            
            console.log(`🎯 Centering network: graph=${graphWidth.toFixed(0)}×${graphHeight.toFixed(0)}, offset=(${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
            
            ctx.save();
            // Apply offset to center the network in available space (no zoom transform)
            ctx.translate(offsetX, offsetY);
            
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
            nodesElements.forEach(node => {
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
                ctx.font = 'bold 16px Roboto, Arial, sans-serif';
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
            
            // Draw legend at correct position (after title + network + spacing)
            const legendY = titleHeight + networkHeight + legendSpacing;
            
            // Legend height already calculated earlier (compactLegendHeight variable)
            
            // Draw legend background with rounded corners - new color scheme
            ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
            const cornerRadius = 8;
            const legendMargin = 10;
            
            // Create rounded rectangle
            ctx.beginPath();
            ctx.moveTo(legendMargin + cornerRadius, legendY);
            ctx.lineTo(baseWidth - legendMargin - cornerRadius, legendY);
            ctx.quadraticCurveTo(baseWidth - legendMargin, legendY, baseWidth - legendMargin, legendY + cornerRadius);
            ctx.lineTo(baseWidth - legendMargin, legendY + compactLegendHeight - cornerRadius);
            ctx.quadraticCurveTo(baseWidth - legendMargin, legendY + compactLegendHeight, baseWidth - legendMargin - cornerRadius, legendY + compactLegendHeight);
            ctx.lineTo(legendMargin + cornerRadius, legendY + compactLegendHeight);
            ctx.quadraticCurveTo(legendMargin, legendY + compactLegendHeight, legendMargin, legendY + compactLegendHeight - cornerRadius);
            ctx.lineTo(legendMargin, legendY + cornerRadius);
            ctx.quadraticCurveTo(legendMargin, legendY, legendMargin + cornerRadius, legendY);
            ctx.closePath();
            ctx.fill();
            
            // Draw vibrant blue border
            ctx.strokeStyle = '#3498db';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw legend title - COMPACT
            ctx.fillStyle = 'white';
            ctx.font = 'bold 22px Roboto, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Team Color Legend', baseWidth / 2, legendY + 30);
            
            // Draw legend items - COMPACT
            const sortedTeams = teams.sort();
            const itemWidth = baseWidth / itemsPerRow;
            
            ctx.font = '12px Roboto, Arial, sans-serif';
            ctx.textAlign = 'left';
            
            sortedTeams.forEach((team, i) => {
                const row = Math.floor(i / itemsPerRow);
                const col = i % itemsPerRow;
                const x = col * itemWidth + 20;
                const y = legendY + row * rowHeight + 48; // Using rowHeight variable
                
                // Draw color box - slightly smaller
                const color = teamColorsData.teamColors[team] || teamColorsData.defaultColor;
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 18, 18);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1.2;
                ctx.strokeRect(x, y, 18, 18);
                
                // Draw team name
                ctx.fillStyle = 'white';
                ctx.fillText(team, x + 24, y + 13);
            });
            
            // Canvas is already at perfect 4:3 ratio (12,000 × 9,000) - convert directly to PNG
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
            }, 'image/png', 1.0);
            
        } catch (error) {
            console.error('PNG Export Error:', error);
            alert('❌ Error creating PNG: ' + error.message + '\n\nPlease try the SVG export instead.');
        }
    }, 100);
}

// Explicitly expose functions to global scope for compatibility
if (typeof window !== 'undefined') {
    window.exportAsSVG = exportAsSVG;
    window.exportAsPNG = exportAsPNG;
    window.createLegendSVG = createLegendSVG;
    console.log('✅ Export functions loaded and available globally');
}