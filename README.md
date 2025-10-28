# ⚾ Baseball Card Collection - Modular Structure

Interactive network visualization showing player-to-player connections through shared teams.

## 📁 Project Structure

```
baseball-card-network/
├── index-modular.html     ← Main HTML file
├── css/
│   └── style.css          ← All styling
├── js/
│   ├── app.js             ← Main app logic & data loading
│   ├── filters.js         ← Year & player filtering
│   ├── network.js         ← D3.js visualization
│   └── export.js          ← SVG/PNG export
└── data/
    ├── network_data.json  ← Years and edges (2.6 MB)
    ├── players.json       ← List of all players
    ├── teams.json         ← List of all teams
    └── team_colors.json   ← MLB team colors
```

## 🚀 Quick Start

### Upload to GitHub

1. **Create repository** on GitHub (must be public for GitHub Pages)

2. **Upload all files** maintaining the folder structure:
   ```
   - index-modular.html (rename to index.html)
   - css/ folder with style.css
   - js/ folder with all 4 JS files
   - data/ folder with all 4 JSON files
   ```

3. **Enable GitHub Pages**:
   - Settings → Pages
   - Source: Deploy from branch → main → / (root)
   - Save and wait 2 minutes

4. **Visit your site**:
   `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

### Local Development

```bash
# Clone your repo
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME

# Start local server (required for loading JSON files)
python -m http.server 8000

# Open browser
# http://localhost:8000
```

## 📦 File Descriptions

### HTML
- **index-modular.html** - Main page, loads all CSS/JS/data files

### CSS
- **css/style.css** - Complete styling including:
  - Layout and containers
  - Controls and filters
  - Network visualization styles
  - Team colors and legend
  - Responsive design

### JavaScript Modules

#### **js/app.js** (Main Application)
- Data loading from JSON files
- UI creation and initialization
- Player search functionality
- Global state management
- Event handlers

#### **js/filters.js** (Filtering Logic)
- Year selection (single, multiple, decades)
- Player filtering (show/hide mode)
- Minimum connections slider
- Filter state updates
- Diagram update coordination

#### **js/network.js** (D3.js Visualization)
- Force-directed graph
- Node and edge rendering
- Team color coding
- Interactive tooltips
- Drag and zoom controls
- Fit to screen function

#### **js/export.js** (Export Functions)
- SVG export with legend
- PNG export with legend
- Canvas rendering
- Legend generation

### Data Files

#### **data/network_data.json** (2.6 MB)
```json
{
  "years": [1953, 1958, ...],
  "edges": [
    {
      "from": "Player A",
      "to": "Player B",
      "team": "Team Name",
      "year": 1991
    },
    ...
  ]
}
```

#### **data/players.json**
```json
{
  "players": ["Aaron Boone", "Abraham Nunez", ...],
  "count": 1363
}
```

#### **data/teams.json**
```json
{
  "teams": ["Atlanta Braves", "Baltimore Orioles", ...],
  "count": 36
}
```

#### **data/team_colors.json**
```json
{
  "teamColors": {
    "Atlanta Braves": "#CE1141",
    "Boston Red Sox": "#BD3039",
    ...
  },
  "defaultColor": "#808080"
}
```

## 🎯 Features

- **Player Search**: Multi-select players with autocomplete
- **Year Filtering**: Select individual years, decades, or all years
- **Connection Threshold**: Filter by minimum player connections
- **Show/Hide Mode**: Include or exclude selected players
- **Team Colors**: Realistic MLB team colors on connections
- **Interactive**: 
  - Drag to pan
  - Scroll to zoom
  - Drag nodes to rearrange
  - Hover for details
- **Export**: Download as SVG or PNG with legend

## 🛠️ Technology Stack

- **D3.js v7.8.5** - Force-directed graph visualization
- **Vanilla JavaScript** - No frameworks, modular structure
- **HTML5 Canvas** - PNG export
- **SVG** - Vector graphics and export
- **CSS3** - Modern styling

## 📊 Data Statistics

- **1,363** unique players
- **36** teams
- **21,669** player connections
- **30** years (1953-2002)

## ⚙️ Customization

### Change Team Colors
Edit `data/team_colors.json`:
```json
{
  "teamColors": {
    "Your Team": "#HEXCOLOR"
  }
}
```

### Modify Styling
Edit `css/style.css` for:
- Colors and themes
- Layout and spacing
- Font sizes
- Animation speeds

### Adjust Network Physics
Edit `js/network.js`, line ~70:
```javascript
simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).distance(100))  // Link distance
    .force("charge", d3.forceManyBody().strength(-500)) // Repulsion
    .force("collision", d3.forceCollide().radius(40))   // Node spacing
```

## 🐛 Troubleshooting

**Problem**: Blank page or "Loading data..." forever

**Solution**:
1. Check browser console (F12) for errors
2. Verify all data files uploaded correctly
3. Ensure you're using a web server (not opening HTML directly)
4. Check file paths match folder structure

**Problem**: Functions not defined errors

**Solution**:
1. Ensure all 4 JS files are in `js/` folder
2. Check scripts load in correct order in HTML
3. Clear browser cache (Ctrl+Shift+R)

**Problem**: No team colors showing

**Solution**:
1. Verify `data/team_colors.json` uploaded
2. Check console for loading errors
3. Ensure JSON is valid (no trailing commas)

## 🔧 Development

To modify the application:

1. **Edit app.js** for: Data loading, UI structure, search
2. **Edit filters.js** for: Year/player filtering logic
3. **Edit network.js** for: Visualization, D3.js settings
4. **Edit export.js** for: SVG/PNG export features

After changes:
1. Test locally with `python -m http.server 8000`
2. Commit and push to GitHub
3. GitHub Pages auto-deploys in ~2 minutes

## 📝 License

Open source - free for personal use

## 👥 Credits

- Baseball card collection by Ben & Marty
- Visualization built with D3.js
- Modular structure for easy maintenance

---

Enjoy exploring your baseball card connections! ⚾
