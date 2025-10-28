#!/usr/bin/env python3
"""
Regenerate JSON data files from Baseball Cards CSV
FINAL VERSION with proper filtering
- Preserves year information
- Team name normalization
- Filters out Checklist, Team Leaders, and blank teams
- No pandas required
"""

import csv
import json
from collections import defaultdict

# Team name normalization map
TEAM_ALIASES = {
    # Angels franchise
    'California Angels': 'Anaheim Angels',
    'Los Angeles Angels': 'Anaheim Angels',
    'Los Angeles Angels of Anaheim': 'Anaheim Angels',
    
    # Rays franchise
    'Tampa Bay Devil Rays': 'Tampa Bay Rays',
    'Tampa Devil Rays': 'Tampa Bay Rays',  # Fix typo
}

# Cards to skip (non-player cards)
SKIP_PLAYERS = {
    'Checklist',
    'Team Leaders',
    'Atlanta Braves Team Leaders',
    'Baltimore Orioles Team Leaders',
    'Boston Red Sox Team Leaders',
    'California Angels Team Leaders',
    'Chicago Cubs Team Leaders',
    'Chicago White Sox Team Leaders',
    'Cincinnati Reds Team Leaders',
    'Cleveland Indians Team Leaders',
    'Detroit Tigers Team Leaders',
    'Houston Astros Team Leaders',
    'Kansas City Royals Team Leaders',
    'Los Angeles Dodgers Team Leaders',
    'Milwaukee Brewers Team Leaders',
    'Minnesota Twins Team Leaders',
    'Montreal Expos Team Leaders',
    'New York Mets Team Leaders',
    'New York Yankees Team Leaders',
    'Oakland Athletics Team Leaders',
    'Philadelphia Phillies Team Leaders',
    'Pittsburgh Pirates Team Leaders',
    'San Diego Padres Team Leaders',
    'San Francisco Giants Team Leaders',
    'Seattle Mariners Team Leaders',
    'St. Louis Cardinals Team Leaders',
    'Texas Rangers Team Leaders',
    'Toronto Blue Jays Team Leaders',
}

def normalize_team_name(team):
    """Normalize team names to their current/preferred version"""
    return TEAM_ALIASES.get(team, team)

def should_skip_card(card):
    """Determine if a card should be skipped"""
    player = card.get('Player', '').strip()
    team = card.get('Team', '').strip()
    
    # Skip if no player name
    if not player:
        return True
    
    # Skip if player is in skip list
    if player in SKIP_PLAYERS:
        return True
    
    # Skip if team is blank or just whitespace
    if not team:
        return True
    
    # Skip if team is "Checklist"
    if team.lower() == 'checklist':
        return True
    
    return False

def load_csv(filename):
    """Load CSV and normalize team names"""
    print(f"📂 Loading {filename}...")
    
    cards = []
    skipped = 0
    
    with open(filename, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Skip non-player cards
            if should_skip_card(row):
                skipped += 1
                continue
            
            # Normalize team name
            row['Team'] = normalize_team_name(row['Team'])
            cards.append(row)
    
    print(f"   Found {len(cards)} valid player cards")
    print(f"   Skipped {skipped} non-player cards (Checklist, Team Leaders, blanks)")
    
    # Show normalization results
    if TEAM_ALIASES:
        print("\n📊 Team normalization applied:")
        for old, new in TEAM_ALIASES.items():
            old_count = sum(1 for c in cards if normalize_team_name(c.get('Team', '')) == new)
            if old_count > 0:
                print(f"   {old} → {new}")
    
    return cards

def generate_network_data(cards):
    """Generate network edges in the format the app expects"""
    print("\n🔗 Generating network data...")
    
    # Collect all unique years
    all_years = set()
    
    # Group cards by player and team to track years
    player_team_years = defaultdict(lambda: defaultdict(set))
    
    for card in cards:
        player = card['Player']
        team = card['Team']
        try:
            year = int(card['Year'])
            all_years.add(year)
            player_team_years[player][team].add(year)
        except:
            pass
    
    edges = []
    
    # Create edges: one edge per player-team-YEAR combination
    # This gives full accuracy - if a player was on a team for 5 years, 
    # we create 5 edges (one per year)
    for player, team_years in player_team_years.items():
        for team, years in team_years.items():
            # Create one edge for EACH year the player was on this team
            for year in years:
                edges.append({
                    'from': player,
                    'to': player,  # In this structure, from=to=player
                    'team': team,
                    'year': year
                })
    
    # Return proper format with years array and edges array
    result = {
        'years': sorted(list(all_years)),
        'edges': edges
    }
    
    print(f"   Created {len(edges)} player-team-year connections")
    print(f"   {len(player_team_years)} unique players")
    print(f"   Years range: {min(all_years) if all_years else 'N/A'} - {max(all_years) if all_years else 'N/A'}")
    
    # Show example
    if player_team_years:
        example_player = list(player_team_years.keys())[0]
        example_teams = player_team_years[example_player]
        print(f"\n   Example - {example_player}:")
        for team, years in sorted(example_teams.items()):
            print(f"   - {team}: {sorted(years)}")
    
    return result

def generate_players_data(cards):
    """Generate player data"""
    print("\n👤 Generating player data...")
    
    # Group cards by player
    player_info = defaultdict(lambda: {'teams': set(), 'years': set(), 'count': 0})
    
    for card in cards:
        player = card['Player']
        player_info[player]['teams'].add(card['Team'])
        try:
            player_info[player]['years'].add(int(card['Year']))
        except:
            pass
        player_info[player]['count'] += 1
    
    players = []
    for player, info in sorted(player_info.items()):
        players.append({
            'name': player,
            'teams': sorted(list(info['teams'])),
            'years': sorted(list(info['years'])),
            'card_count': info['count']
        })
    
    print(f"   Found {len(players)} unique players")
    return players

def generate_teams_data(cards):
    """Generate team data"""
    print("\n🏟️  Generating team data...")
    
    teams_set = set()
    team_counts = defaultdict(int)
    
    for card in cards:
        teams_set.add(card['Team'])
        team_counts[card['Team']] += 1
    
    teams_list = sorted(list(teams_set))
    
    teams = {
        'teams': teams_list,
        'count': len(teams_list)
    }
    
    print(f"   Found {len(teams_list)} unique teams")
    
    # Show top teams by card count
    top_teams = sorted(team_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    print("\n   Top 10 teams by card count:")
    for team, count in top_teams:
        print(f"   - {team}: {count} cards")
    
    return teams

def generate_team_colors(teams_list):
    """Generate team colors"""
    print("\n🎨 Generating team colors...")
    
    # MLB team colors
    colors = {
        'Anaheim Angels': '#BA0021',
        'Arizona Diamondbacks': '#A71930',
        'Atlanta Braves': '#CE1141',
        'Baltimore Orioles': '#DF4601',
        'Boston Red Sox': '#BD3039',
        'Brooklyn Dodgers': '#005A9C',
        'Chicago Cubs': '#0E3386',
        'Chicago White Sox': '#27251F',
        'Cincinnati Reds': '#C6011F',
        'Cincinnati Redlegs': '#C6011F',
        'Cleveland Indians': '#E31937',
        'Colorado Rockies': '#33006F',
        'Detroit Tigers': '#0C2C56',
        'Florida Marlins': '#00A3E0',
        'Houston Astros': '#EB6E1F',
        'Kansas City Royals': '#004687',
        'Los Angeles Dodgers': '#005A9C',
        'Miami Marlins': '#00A3E0',
        'Milwaukee Brewers': '#12284B',
        'Minnesota Twins': '#002B5C',
        'Montreal Expos': '#003087',
        'New York Giants': '#FD5A1E',
        'New York Mets': '#002D72',
        'New York Yankees': '#003087',
        'Oakland Athletics': '#003831',
        'Philadelphia Athletics': '#003831',
        'Philadelphia Phillies': '#E81828',
        'Pittsburgh Pirates': '#27251F',
        'San Diego Padres': '#2F241D',
        'San Francisco Giants': '#FD5A1E',
        'Seattle Mariners': '#0C2C56',
        'St. Louis Cardinals': '#C41E3A',
        'Tampa Bay Rays': '#092C5C',
        'Texas Rangers': '#003278',
        'Toronto Blue Jays': '#134A8E',
        'Washington Nationals': '#AB0003',
        'Washington Senators': '#AB0003',
    }
    
    team_colors = {
        'teamColors': {},
        'defaultColor': '#666666'
    }
    
    for team in teams_list:
        team_colors['teamColors'][team] = colors.get(team, '#666666')
    
    print(f"   Assigned colors to {len(team_colors['teamColors'])} teams")
    
    return team_colors

def main():
    """Main regeneration function"""
    print("=" * 60)
    print("🔄 Baseball Card Data Regeneration (FINAL)")
    print("=" * 60)
    print("✅ NO PANDAS REQUIRED")
    print("✅ Preserves year information")
    print("✅ Team name normalization")
    print("✅ Filters out Checklist, Team Leaders, blank teams")
    print()
    
    # Input file
    csv_file = input("📁 Enter CSV filename (or press Enter for default): ").strip()
    if not csv_file:
        csv_file = "Ben___Marty_s_Baseball_Card_Collection_-_Pricing_Sheet.csv"
    
    try:
        # Load data
        cards = load_csv(csv_file)
        
        # Generate all data files
        network_data = generate_network_data(cards)
        players_data = generate_players_data(cards)
        teams_data = generate_teams_data(cards)
        team_colors = generate_team_colors(teams_data['teams'])
        
        # Save to JSON files
        print("\n💾 Saving JSON files...")
        
        with open('network_data.json', 'w') as f:
            json.dump(network_data, f, indent=2)
        print("   ✅ network_data.json")
        
        with open('players.json', 'w') as f:
            json.dump(players_data, f, indent=2)
        print("   ✅ players.json")
        
        with open('teams.json', 'w') as f:
            json.dump(teams_data, f, indent=2)
        print("   ✅ teams.json")
        
        with open('team_colors.json', 'w') as f:
            json.dump(team_colors, f, indent=2)
        print("   ✅ team_colors.json")
        
        print("\n" + "=" * 60)
        print("✅ Regeneration complete!")
        print("=" * 60)
        print("\n📋 Summary:")
        print(f"   Total player cards: {len(cards)}")
        print(f"   Unique players: {len(players_data)}")
        print(f"   Unique teams: {teams_data['count']}")
        print(f"   Years covered: {len(network_data['years'])}")
        print(f"   Player connections: {len(network_data['edges'])}")
        
        # Check for Tampa Bay Rays
        tampa_players = [p for p in players_data if 'Tampa Bay Rays' in p['teams']]
        if tampa_players:
            print(f"\n✅ Tampa Bay Rays found!")
            print(f"   Players with Tampa Bay cards: {len(tampa_players)}")
            for p in tampa_players[:5]:
                print(f"   - {p['name']}: {p['years']}")
        
        # Check for Anaheim Angels
        angels_players = [p for p in players_data if 'Anaheim Angels' in p['teams']]
        if angels_players:
            print(f"\n✅ Anaheim Angels found!")
            print(f"   Players: {len(angels_players)}")
        
        print("\n📂 Output files created in current directory:")
        print("   - network_data.json")
        print("   - players.json")
        print("   - teams.json")
        print("   - team_colors.json")
        print("\n🚀 Copy these files to your data/ folder and refresh your app!")
        
    except FileNotFoundError:
        print(f"\n❌ Error: Could not find {csv_file}")
        print("   Make sure the file is in the current directory.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()
