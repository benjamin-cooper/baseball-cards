// Level of Detail (LOD) System - Adaptive rendering based on zoom

let currentLOD = 'medium';
let lodUpdateScheduled = false;

// Update LOD based on zoom level
function updateLOD(zoomScale) {
    // Prevent too frequent updates
    if (lodUpdateScheduled) return;
    
    lodUpdateScheduled = true;
    requestAnimationFrame(() => {
        applyLOD(zoomScale);
        lodUpdateScheduled = false;
    });
}

function applyLOD(zoomScale) {
    if (!node || !link || !label) return;
    
    const nodeCount = node.size ? node.size() : 0;
    let newLOD;
    
    if (zoomScale < 0.5) {
        // Far zoom - minimal detail
        newLOD = 'low';
        if (currentLOD !== 'low') {
            node.select("circle")
                .transition()
                .duration(200)
                .attr("r", 5)
                .attr("stroke-width", 1);
            
            link
                .transition()
                .duration(200)
                .attr("stroke-width", 0.5)
                .attr("opacity", 0.3);
            
            label.style("display", "none");
            
            console.log('🔍 LOD: Low (far zoom)');
        }
        
    } else if (zoomScale < 1.5) {
        // Medium zoom - normal
        newLOD = 'medium';
        if (currentLOD !== 'medium') {
            node.select("circle")
                .transition()
                .duration(200)
                .attr("r", 10)
                .attr("stroke-width", 3);
            
            link
                .transition()
                .duration(200)
                .attr("stroke-width", nodeCount > 5000 ? 1 : 2)
                .attr("opacity", 0.6);
            
            // Show labels if user has them enabled
            label.style("display", labelsVisible ? "block" : "none");
            
            console.log('🔍 LOD: Medium (normal zoom)');
        }
        
    } else if (zoomScale < 3) {
        // Close zoom - high detail
        newLOD = 'high';
        if (currentLOD !== 'high') {
            node.select("circle")
                .transition()
                .duration(200)
                .attr("r", 15)
                .attr("stroke-width", 4);
            
            link
                .transition()
                .duration(200)
                .attr("stroke-width", 3)
                .attr("opacity", 0.8);
            
            // Always show labels when zoomed in
            label.style("display", "block");
            
            // Update label visibility button state
            if (!labelsVisible) {
                labelsVisible = true;
                const btn = document.getElementById('toggle-labels-btn');
                if (btn) {
                    btn.textContent = '🏷️ Hide Names';
                    btn.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                }
            }
            
            console.log('🔍 LOD: High (close zoom)');
        }
        
    } else {
        // Very close zoom - maximum detail
        newLOD = 'ultra';
        if (currentLOD !== 'ultra') {
            node.select("circle")
                .transition()
                .duration(200)
                .attr("r", 18)
                .attr("stroke-width", 5);
            
            link
                .transition()
                .duration(200)
                .attr("stroke-width", 4)
                .attr("opacity", 0.9);
            
            label
                .style("display", "block")
                .transition()
                .duration(200)
                .attr("font-size", "16px");
            
            console.log('🔍 LOD: Ultra (very close zoom)');
        }
    }
    
    currentLOD = newLOD;
}

// Hook LOD into zoom events
function initializeLOD() {
    if (!svg) {
        console.warn('⚠️ Cannot initialize LOD: SVG not found');
        return;
    }
    
    // Wrap existing zoom handler
    const originalZoom = currentZoom;
    if (!originalZoom) {
        console.warn('⚠️ Cannot initialize LOD: Zoom not initialized');
        return;
    }
    
    currentZoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            updateLOD(event.transform.k);
        });
    
    svg.call(currentZoom);
    
    console.log('✅ LOD system initialized');
}

// Get performance recommendations based on network size
function getLODRecommendations(nodeCount, edgeCount) {
    if (nodeCount > 500 || edgeCount > 5000) {
        return {
            message: 'Large network detected',
            tips: [
                'Labels hidden by default (zoom in to see)',
                'Thinner lines for better performance',
                'Use filters to reduce network size'
            ]
        };
    } else if (nodeCount > 200) {
        return {
            message: 'Medium network',
            tips: [
                'Zoom in to see more detail',
                'Labels show/hide based on zoom',
                'Smooth performance expected'
            ]
        };
    } else {
        return {
            message: 'Small network',
            tips: [
                'All labels visible',
                'Maximum detail at all zoom levels',
                'Best for detailed analysis'
            ]
        };
    }
}
