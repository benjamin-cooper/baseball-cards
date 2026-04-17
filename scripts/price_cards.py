#!/usr/bin/env python3
"""
Baseball Card Pricing Agent v1.0
─────────────────────────────────
Reads the card inventory from Google Sheets, prices unpriced/stale cards
using the eBay Browse API, and uses Claude for difficult cards (low data,
high value, conflicting sources). Writes results back to the sheet and
exports a summary JSON for the Further Insights web page.

Required environment variables:
  ANTHROPIC_API_KEY          - Anthropic API key
  EBAY_APP_ID                - eBay production App ID
  EBAY_CLIENT_SECRET         - eBay production Client Secret
  GOOGLE_CREDENTIALS_JSON    - Service account JSON (full content, not path)
  SPREADSHEET_ID             - Google Sheets ID (defaults to Ben's sheet)
  BATCH_SIZE                 - Cards to process per run (default 50)
"""

import os, sys, json, time, base64, re, math, logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests
import anthropic
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
SPREADSHEET_ID = os.environ.get(
    'SPREADSHEET_ID',
    '1p65aHj-Azx7YiYAG6BA-IQF4erdJThJMlLPXaG7paFg'
)
SHEET_NAME         = 'Pricing Sheet'
RESULTS_FILE       = 'data/pricing_results.json'
BATCH_SIZE         = int(os.environ.get('BATCH_SIZE', '200'))
STALE_DAYS         = 30          # re-price cards older than this
HIGH_VALUE_THRESH  = 20.0        # use Claude for cards above this price
LOW_DATA_THRESH    = 3           # use Claude if fewer than this many comps
EBAY_SLEEP_MS      = 100         # ms between eBay API calls
EBAY_CATEGORY      = '212'       # Baseball Cards
EBAY_PRICE_RANGE   = '0.50..500'
MAVIN_SLEEP_MS     = 300         # ms between Mavin requests (be polite)
MAVIN_MAX_AGE_DAYS = 730         # ignore Mavin sales older than this (2 years)
HISTORY_FILE       = 'data/price_history.json'
HISTORY_MAX        = 24          # snapshots per card (≈2 years of monthly runs)
FULL_RUN_CHUNK     = 200         # cards per incremental commit in full mode

RUN_MODE      = os.environ.get('RUN_MODE', 'batch').lower()   # batch | full | player
TARGET_PLAYER = os.environ.get('TARGET_PLAYER', '').strip().lower()

# ── Column map — matches the actual sheet layout ──────────────────────────────
# Read columns (A–F):
#   A=Brand  B=Year  C=Card Number  D=Player  E=Team  F=TCDB Price (reference)
# Write columns (we never touch H–J which belong to the sheet):
#   G=Avg eBay Price   K=Median   L=Last Updated   M=Confidence
#
# Column aliases let detect_columns() find these by header name if the order
# ever changes.

COLUMN_ALIASES: dict[str, tuple] = {
    'BRAND':       ('brand', 'set', 'card set', 'manufacturer', 'series'),
    'YEAR':        ('year', 'season', 'card year'),
    'CARD_NUMBER': ('card number', 'card #', 'card no', 'number', '#', 'no'),
    'PLAYER':      ('player', 'player name', 'name', 'athlete'),
    'TEAM':        ('team', 'team name'),
    'TCDB_PRICE':  ('price', 'tcdb price', 'tcdb', 'book price', 'ref price'),
    'AVG_PRICE':   ('avg ebay price', 'avg price', 'market value', 'ebay price', 'avg'),
    'MEDIAN':      ('median listed price', 'median price', 'median'),
    'LAST_UPDATED':('last updated', 'updated', 'last priced'),
    'CONFIDENCE':  ('confidence', 'confidence level'),
}

C_DEFAULTS = {
    'BRAND': 0, 'YEAR': 1, 'CARD_NUMBER': 2, 'PLAYER': 3, 'TEAM': 4,
    'TCDB_PRICE': 5,    # F — TCDB reference price (read only)
    'AVG_PRICE': 6,     # G — Avg eBay Price      (we write)
    # H / I skipped     # H=All Card Data, I=Count (we don't touch)
    'MEDIAN': 10,       # K — Median              (we write)
    'LAST_UPDATED': 11, # L — Last Updated        (we write)
    'CONFIDENCE': 12,   # M — Confidence          (we write)
}

# C is set dynamically in main() after reading the header row
C: dict = dict(C_DEFAULTS)


def detect_columns(header_row: list) -> dict:
    """Map column names to indices from the sheet header, fall back to defaults."""
    found: dict = {}
    for i, cell in enumerate(header_row):
        h = str(cell).strip().lower()
        for canonical, aliases in COLUMN_ALIASES.items():
            if h in aliases and canonical not in found:
                found[canonical] = i
                break
    merged = dict(C_DEFAULTS)
    merged.update(found)
    log.info('Columns detected: %s', {k: v for k, v in merged.items() if k in COLUMN_ALIASES})
    return merged


def make_card_id(year, brand, player, card_number='') -> str:
    """Stable identifier that matches the JS cardId() function."""
    raw = f"{year}_{brand}_{player}_{card_number or ''}".lower().replace(' ', '_')
    return re.sub(r'[^a-z0-9_]', '', raw)


def parse_price(val: str) -> Optional[float]:
    """Parse a price string that may have $, commas, or whitespace. Returns None if empty/unparseable."""
    if not val:
        return None
    cleaned = val.strip().lstrip('$').replace(',', '').strip()
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


# ══════════════════════════════════════════════════════════════════════════════
# Google Sheets
# ══════════════════════════════════════════════════════════════════════════════

def get_sheets_service():
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if not creds_json:
        raise RuntimeError('GOOGLE_CREDENTIALS_JSON not set')
    creds_data = json.loads(creds_json)
    creds = Credentials.from_service_account_info(
        creds_data,
        scopes=['https://www.googleapis.com/auth/spreadsheets']
    )
    return build('sheets', 'v4', credentials=creds).spreadsheets()


def read_sheet(service) -> list[list]:
    log.info('Reading %s…', SHEET_NAME)
    result = service.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{SHEET_NAME}'"
    ).execute()
    return result.get('values', [])


def write_rows(service, updates: list[dict]):
    """Batch-write non-contiguous output segments for multiple rows in one API call.

    Each update dict must have:
      'row'      — 1-based sheet row number
      'segments' — list of {'col': <0-based col index>, 'values': [...]}

    Segments are written as separate ranges so we never touch columns we
    don't own (e.g. H = All Card Data, I = Count are left untouched).
    """
    if not updates:
        return
    data = []
    for u in updates:
        for seg in u['segments']:
            col_1indexed = seg['col'] + 1          # convert 0-based → 1-based
            start_ltr = col_index_to_letter(col_1indexed)
            end_ltr   = col_index_to_letter(col_1indexed + len(seg['values']) - 1)
            data.append({
                'range':  f"'{SHEET_NAME}'!{start_ltr}{u['row']}:{end_ltr}{u['row']}",
                'values': [seg['values']],
            })
    service.values().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={'valueInputOption': 'USER_ENTERED', 'data': data}
    ).execute()
    log.info('Wrote %d rows (%d range segments) to sheet', len(updates), len(data))


def col_index_to_letter(col_1indexed: int) -> str:
    """Convert 1-based column index to A1 letter (1→A, 27→AA, etc.)"""
    s = ''
    n = col_1indexed
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


# ══════════════════════════════════════════════════════════════════════════════
# eBay OAuth
# ══════════════════════════════════════════════════════════════════════════════

_ebay_token: Optional[str] = None
_ebay_token_expiry: Optional[datetime] = None


def get_ebay_token() -> str:
    global _ebay_token, _ebay_token_expiry
    if _ebay_token and _ebay_token_expiry and datetime.now(timezone.utc) < _ebay_token_expiry:
        return _ebay_token

    app_id = os.environ['EBAY_APP_ID']
    secret = os.environ['EBAY_CLIENT_SECRET']
    creds  = base64.b64encode(f'{app_id}:{secret}'.encode()).decode()

    r = requests.post(
        'https://api.ebay.com/identity/v1/oauth2/token',
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': f'Basic {creds}'
        },
        data='grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
        timeout=15
    )
    r.raise_for_status()
    data = r.json()
    _ebay_token        = data['access_token']
    _ebay_token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data['expires_in'] - 60)
    log.info('eBay token refreshed')
    return _ebay_token


# ══════════════════════════════════════════════════════════════════════════════
# eBay Search
# ══════════════════════════════════════════════════════════════════════════════

def ebay_search(query: str, price_filter: str = None) -> list[dict]:
    """Search eBay Browse API, returns list of item dicts."""
    token  = get_ebay_token()
    filter_str = f'buyingOptions:{{FIXED_PRICE|AUCTION}},price:[{price_filter or EBAY_PRICE_RANGE}],itemLocationCountry:US'
    params = {
        'q':            f'{query} baseball',
        'category_ids': EBAY_CATEGORY,
        'filter':       filter_str,
        'sort':         'price',
        'limit':        '200',
    }
    try:
        r = requests.get(
            'https://api.ebay.com/buy/browse/v1/item_summary/search',
            headers={
                'Authorization':          f'Bearer {token}',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
            params=params,
            timeout=15
        )
        time.sleep(EBAY_SLEEP_MS / 1000)
        if r.status_code == 200:
            return r.json().get('itemSummaries', [])
        log.warning('eBay %s for query "%s"', r.status_code, query)
    except Exception as e:
        log.warning('eBay search error: %s', e)
    return []


# ══════════════════════════════════════════════════════════════════════════════
# Mavin.io — aggregated eBay sold prices
# ══════════════════════════════════════════════════════════════════════════════

# Months Mavin abbreviates in sale-date strings
_MONTH_MAP = {m: i+1 for i, m in enumerate(
    ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec')
)}

def _parse_mavin_date(raw: str) -> Optional[str]:
    """Turn 'Jan 2024' or 'Jan 15, 2024' into an ISO date string, or None."""
    raw = raw.strip().lower()
    # Try 'mon dd, yyyy'
    m = re.match(r'([a-z]{3})\s+(\d{1,2}),?\s+(\d{4})', raw)
    if m:
        mo, day, yr = _MONTH_MAP.get(m.group(1)), int(m.group(2)), int(m.group(3))
        if mo:
            return f'{yr:04d}-{mo:02d}-{day:02d}'
    # Try 'mon yyyy'
    m = re.match(r'([a-z]{3})\s+(\d{4})', raw)
    if m:
        mo, yr = _MONTH_MAP.get(m.group(1)), int(m.group(2))
        if mo:
            return f'{yr:04d}-{mo:02d}-15'   # mid-month estimate
    return None


def fetch_mavin_prices(year: str, brand: str, player: str, card_number: str = '') -> list[dict]:
    """Scrape recent *sold* prices from Mavin.io.

    Returns items in the same {price, listing_type, end_date, title} format
    as ebay_search() so they can be merged and passed straight to filter_items()
    / weighted_average().
    """
    query = f"{year} {brand} {player}"
    if card_number:
        query += f" {card_number}"
    url = f"https://mavin.io/search?q={requests.utils.quote(query + ' baseball card')}"
    try:
        r = requests.get(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
            timeout=12
        )
        time.sleep(MAVIN_SLEEP_MS / 1000)
        if r.status_code != 200:
            log.debug('Mavin %s for "%s"', r.status_code, query)
            return []

        html = r.text

        # Mavin renders sale rows like:
        #   <span class="sold-date">Jan 15, 2024</span>
        #   <span class="price">$2.50</span>
        #   <span class="item-title">1989 Topps Ken Griffey Jr #1</span>
        # Extract all (price, date, title) tuples by scanning nearby text blocks.

        # Strategy: find every price tag, then look back ~300 chars for a date.
        results = []
        now = datetime.now(timezone.utc)

        # Grab the full text split around dollar-amount patterns
        for price_m in re.finditer(r'\$(\d{1,4}(?:\.\d{2})?)', html):
            price_val = float(price_m.group(1))
            if not (0.25 <= price_val <= 500):
                continue

            # Look in the surrounding ~600-char window for a sale date
            window_start = max(0, price_m.start() - 400)
            window_end   = min(len(html), price_m.end() + 200)
            window       = html[window_start:window_end]

            # Strip HTML tags for easier parsing
            window_text = re.sub(r'<[^>]+>', ' ', window)
            window_text = re.sub(r'\s+', ' ', window_text)

            # Look for a date pattern in the window
            date_m = re.search(
                r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}'
                r'|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}',
                window_text, re.IGNORECASE
            )
            iso_date = _parse_mavin_date(date_m.group(0)) if date_m else None

            # Reject if date is too old
            if iso_date:
                try:
                    sale_date = datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc)
                    if (now - sale_date).days > MAVIN_MAX_AGE_DAYS:
                        continue
                except Exception:
                    pass

            # Grab nearby title text (used by filter_items for player/year matching)
            title_m = re.search(r'(?:title|alt)="([^"]{10,120})"', window, re.IGNORECASE)
            title = title_m.group(1) if title_m else f"{year} {brand} {player}"

            results.append({
                'price':        price_val,
                'listing_type': 'Sold',    # real transaction, not an ask
                'end_date':     iso_date,
                'title':        title,
            })

        # Deduplicate near-identical prices (Mavin sometimes shows same sale twice)
        seen, deduped = set(), []
        for item in results:
            key = (round(item['price'], 1), item['end_date'])
            if key not in seen:
                seen.add(key)
                deduped.append(item)

        log.debug('Mavin: %d sold comps for "%s"', len(deduped), query)
        return deduped[:40]

    except Exception as e:
        log.debug('Mavin fetch error for "%s": %s', query, e)
        return []


# ══════════════════════════════════════════════════════════════════════════════
# Filtering & Pricing (port of GAS script logic)
# ══════════════════════════════════════════════════════════════════════════════

GRADED_KW   = ('psa', 'bgs', 'sgc', 'graded')
AUTO_KW     = ('autograph', 'signed', '/auto', 'on-card auto')
LOT_KW      = ('lot of', 'complete set', 'team set')
REPRINT_KW  = ('reprint', 'reproduction')
PARALLEL_KW = ('/1 ', '/2 ', '/3 ', '/4 ', '/5 ', '/10 ', '/25 ', '/50 ')
MULTI_KW    = (' x2', ' x3', '(2)', '(3)', '(4)')


def _extract_price(item: dict) -> Optional[float]:
    """Handle both eBay raw format {price:{value:'2.50'}} and pre-normalised {price:2.50}."""
    raw = item.get('price', {})
    val = raw.get('value') if isinstance(raw, dict) else raw
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _extract_end_date(item: dict) -> Optional[str]:
    """Pull end/sale date from either eBay or Mavin item format."""
    return item.get('end_date') or item.get('itemEndDate')


def _extract_listing_type(item: dict) -> str:
    """Prefer the pre-set listing_type (Mavin sets 'Sold'); fall back to eBay buyingOptions."""
    if 'listing_type' in item:
        return item['listing_type']
    return 'Auction' if 'AUCTION' in (item.get('buyingOptions') or []) else 'BIN'


def _apply_exclusions(title_l: str) -> bool:
    """Return True if this listing should be excluded."""
    if any(k in title_l for k in GRADED_KW):   return True
    if any(k in title_l for k in AUTO_KW):      return True
    if any(k in title_l for k in LOT_KW):       return True
    if any(k in title_l for k in REPRINT_KW):   return True
    if any(k in title_l for k in MULTI_KW):     return True
    if any(k in title_l for k in PARALLEL_KW):  return True
    if re.search(r'/\d{1,3}\b', title_l):       return True
    return False


def filter_items(items, year, brand, player, card_number, team) -> list[dict]:
    """Strict filter: player + year + brand + card number must all match."""
    player_l = player.lower()
    year_s   = str(year)
    brand_l  = brand.lower()
    cn_clean = (card_number or '').lstrip('#').strip()
    results  = []

    for item in items:
        price = _extract_price(item)
        if not price or price < 0.50:
            continue

        title   = item.get('title', '') or ''
        title_l = title.lower()

        if player_l not in title_l: continue
        if year_s   not in title_l: continue
        if _apply_exclusions(title_l): continue

        if cn_clean and not re.search(rf'#?\b{re.escape(cn_clean)}\b', title_l):
            continue

        results.append({
            'price':        price,
            'listing_type': _extract_listing_type(item),
            'end_date':     _extract_end_date(item),
            'title':        title,
        })

    return results


def filter_items_relaxed(items, year, player) -> list[dict]:
    """Relaxed filter: player + year only, no card number or brand required.
    Used as a fallback when strict filtering finds fewer than LOW_DATA_THRESH comps.
    Still excludes graded, lots, autos, reprints and parallels.
    """
    player_l = player.lower()
    year_s   = str(year)
    results  = []

    for item in items:
        price = _extract_price(item)
        if not price or price < 0.50:
            continue

        title   = item.get('title', '') or ''
        title_l = title.lower()

        if player_l not in title_l: continue
        if year_s   not in title_l: continue
        if _apply_exclusions(title_l): continue

        results.append({
            'price':        price,
            'listing_type': _extract_listing_type(item),
            'end_date':     _extract_end_date(item),
            'title':        title,
        })

    return results


def weighted_average(items: list[dict], half_life_days: float = 45) -> dict:
    """Recency-weighted average with IQR outlier removal."""
    if not items:
        return {'price': 0, 'count': 0, 'median': 0, 'min': 0, 'max': 0}

    now = datetime.now(timezone.utc)
    prices_with_age = []
    for item in items:
        ed = item.get('end_date')
        if ed:
            try:
                age = (now - datetime.fromisoformat(ed.replace('Z', '+00:00'))).days
            except Exception:
                age = 0
        else:
            age = 0
        prices_with_age.append((item['price'], age, item.get('listing_type', 'BIN')))

    prices = sorted(p for p, _, _ in prices_with_age)

    # IQR outlier removal
    if len(prices) >= 4:
        q1 = prices[len(prices) // 4]
        q3 = prices[len(prices) * 3 // 4]
        iqr = q3 - q1
        mult = 2.0 if len(prices) < 5 else 1.5
        lo, hi = max(0.50, q1 - mult * iqr), q3 + mult * iqr
        prices_with_age = [(p, a, lt) for p, a, lt in prices_with_age if lo <= p <= hi]

    if not prices_with_age:
        prices_with_age = [(p, a, lt) for p, a, lt in prices_with_age]

    if not prices_with_age:
        return {'price': 0, 'count': 0, 'median': 0, 'min': 0, 'max': 0}

    w_sum = t_sum = 0
    for p, age, lt in prices_with_age:
        w = math.exp(-age / half_life_days)
        if lt == 'Sold':     w *= 1.4   # confirmed transaction > active listing
        elif lt == 'Auction': w *= 1.2  # auction close is also a real price signal
        w_sum += p * w
        t_sum += w

    clean_prices = sorted(p for p, _, _ in prices_with_age)
    mid = len(clean_prices) // 2
    median = clean_prices[mid] if clean_prices else 0

    return {
        'price':  round(w_sum / t_sum, 2) if t_sum else 0,
        'count':  len(prices_with_age),
        'median': round(median, 2),
        'min':    round(clean_prices[0], 2),
        'max':    round(clean_prices[-1], 2),
    }


def floor_value(year: str, brand: str) -> float:
    """Minimum value for a card with no market data at all.
    This is a true last resort — prefer TCDB reference or relaxed eBay comps first.
    """
    y = int(year or 0)
    b = brand.lower()
    # Premium modern brands always carry a floor above commons
    if any(k in b for k in ('topps chrome', 'bowman chrome', 'prizm', 'finest', 'select')): return 2.00
    if 'bowman' in b and y >= 2000: return 1.50
    # Era-based floors
    if y < 1970: return 8.00    # pre-Topps-monopoly vintage — any card has collector value
    if y < 1980: return 3.00    # 1970s Topps commons still trade regularly
    if 1980 <= y <= 1986: return 1.00   # early 80s — Ripken/Gwynn rookies era
    if 1987 <= y <= 1994:               # junk wax — heavily overproduced
        if 'upper deck' in b: return 0.50   # UD was higher quality print run
        if 'stadium club' in b: return 0.60
        if 'fleer ultra' in b: return 0.40
        return 0.35                          # Topps/Donruss/Fleer commons
    if 1995 <= y <= 1999: return 0.75   # insert era — base cards still low
    if 2000 <= y < 2010:  return 1.00
    if 2010 <= y < 2020:  return 1.50
    if y >= 2020:         return 2.00   # modern base cards hold value better
    return 0.75


def scarcity_label(count: int, year: str) -> str:
    y = int(year or 0)
    if count == 0: return 'Unicorn'
    thresholds = (
        (1987, 1994, (50, 25, 10, 5)),
        (1995, 2009, (25, 12, 6, 3)),
        (2010, 2019, (20, 10, 5, 3)),
        (2020, 9999, (30, 15, 7, 3)),
        (0,    1979, (10, 5,  3, 2)),
        (1980, 1986, (15, 8,  4, 2)),
    )
    for lo, hi, (t_base, t_common, t_sp, t_ssp) in thresholds:
        if lo <= y <= hi:
            if count >= t_base:   return 'Base'
            if count >= t_common: return 'Common'
            if count >= t_sp:     return 'Short Print'
            if count >= t_ssp:    return 'SSP'
            return 'Case Hit'
    return 'Unicorn'


def era_cap(price: float, year: str, brand: str, count: int) -> tuple[float, str]:
    y, b = int(year or 0), brand.lower()
    premium = any(k in b for k in ('finest', 'chrome', 'stadium club', 'flair'))
    if 1987 <= y <= 1994 and not premium and price > 25:
        return 10.00, 'Junk wax era cap'
    if y >= 2015 and price > 50 and count < 5:
        if not any(k in b for k in ('chrome', 'prizm', 'bowman', 'select')):
            return 15.00, 'Modern era cap'
    return price, ''


# ══════════════════════════════════════════════════════════════════════════════
# Claude Agent (for difficult cards)
# ══════════════════════════════════════════════════════════════════════════════

_claude = None

def get_claude():
    global _claude
    if _claude is None:
        _claude = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
    return _claude


CLAUDE_TOOLS = [
    {
        'name': 'search_ebay',
        'description': 'Search eBay for baseball card listings. Returns titles and prices of matching items.',
        'input_schema': {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'description': 'Search query, e.g. "1989 Topps 406 Ken Griffey Jr"'},
            },
            'required': ['query']
        }
    },
    {
        'name': 'fetch_page',
        'description': 'Fetch a web page and return its text content. Use for TCDB, Mavin, or other pricing sites.',
        'input_schema': {
            'type': 'object',
            'properties': {
                'url': {'type': 'string', 'description': 'Full URL to fetch'}
            },
            'required': ['url']
        }
    }
]

SYSTEM_PROMPT = """You are an expert baseball card appraiser pricing raw (ungraded) cards for a collector's inventory.

Given a card description, use the search_ebay tool to find comparable recent sales.
You can also use fetch_page to check sites like:
- https://mavin.io/search?q=QUERY (aggregated eBay prices)
- https://www.tcdb.com/Search.cfm?searchterm=QUERY

Rules:
- Price raw/ungraded cards only (ignore PSA/BGS/SGC graded comps)
- Ignore autographed, lot, reprint, and numbered parallel listings
- Focus on cards matching the year, brand, player, and card number exactly
- Weight recent sales more heavily than older ones
- After gathering data, respond with ONLY this JSON (no markdown):

{
  "price": <number>,
  "confidence": "High" | "Medium" | "Low",
  "data_points": <number>,
  "reasoning": "<one sentence>",
  "sources": ["<source1>", ...]
}"""


def execute_tool(name: str, inputs: dict) -> str:
    if name == 'search_ebay':
        items = ebay_search(inputs['query'])
        if not items:
            return 'No results found.'
        lines = [f'${i.get("price",{}).get("value","?")} — {i.get("title","?")}' for i in items[:20]]
        return '\n'.join(lines)

    elif name == 'fetch_page':
        try:
            r = requests.get(inputs['url'], headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
            # Strip HTML tags, collapse whitespace
            text = re.sub(r'<[^>]+>', ' ', r.text)
            text = re.sub(r'\s+', ' ', text).strip()
            return text[:4000]  # trim to avoid huge contexts
        except Exception as e:
            return f'Fetch error: {e}'

    return 'Unknown tool.'


def price_with_claude(card: dict) -> Optional[dict]:
    """Call Claude with tool use to price a difficult card."""
    client = get_claude()
    tcdb_ref = card.get('tcdb_price') or 'unknown'
    desc = (
        f"Year: {card['year']}\n"
        f"Brand: {card['brand']}\n"
        f"Player: {card['player']}\n"
        f"Card Number: {card['card_number'] or 'N/A'}\n"
        f"Team: {card['team'] or 'N/A'}\n"
        f"TCDB Reference Price: ${tcdb_ref}"
    )
    messages = [{'role': 'user', 'content': f'Please price this baseball card:\n\n{desc}'}]

    try:
        for _ in range(6):   # max tool-use rounds
            resp = client.messages.create(
                model='claude-sonnet-4-5',
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=CLAUDE_TOOLS,
                messages=messages
            )

            if resp.stop_reason == 'tool_use':
                tool_results = []
                for block in resp.content:
                    if block.type == 'tool_use':
                        result = execute_tool(block.name, block.input)
                        tool_results.append({
                            'type': 'tool_result',
                            'tool_use_id': block.id,
                            'content': result
                        })
                messages.append({'role': 'assistant', 'content': resp.content})
                messages.append({'role': 'user', 'content': tool_results})

            elif resp.stop_reason == 'end_turn':
                # Extract JSON from last text block
                for block in resp.content:
                    if hasattr(block, 'text'):
                        try:
                            return json.loads(block.text.strip())
                        except json.JSONDecodeError:
                            # Try to extract JSON from surrounding text
                            m = re.search(r'\{.*\}', block.text, re.DOTALL)
                            if m:
                                return json.loads(m.group())
                break

    except Exception as e:
        log.error('Claude error for %s %s %s: %s', card['year'], card['brand'], card['player'], e)

    return None


# ══════════════════════════════════════════════════════════════════════════════
# Card Processing
# ══════════════════════════════════════════════════════════════════════════════

def needs_pricing(row: list, row_index: int) -> bool:
    """Return True if this card should be re-priced given the current RUN_MODE."""
    def get(col): return (row[col].strip() if col < len(row) and row[col] else '')

    player = get(C['PLAYER'])
    year   = get(C['YEAR'])
    brand  = get(C['BRAND'])
    if not player or not year or not brand:
        return False

    # Player mode: force re-price any card whose player matches the target
    if RUN_MODE == 'player' and TARGET_PLAYER:
        return TARGET_PLAYER in player.lower()

    price    = get(C['AVG_PRICE'])
    last_upd = get(C['LAST_UPDATED'])

    if not price or price == '0':
        return True

    if last_upd:
        try:
            lu = datetime.fromisoformat(last_upd.replace('Z', '+00:00'))
            if lu.tzinfo is None:
                lu = lu.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - lu).days < STALE_DAYS:
                return False
        except Exception:
            pass

    return True


def process_card(row: list, row_number: int) -> Optional[dict]:
    """Price one card.

    Returns a dict with:
      'row'      — 1-based sheet row number
      'segments' — non-contiguous write segments for write_rows()
      'card'     — card data dict for the results JSON
    """
    def get(col): return (row[col] if col < len(row) else '').strip() if col < len(row) else ''

    card = {
        'year':        get(C['YEAR']),
        'brand':       get(C['BRAND']),
        'player':      get(C['PLAYER']),
        'card_number': get(C['CARD_NUMBER']).lstrip('#'),
        'team':        get(C['TEAM']),
        'tcdb_price':  get(C['TCDB_PRICE']),   # F — reference only, we don't write back
    }

    label = f"Row {row_number}: {card['year']} {card['brand']} {card['player']}"
    log.info('Pricing %s', label)

    # ── Step 1: eBay active listings + Mavin sold prices (strict filter) ────────
    query = f"{card['year']} {card['brand']} {card['player']}"

    ebay_items  = ebay_search(query)
    mavin_items = fetch_mavin_prices(
        card['year'], card['brand'], card['player'], card['card_number']
    )

    ebay_filtered  = filter_items(
        ebay_items,  card['year'], card['brand'], card['player'],
        card['card_number'], card['team']
    )
    mavin_filtered = filter_items(
        mavin_items, card['year'], card['brand'], card['player'],
        card['card_number'], card['team']
    )
    combined = ebay_filtered + mavin_filtered
    result   = weighted_average(combined)

    ebay_count  = len(ebay_filtered)
    mavin_count = len(mavin_filtered)
    fallback    = None   # tracks which fallback tier was used

    # ── Step 1b: Relaxed filter — player + year only, no card number/brand ────
    # Fires when strict comps are too thin. Gives a market signal even for
    # cards that are rarely listed under an exact card-number search.
    if result['count'] < LOW_DATA_THRESH:
        relaxed_ebay  = filter_items_relaxed(ebay_items,  card['year'], card['player'])
        relaxed_mavin = filter_items_relaxed(mavin_items, card['year'], card['player'])
        relaxed_all   = relaxed_ebay + relaxed_mavin
        if len(relaxed_all) >= LOW_DATA_THRESH:
            result   = weighted_average(relaxed_all)
            fallback = 'relaxed'
            ebay_count  = len(relaxed_ebay)
            mavin_count = len(relaxed_mavin)
            log.info('  → Relaxed filter: %d comps', result['count'])

    # ── Step 1c: TCDB reference price ─────────────────────────────────────────
    # If both filters still come up empty but TCDB has a value, use it as our
    # estimate rather than jumping straight to a generic floor.
    if result['count'] == 0 and card['tcdb_price']:
        tp = parse_price(card['tcdb_price'])
        if tp and tp > 0:
            result = {'price': tp, 'count': 1, 'median': tp, 'min': tp, 'max': tp}
            fallback = 'tcdb'
            log.info('  → No market comps — using TCDB reference $%.2f', tp)

    # Source label for logging
    if fallback == 'tcdb':
        source = 'TCDB reference'
    elif mavin_count and ebay_count:
        source = f'eBay ({ebay_count}) + Mavin sold ({mavin_count})'
        if fallback == 'relaxed': source += ' [relaxed]'
    elif mavin_count:
        source = f'Mavin sold ({mavin_count})'
        if fallback == 'relaxed': source += ' [relaxed]'
    else:
        source = f'eBay ({ebay_count})'
        if fallback == 'relaxed': source += ' [relaxed]'

    use_claude = (
        result['count'] < LOW_DATA_THRESH
        or result['price'] >= HIGH_VALUE_THRESH
    )

    claude_reasoning = ''

    # ── Step 2: Claude for difficult / high-value cards ───────────────────────
    if use_claude:
        log.info('  → Using Claude (%s comps, $%.2f)', result['count'], result['price'])
        cr = price_with_claude(card)
        if cr and cr.get('price', 0) > 0:
            # Blend: Claude wins on confidence, algorithmic wins on data volume
            if cr['confidence'] in ('High',) or result['count'] < LOW_DATA_THRESH:
                result['price'] = cr['price']
                result['count'] = cr.get('data_points', result['count'])
            source           = ', '.join(cr.get('sources', ['Claude']))
            claude_reasoning = cr.get('reasoning', '')
        else:
            log.info('  → Claude returned no result, keeping algorithmic')

    # ── Step 3: Era cap + floor ────────────────────────────────────────────────
    if result['price'] == 0:
        fp   = floor_value(card['year'], card['brand'])
        conf = 'Floor Value'
    else:
        fp, cap_note = era_cap(result['price'], card['year'], card['brand'], result['count'])
        if fallback == 'tcdb':
            conf = 'Low (TCDB ref)'
        elif fallback == 'relaxed':
            conf = 'Low (relaxed)'
        else:
            levels = {10: 'Very High', 5: 'High', 3: 'Medium'}
            conf   = next((v for k, v in levels.items() if result['count'] >= k), 'Low')
        if use_claude and 'Low' not in conf:
            conf += ' (Claude)'

    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Write segments ─────────────────────────────────────────────────────────
    # Segment 1 : G  — Avg eBay Price  (col index 6)
    # Segment 2 : K–M — Median / Last Updated / Confidence  (col indices 10-12)
    # H and I are intentionally skipped.
    segments = [
        {'col': C['AVG_PRICE'], 'values': [round(fp, 2)]},
        {'col': C['MEDIAN'],    'values': [result['median'], now_iso, conf]},
    ]

    return {
        'row':      row_number,
        'segments': segments,
        'card': {
            'player':       card['player'],
            'year':         card['year'],
            'brand':        card['brand'],
            'card_number':  card['card_number'],
            'team':         card['team'],
            'tcdb_price':   parse_price(card['tcdb_price']),
            'avg_price':    round(fp, 2),
            'median':       result['median'],
            'confidence':   conf,
            'last_updated': now_iso,
            'card_id':      make_card_id(card['year'], card['brand'], card['player'], card['card_number']),
        }
    }


# ══════════════════════════════════════════════════════════════════════════════
# Results JSON (for Further Insights page)
# ══════════════════════════════════════════════════════════════════════════════

def build_results_json(all_rows: list[list], priced_cards: list[dict]) -> dict:
    """Merge freshly priced cards with existing sheet data into a full snapshot."""
    fresh = {r['row']: r['card'] for r in priced_cards}

    cards = []
    for i, row in enumerate(all_rows[1:], start=2):   # skip header row
        def get(col): return (row[col] if col < len(row) else '').strip() if col < len(row) else ''
        if not get(C['PLAYER']):
            continue

        if i in fresh:
            c = fresh[i]
        else:
            price  = get(C['AVG_PRICE'])
            median = get(C['MEDIAN'])
            c = {
                'player':       get(C['PLAYER']),
                'year':         get(C['YEAR']),
                'brand':        get(C['BRAND']),
                'card_number':  get(C['CARD_NUMBER']),
                'team':         get(C['TEAM']),
                'tcdb_price':   parse_price(get(C['TCDB_PRICE'])),
                'avg_price':    parse_price(price),
                'median':       parse_price(median),
                'confidence':   get(C['CONFIDENCE']),
                'last_updated': get(C['LAST_UPDATED']),
                'card_id':      make_card_id(
                    get(C['YEAR']), get(C['BRAND']),
                    get(C['PLAYER']), get(C['CARD_NUMBER'])
                ),
            }
        cards.append(c)

    priced = [c for c in cards if c.get('avg_price')]
    total  = sum(c['avg_price'] for c in priced)
    top25  = sorted(priced, key=lambda c: c['avg_price'], reverse=True)[:25]

    # ── Era breakdown ─────────────────────────────────────────────────────────
    def era(y):
        y = int(y or 0)
        if y < 1970: return 'Vintage (pre-1970)'
        if y < 1980: return '1970s'
        if y < 1987: return 'Early 80s'
        if y < 1995: return 'Junk Wax (1987–94)'
        if y < 2000: return 'Late 90s'
        if y < 2010: return '2000s'
        if y < 2020: return '2010s'
        return 'Modern (2020+)'

    by_era: dict = {}
    for c in priced:
        e = era(c.get('year', 0))
        bucket = by_era.setdefault(e, {'count': 0, 'total_value': 0})
        bucket['count']       += 1
        bucket['total_value'] += c['avg_price']

    # ── Brand breakdown ───────────────────────────────────────────────────────
    by_brand: dict = {}
    for c in priced:
        b = c.get('brand') or 'Unknown'
        bucket = by_brand.setdefault(b, {'count': 0, 'total_value': 0})
        bucket['count']       += 1
        bucket['total_value'] += c['avg_price']

    return {
        'last_updated':   datetime.now(timezone.utc).isoformat(),
        'total_cards':    len(cards),
        'cards_priced':   len(priced),
        'total_value':    round(total, 2),
        'avg_value':      round(total / len(priced), 2) if priced else 0,
        'top_card_value': round(top25[0]['avg_price'], 2) if top25 else 0,
        'top_cards':      top25,
        'by_era':         by_era,
        'by_brand':       by_brand,
        'cards':          cards,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def commit_progress(label: str = ''):
    """Commit data files mid-run (used by full mode for incremental saves)."""
    import subprocess
    try:
        subprocess.run(['git', 'config', 'user.name',  'github-actions[bot]'], check=True)
        subprocess.run(['git', 'config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], check=True)
        subprocess.run(['git', 'add', RESULTS_FILE, HISTORY_FILE], check=True)
        diff = subprocess.run(['git', 'diff', '--cached', '--quiet'])
        if diff.returncode != 0:
            msg = f'chore: pricing progress [{label}]' if label else 'chore: pricing progress'
            subprocess.run(['git', 'commit', '-m', msg], check=True)
            subprocess.run(['git', 'push'], check=True)
            log.info('Committed progress: %s', label)
        else:
            log.info('No changes to commit for checkpoint: %s', label)
    except Exception as e:
        log.warning('Failed to commit progress: %s', e)


def process_batch(batch: list, service) -> list:
    """Price a list of (row_num, row) tuples. Returns result dicts."""
    results, api_calls = [], 0
    for row_num, row in batch:
        try:
            r = process_card(row, row_num)
            if r:
                results.append(r)
                api_calls += 1
        except Exception as e:
            log.error('Failed row %d: %s', row_num, e)
        if api_calls > 0 and api_calls % 100 == 0:
            log.info('Rate limit pause…')
            time.sleep(0.5)
    if results:
        write_rows(service, [{'row': r['row'], 'segments': r['segments']} for r in results])
    return results


def main():
    global C

    log.info('=== Baseball Card Pricing Agent ===')
    log.info('Mode: %s  |  Batch size: %d  |  Stale threshold: %d days',
             RUN_MODE.upper(), BATCH_SIZE, STALE_DAYS)
    if RUN_MODE == 'player':
        log.info('Target player: "%s"', TARGET_PLAYER or '(none)')

    service = get_sheets_service()
    rows    = read_sheet(service)

    if len(rows) < 2:
        log.error('Sheet appears empty')
        sys.exit(1)

    # ── Dynamic column detection ───────────────────────────────────────────────
    C = detect_columns(rows[0])

    # ── Find candidates ────────────────────────────────────────────────────────
    candidates = [
        (i + 2, row)
        for i, row in enumerate(rows[1:])
        if needs_pricing(row, i + 2)
    ]
    log.info('%d / %d cards need pricing', len(candidates), len(rows) - 1)

    if not candidates:
        log.info('Nothing to price — exiting.')
        # Still rebuild the results JSON so the page stays fresh
        rows = read_sheet(service)

    # ── Run modes ─────────────────────────────────────────────────────────────
    all_results: list = []

    if RUN_MODE == 'full':
        # Process everything in chunks, committing after each so progress is
        # saved even if the job hits the 6-hour timeout limit.
        total = len(candidates)
        for chunk_start in range(0, total, FULL_RUN_CHUNK):
            chunk  = candidates[chunk_start:chunk_start + FULL_RUN_CHUNK]
            log.info('--- Chunk %d–%d of %d ---',
                     chunk_start + 1, chunk_start + len(chunk), total)
            chunk_results = process_batch(chunk, service)
            all_results.extend(chunk_results)

            # Rebuild JSON with everything priced so far and commit
            rows   = read_sheet(service)
            output = build_results_json(rows, all_results)
            _save_outputs(output, all_results)
            commit_progress(f'{chunk_start + len(chunk)}/{total}')
    else:
        # Batch or player mode: process once, commit at the end via the
        # workflow's "Commit pricing results" step.
        batch       = candidates if RUN_MODE == 'player' else candidates[:BATCH_SIZE]
        all_results = process_batch(batch, service)
        rows        = read_sheet(service)

    log.info('Processed %d cards total', len(all_results))

    # Final save (full mode already saved incrementally, this is a no-op if
    # nothing changed; batch/player mode saves here for the first time)
    os.makedirs('data', exist_ok=True)
    output = build_results_json(rows, all_results)
    _save_outputs(output, all_results)
    log.info('Done. Total value: $%.2f across %d cards', output['total_value'], output['cards_priced'])


def _save_outputs(output: dict, results: list):
    """Write pricing_results.json and price_history.json."""
    os.makedirs('data', exist_ok=True)

    # ── Price history ──────────────────────────────────────────────────────────
    try:
        with open(HISTORY_FILE) as f:
            price_history = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        price_history = {}

    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    for r in results:
        cid   = r['card']['card_id']
        entry = {'price': r['card']['avg_price'], 'date': today}
        hist  = price_history.get(cid, [])
        if hist and hist[-1]['date'] == today:
            hist[-1] = entry
        else:
            hist.append(entry)
        price_history[cid] = hist[-HISTORY_MAX:]

    port_entry = {'date': today, 'total_value': output['total_value'], 'cards_priced': output['cards_priced']}
    port_hist  = price_history.get('_portfolio', [])
    if port_hist and port_hist[-1]['date'] == today:
        port_hist[-1] = port_entry
    else:
        port_hist.append(port_entry)
    price_history['_portfolio'] = port_hist[-HISTORY_MAX:]

    with open(HISTORY_FILE, 'w') as f:
        json.dump(price_history, f, separators=(',', ':'))

    output['_portfolio'] = price_history['_portfolio']
    with open(RESULTS_FILE, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    log.info('Saved %s (%.0f KB)', RESULTS_FILE, os.path.getsize(RESULTS_FILE) / 1024)


if __name__ == '__main__':
    main()
