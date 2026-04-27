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

import os, sys, json, time, base64, re, math, logging, signal
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
STALE_DAYS         = int(os.environ.get('STALE_DAYS', '30'))  # re-price cards older than this (0 = force all)
HIGH_VALUE_THRESH  = 10.0        # use Claude for cards above this price (lowered from $20 to widen the tighter-refresh band)
LOW_DATA_THRESH    = 3           # use Claude if fewer than this many comps
CLAUDE_MIN_COMPS   = 15          # skip Claude for high-value cards that already have this many comps
EBAY_SLEEP_MS      = 100         # ms between eBay API calls
EBAY_CATEGORY      = '212'       # Baseball Cards
EBAY_PRICE_RANGE   = '0.50..500'
CARD_TIMEOUT_SEC   = 90          # max wall-clock seconds per card before skipping
SHEETS_RETRIES     = 4           # retry attempts for Google Sheets API calls
EBAY_RETRIES       = 3           # retry attempts for eBay API calls
EBAY_QUOTA_MIN     = 50          # exit gracefully when fewer than this many calls remain
HISTORY_FILE       = 'data/price_history.json'
HISTORY_MAX        = 24          # snapshots per card (≈2 years of monthly runs)
FULL_RUN_CHUNK     = 200         # cards per incremental commit in full mode
EBAY_CACHE_FILE    = 'data/ebay_cache.json'
EBAY_CACHE_PERSIST_TTL = 24 * 3600   # 24 h — skip the eBay call entirely if result is fresher than this
EBAY_CACHE_PRUNE_DAYS  = 7           # drop persisted entries older than this on save
RUN_METADATA_FILE  = 'data/run_metadata.json'
SUMMARY_FILE       = 'data/pricing_summary.json'

RUN_MODE      = os.environ.get('RUN_MODE', 'batch').lower()   # batch | full | player | tcdb
TARGET_PLAYER = os.environ.get('TARGET_PLAYER', '').strip().lower()
START_ROW     = int(os.environ.get('START_ROW', '0'))  # skip sheet rows below this (0 = no skip)

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


def audit_input_rows(rows: list[list]) -> dict:
    """Scan the sheet for data-entry issues. LOG ONLY — never filters rows.
    Returns counts so the run_metadata can surface them for the owner."""
    if len(rows) < 2:
        return {'empty_player': 0, 'missing_brand': 0, 'bad_year': 0, 'negative_price': 0}
    def get(r, col): return (r[col].strip() if col < len(r) and r[col] else '')

    empty_player = missing_brand = bad_year = negative_price = 0
    now_year = datetime.now(timezone.utc).year
    for i, row in enumerate(rows[1:], start=2):
        player = get(row, C['PLAYER'])
        year   = get(row, C['YEAR'])
        brand  = get(row, C['BRAND'])
        tcdb   = get(row, C['TCDB_PRICE'])
        if not player:
            empty_player += 1
            log.warning('Input row %d has no player name', i)
        if not brand:
            missing_brand += 1
            log.warning('Input row %d (%s) has no brand', i, player or '?')
        if year:
            try:
                y = int(year)
                if y < 1850 or y > now_year + 1:
                    bad_year += 1
                    log.warning('Input row %d (%s) has out-of-range year "%s"', i, player or '?', year)
            except ValueError:
                bad_year += 1
                log.warning('Input row %d (%s) has non-numeric year "%s"', i, player or '?', year)
        if tcdb:
            p = parse_price(tcdb)
            if p is not None and p < 0:
                negative_price += 1
                log.warning('Input row %d (%s) has negative TCDB price %s', i, player or '?', tcdb)
    return {
        'empty_player':  empty_player,
        'missing_brand': missing_brand,
        'bad_year':      bad_year,
        'negative_price': negative_price,
    }


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
    for attempt in range(SHEETS_RETRIES):
        try:
            service.values().batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={'valueInputOption': 'USER_ENTERED', 'data': data}
            ).execute()
            log.info('Wrote %d rows (%d range segments) to sheet', len(updates), len(data))
            return
        except Exception as e:
            if attempt == SHEETS_RETRIES - 1:
                raise
            wait = 2 ** (attempt + 1)   # 2, 4, 8 seconds
            log.warning('Sheet write error (attempt %d/%d): %s — retrying in %ds',
                        attempt + 1, SHEETS_RETRIES, e, wait)
            time.sleep(wait)


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
_ebay_quota_exhausted: bool = False   # set True on any 429 → triggers graceful save+exit

# Query-level caches — keyed on query string, value is (timestamp, items).
# Prevents duplicate API calls when multiple cards share the same query
# (same player/year/brand, different card number).
_ebay_cache:  dict[str, tuple[float, list]] = {}
EBAY_CACHE_TTL  = 600   # 10 minutes (in-memory fast-path)

# Persistent disk cache — survives across GHA runs. Skips eBay entirely when a
# recent result is already on disk. Counters power run_metadata telemetry.
_ebay_persist_cache: dict[str, dict] = {}   # {cache_key: {'ts': float, 'items': list}}
_ebay_persist_loaded: bool = False
_ebay_cache_hits:     int  = 0
_ebay_cache_misses:   int  = 0


def _slim_item(it: dict) -> dict:
    """Project an eBay item down to the fields actually read downstream.

    The raw Browse API itemSummaries payload is ~250 KB per query; storing the
    full payload blew the cache file past GitHub's 100 MB push limit. Only
    price, title, condition, and listing_type are consumed by the pricing
    pipeline, so slim to those before persisting.
    """
    if not isinstance(it, dict):
        return {}
    p = it.get('price') or {}
    slim = {
        'price': {'value': p.get('value'), 'currency': p.get('currency')},
        'title': it.get('title', ''),
        'condition': it.get('condition'),
    }
    # Preserve listing_type — either pre-normalised or derived from buyingOptions
    # (the downstream helper reads both shapes).
    if 'listing_type' in it:
        slim['listing_type'] = it['listing_type']
    elif it.get('buyingOptions'):
        slim['buyingOptions'] = it['buyingOptions']
    # Preserve end date for age-weighted averaging (recency matters).
    if it.get('end_date'):
        slim['end_date'] = it['end_date']
    elif it.get('itemEndDate'):
        slim['itemEndDate'] = it['itemEndDate']
    return slim


def _load_ebay_persist_cache():
    """Load the on-disk eBay cache once per run. Safe to call repeatedly."""
    global _ebay_persist_cache, _ebay_persist_loaded
    if _ebay_persist_loaded:
        return
    _ebay_persist_loaded = True
    try:
        with open(EBAY_CACHE_FILE) as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            # Migrate any fat legacy entries to the slim shape on load.
            for k, v in raw.items():
                if isinstance(v, dict) and isinstance(v.get('items'), list):
                    v['items'] = [_slim_item(i) for i in v['items']]
            _ebay_persist_cache = raw
            log.info('Loaded %d persisted eBay cache entries', len(_ebay_persist_cache))
    except (FileNotFoundError, json.JSONDecodeError):
        _ebay_persist_cache = {}


def _save_ebay_persist_cache():
    """Write the eBay cache to disk, pruning entries older than EBAY_CACHE_PRUNE_DAYS."""
    if not _ebay_persist_loaded:
        return
    try:
        os.makedirs('data', exist_ok=True)
        cutoff = time.time() - EBAY_CACHE_PRUNE_DAYS * 86400
        pruned = {k: v for k, v in _ebay_persist_cache.items()
                  if isinstance(v, dict) and v.get('ts', 0) >= cutoff}
        with open(EBAY_CACHE_FILE, 'w') as f:
            json.dump(pruned, f, separators=(',', ':'))
        log.info('Saved eBay cache: %d entries (%.0f KB), hits=%d misses=%d',
                 len(pruned), os.path.getsize(EBAY_CACHE_FILE) / 1024,
                 _ebay_cache_hits, _ebay_cache_misses)
    except Exception as e:
        log.warning('Failed to save eBay cache: %s', e)


def _persist_cache_get(key: str) -> Optional[list]:
    """Return cached items if fresher than EBAY_CACHE_PERSIST_TTL, else None."""
    _load_ebay_persist_cache()
    entry = _ebay_persist_cache.get(key)
    if not entry:
        return None
    if time.time() - entry.get('ts', 0) >= EBAY_CACHE_PERSIST_TTL:
        return None
    return entry.get('items')


def _persist_cache_put(key: str, items: list):
    """Store items in the on-disk cache. No-op on empty items to force re-fetch next time."""
    if not items:
        return
    _load_ebay_persist_cache()
    _ebay_persist_cache[key] = {'ts': time.time(), 'items': [_slim_item(i) for i in items]}


def get_ebay_token() -> str:
    global _ebay_token, _ebay_token_expiry
    if _ebay_token and _ebay_token_expiry and datetime.now(timezone.utc) < _ebay_token_expiry:
        return _ebay_token

    app_id = os.environ['EBAY_APP_ID']
    secret = os.environ['EBAY_CLIENT_SECRET']
    creds  = base64.b64encode(f'{app_id}:{secret}'.encode()).decode()

    # Retry with exponential backoff — a transient DNS/network blip on the
    # GHA runner can fail the token fetch and kill the entire run.
    for attempt in range(4):
        try:
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
        except Exception as e:
            if attempt == 3:
                raise
            wait = 2 ** attempt   # 1s, 2s, 4s
            log.warning('eBay token fetch failed (attempt %d/4): %s — retrying in %ds', attempt + 1, e, wait)
            time.sleep(wait)


# ══════════════════════════════════════════════════════════════════════════════
# eBay Search
# ══════════════════════════════════════════════════════════════════════════════

class EbayQuotaExhausted(Exception):
    """Raised when the eBay daily API quota is exhausted. Triggers a graceful save+exit."""
    pass


def _check_ebay_quota(headers: dict):
    """Inspect eBay rate-limit headers. Raises EbayQuotaExhausted if the daily
    limit is spent and the reset is more than 5 minutes away."""
    global _ebay_quota_exhausted
    remaining = headers.get('X-RateLimit-Remaining') or headers.get('x-ratelimit-remaining')
    reset_ts   = headers.get('X-RateLimit-Reset')    or headers.get('x-ratelimit-reset')
    if remaining is not None:
        try:
            rem = int(remaining)
            log.debug('eBay quota remaining: %d', rem)
            if rem <= EBAY_QUOTA_MIN:
                reset_msg = ''
                if reset_ts:
                    try:
                        reset_dt  = datetime.fromtimestamp(int(reset_ts), tz=timezone.utc)
                        secs_away = (reset_dt - datetime.now(timezone.utc)).total_seconds()
                        reset_msg = f' — resets in {int(secs_away/3600)}h {int((secs_away%3600)/60)}m'
                        if secs_away > 300:   # more than 5 min → not worth waiting
                            _ebay_quota_exhausted = True
                            raise EbayQuotaExhausted(
                                f'eBay daily quota exhausted ({rem} calls left{reset_msg}). '
                                'Committing progress and exiting — re-run after quota resets.'
                            )
                    except (ValueError, TypeError):
                        pass
                log.warning('eBay quota low: %d calls remaining%s', rem, reset_msg)
        except (ValueError, TypeError):
            pass


def ebay_search(query: str, price_filter: str = None) -> list[dict]:
    """Search eBay Browse API. Any 429 triggers an immediate graceful save+exit —
    there is nothing productive to do while throttled, and waiting wastes runner minutes."""
    global _ebay_quota_exhausted, _ebay_cache_hits, _ebay_cache_misses

    if _ebay_quota_exhausted:
        raise EbayQuotaExhausted('eBay quota already exhausted this run.')

    # 1. In-memory cache — same-run duplicate queries
    cache_key = f'{query}|{price_filter or ""}'
    _now_ts   = time.time()
    _cached   = _ebay_cache.get(cache_key)
    if _cached and _now_ts - _cached[0] < EBAY_CACHE_TTL:
        log.debug('eBay cache hit (mem) for "%s"', query)
        _ebay_cache_hits += 1
        return _cached[1]

    # 2. Persistent cache — skip eBay entirely if a fresh result is on disk
    persisted = _persist_cache_get(cache_key)
    if persisted is not None:
        log.debug('eBay cache hit (disk) for "%s"', query)
        _ebay_cache[cache_key] = (_now_ts, persisted)   # warm in-memory
        _ebay_cache_hits += 1
        return persisted
    _ebay_cache_misses += 1

    token      = get_ebay_token()
    filter_str = f'buyingOptions:{{FIXED_PRICE|AUCTION}},price:[{price_filter or EBAY_PRICE_RANGE}],itemLocationCountry:US'
    params = {
        'q':            f'{query} baseball',
        'category_ids': EBAY_CATEGORY,
        'filter':       filter_str,
        'sort':         'bestMatch',
        'limit':        '200',
    }
    for attempt in range(EBAY_RETRIES):
        try:
            r = requests.get(
                'https://api.ebay.com/buy/browse/v1/item_summary/search',
                headers={
                    'Authorization':           f'Bearer {token}',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                },
                params=params,
                timeout=15
            )
            time.sleep(EBAY_SLEEP_MS / 1000)

            # Always check quota headers, even on success
            _check_ebay_quota(r.headers)

            if r.status_code == 200:
                result = r.json().get('itemSummaries', [])
                if result:   # don't cache empty results (re-fetch on next call)
                    _ebay_cache[cache_key] = (time.time(), result)
                    _persist_cache_put(cache_key, result)
                return result

            if r.status_code == 429:
                # Stop immediately — no point sleeping or retrying.
                # Save progress and exit; re-run tomorrow once quota resets.
                retry_after = r.headers.get('Retry-After', '?')
                _ebay_quota_exhausted = True
                raise EbayQuotaExhausted(
                    f'eBay 429 (Retry-After: {retry_after}s) — saving progress and exiting. '
                    'Re-run once eBay quota resets (usually midnight UTC).'
                )

            log.warning('eBay %s for query "%s"', r.status_code, query)
            return []

        except EbayQuotaExhausted:
            raise   # propagate to process_batch → main for graceful save+exit
        except Exception as e:
            if attempt == EBAY_RETRIES - 1:
                log.warning('eBay search failed after %d attempts: %s', EBAY_RETRIES, e)
                return []
            time.sleep(5 * (attempt + 1))

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
PREMIUM_KW  = ('refractor', 'prizm', 'rainbow foil', 'xfractor', 'superfractor',
               'atomic refractor', 'sepia', 'gold parallel', 'negative refractor')
INSERT_KW   = ('insert', 'award winners', 'career highlights',
               'future stars', 'franchise favorites')


def _extract_price(item: dict) -> Optional[float]:
    """Handle both eBay raw format {price:{value:'2.50'}} and pre-normalised {price:2.50}."""
    raw = item.get('price', {})
    val = raw.get('value') if isinstance(raw, dict) else raw
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _extract_end_date(item: dict) -> Optional[str]:
    """Pull end/sale date from an eBay item dict."""
    return item.get('end_date') or item.get('itemEndDate')


def _extract_listing_type(item: dict) -> str:
    """Prefer the pre-set listing_type; fall back to eBay buyingOptions."""
    if 'listing_type' in item:
        return item['listing_type']
    return 'Auction' if 'AUCTION' in (item.get('buyingOptions') or []) else 'BIN'


def _norm_player(name: str) -> str:
    """Normalise a player name for fuzzy title matching.

    eBay listings consistently omit commas and trailing dots that appear in
    some sheet entries (e.g. "Sandy Alomar, Jr." → "sandy alomar jr").
    """
    return re.sub(r'[,.]', '', name.lower()).strip()


_PLAYER_NICKNAMES: dict[str, list[str]] = {
    # Formal → informal
    'david':      ['dave'],
    'dave':       ['david'],
    'michael':    ['mike'],
    'mike':       ['michael'],
    'robert':     ['bob', 'rob', 'bobby'],
    'bob':        ['robert', 'rob'],
    'rob':        ['robert', 'bob'],
    'bobby':      ['robert', 'bob'],
    'william':    ['bill', 'will', 'billy'],
    'bill':       ['william', 'billy'],
    'billy':      ['bill', 'william'],
    'james':      ['jim', 'jimmy'],
    'jim':        ['james', 'jimmy'],
    'jimmy':      ['jim', 'james'],
    'joseph':     ['joe'],
    'joe':        ['joseph'],
    'john':       ['johnny'],
    'johnny':     ['john'],
    'thomas':     ['tom', 'tommy'],
    'tom':        ['thomas', 'tommy'],
    'tommy':      ['tom', 'thomas'],
    'richard':    ['rick', 'rich', 'ricky', 'dick'],
    'rick':       ['richard', 'ricky'],
    'ricky':      ['rick', 'richard'],
    'rich':       ['richard'],
    'charles':    ['charlie', 'chuck'],
    'charlie':    ['charles', 'chuck'],
    'chuck':      ['charles', 'charlie'],
    'christopher': ['chris'],
    'chris':      ['christopher'],
    'anthony':    ['tony'],
    'tony':       ['anthony'],
    'edward':     ['ed', 'eddie'],
    'ed':         ['edward', 'eddie'],
    'eddie':      ['ed', 'edward'],
    'george':     ['georgie'],
    'kenneth':    ['ken', 'kenny'],
    'ken':        ['kenneth', 'kenny'],
    'kenny':      ['ken', 'kenneth'],
    'lawrence':   ['larry'],
    'larry':      ['lawrence'],
    'leonard':    ['lenny', 'len'],
    'lenny':      ['leonard', 'len'],
    'nicholas':   ['nick'],
    'nick':       ['nicholas'],
    'patrick':    ['pat'],
    'pat':        ['patrick'],
    'peter':      ['pete'],
    'pete':       ['peter'],
    'randall':    ['randy'],
    'randy':      ['randall'],
    'raymond':    ['ray'],
    'ray':        ['raymond'],
    'ronald':     ['ron', 'ronnie'],
    'ron':        ['ronald', 'ronnie'],
    'stephen':    ['steve', 'stevie'],
    'steve':      ['stephen', 'steven'],
    'steven':     ['steve', 'stephen'],
    'timothy':    ['tim', 'timmy'],
    'tim':        ['timothy', 'timmy'],
    'walter':     ['walt'],
    'walt':       ['walter'],
    # Baseball-specific common nicknames
    'cal':        ['calvin'],
    'calvin':     ['cal'],
    'chipper':    ['larry'],     # Chipper Jones = Larry Jones
    'larry':      ['chipper'],
    'nomar':      ['anthony'],   # Nomar Garciaparra
    'tino':       ['constantino'],
    'manny':      ['manuel'],
    'manuel':     ['manny'],
    'pedro':      ['peter'],
    'vlad':       ['vladimir'],
    'vladimir':   ['vlad'],
    'pudge':      ['ivan'],      # Ivan Rodriguez
    'ivan':       ['pudge'],
    'moose':      ['mike'],      # Mike Mussina
    'doc':        ['dwight'],    # Dwight Gooden
    'dwight':     ['doc'],
    # More formal ↔ informal pairs common in baseball
    'ernest':     ['ernie'],          # Ernie Banks, Ernie Riles
    'ernie':      ['ernest'],
    'bernard':    ['bernie'],         # Bernie Williams, Bernie Carbo
    'bernie':     ['bernard'],
    'henry':      ['hank'],           # Hank Aaron, Hank Blalock
    'hank':       ['henry'],
    'reginald':   ['reggie'],         # Reggie Jackson, Reggie Sanders
    'reggie':     ['reginald'],
    'frederick':  ['fred', 'freddie'],# Fred McGriff, Freddie Freeman
    'fred':       ['frederick', 'freddie'],
    'freddie':    ['fred', 'frederick'],
    'andrew':     ['andy'],           # Andy Pettitte, Andy Van Slyke
    'andy':       ['andrew'],
    'donald':     ['don'],            # Don Mattingly, Don Drysdale
    'don':        ['donald'],
    'harold':     ['hal'],            # Hal McRae, Hal Morris
    'hal':        ['harold'],
    'albert':     ['al'],             # Al Kaline, Al Leiter
    'al':         ['albert'],
    'eugene':     ['gene'],           # Gene Larkin, Gene Mauch
    'gene':       ['eugene'],
    'jeffrey':    ['jeff'],           # Jeff Bagwell, Jeff Kent
    'jeff':       ['jeffrey'],
    'matthew':    ['matt'],           # Matt Williams, Matt Harvey
    'matt':       ['matthew'],
    'vincent':    ['vince'],          # Vince Coleman
    'vince':      ['vincent'],
    'daniel':     ['dan'],            # Dan Quisenberry, Dan Plesac
    'dan':        ['daniel'],
    'benjamin':   ['ben'],            # Ben Grieve
    'ben':        ['benjamin'],
    'alexander':  ['alex'],           # Alex Rodriguez, Alex Fernandez
    'alex':       ['alexander'],
}


def _player_name_variants(player: str) -> list[str]:
    """Return normalised player name variants covering common nicknames.

    The primary normalised form is always first; extras are added when the
    first name matches a known nickname mapping.

    'David Justice'  → ['david justice', 'dave justice']
    'Mike Piazza'    → ['mike piazza', 'michael piazza']
    """
    norm = _norm_player(player)   # "Sandy Alomar, Jr." → "sandy alomar jr"
    parts = norm.split()
    if not parts:
        return [norm]

    first = parts[0]
    rest  = ' '.join(parts[1:])
    extras = _PLAYER_NICKNAMES.get(first, [])

    variants = [norm]
    for alt in extras:
        v = f"{alt} {rest}".strip()
        if v not in variants:
            variants.append(v)
    return variants


def _brand_variants(brand: str) -> list[str]:
    """Return all acceptable brand aliases for title matching.

    eBay listings abbreviate, vary, or add publisher prefixes to brand names.
    Returns a list of lowercase strings; ANY one match in a listing title is
    sufficient to pass the brand check.

    Examples:
      "Upper Deck"          → ["upper deck", "ud"]
      "Donruss The Rookies" → ["donruss the rookies", "donruss rookies"]
      "Allen & Ginter"      → ["allen & ginter", "a&g", "allen ginter", ...]
    """
    b = brand.lower()
    # Always include: the raw name, and the article-stripped form
    stripped = re.sub(r'\bthe\b\s*', '', b).strip()
    variants: list[str] = list(dict.fromkeys([b, stripped]))  # deduplicated, original first

    # Abbreviations / publisher aliases  (ported from GAS brand-variant map)
    if 'upper deck' in b:                       variants += ['ud']
    if 'stadium club' in b:                     variants += ['sc', 'stadium club']
    if 'topps chrome' in b:                     variants += ['chrome']
    if 'bowman chrome' in b:                    variants += ['chrome']
    if b == 'topps':                            variants += ['topps base', 'topps series']
    if b == 'donruss':                          variants += ['panini donruss']
    if 'donruss optic' in b:                    variants += ['optic']
    if b == 'fleer':                            variants += ['fleer ultra', 'fleer tradition']
    if 'fleer ultra' in b:                      variants += ['ultra']
    if 'bowman' in b:                           variants += ['bowman']
    if 'finest' in b:                           variants += ['finest', 'topps finest']
    if 'select' in b:                           variants += ['select', 'panini select']
    if 'prizm' in b:                            variants += ['prizm', 'panini prizm']
    if 'classics' in b:                         variants += ['panini classics']
    if 'heritage' in b:                         variants += ['heritage', 'topps heritage']
    if 'archives' in b:                         variants += ['archives', 'topps archives']
    if 'gypsy queen' in b:                      variants += ['gq', 'gypsy queen']
    if 'allen' in b and 'ginter' in b:          variants += ['a&g', 'allen ginter', 'allen and ginter']
    if 'opening day' in b:                      variants += ['opening day', 'od']
    if 'big league' in b:                       variants += ['big league']
    if 'gallery' in b:                          variants += ['gallery']
    if 'diamond kings' in b:                    variants += ['dk', 'diamond kings']
    if 'triple threads' in b:                   variants += ['triple threads']
    if 'tier one' in b:                         variants += ['tier one', 'tier 1']
    if 'museum' in b:                           variants += ['museum collection', 'museum']
    if 'tribute' in b:                          variants += ['tribute', 'topps tribute']
    if 'inception' in b:                        variants += ['inception']
    if 'sterling' in b:                         variants += ['sterling', 'bowman sterling']
    if 'clearly authentic' in b:                variants += ['clearly authentic']
    if 'gold label' in b:                       variants += ['gold label']

    return list(dict.fromkeys(v for v in variants if v))


_TEAM_VARIANTS: dict[str, list[str]] = {
    'yankees':               ['nyy', 'new york yankees', 'ny yankees'],
    'new york yankees':      ['yankees', 'nyy', 'ny yankees'],
    'red sox':               ['bos', 'boston red sox', 'redsox', 'boston'],
    'boston red sox':        ['red sox', 'bos', 'boston'],
    'dodgers':               ['lad', 'los angeles dodgers', 'la dodgers'],
    'los angeles dodgers':   ['dodgers', 'lad', 'la dodgers'],
    'giants':                ['sfg', 'sf giants', 'san francisco giants', 'sf'],
    'san francisco giants':  ['giants', 'sfg', 'sf giants'],
    'cubs':                  ['chc', 'chicago cubs'],
    'chicago cubs':          ['cubs', 'chc'],
    'white sox':             ['cws', 'chicago white sox', 'chisox'],
    'chicago white sox':     ['white sox', 'cws', 'chisox'],
    'cardinals':             ['stl', 'st louis cardinals', 'cards', 'st. louis'],
    'st. louis cardinals':   ['cardinals', 'stl', 'cards'],
    'braves':                ['atl', 'atlanta braves', 'atlanta'],
    'atlanta braves':        ['braves', 'atl', 'atlanta'],
    'mets':                  ['nym', 'new york mets', 'ny mets'],
    'new york mets':         ['mets', 'nym', 'ny mets'],
    'phillies':              ['phi', 'philadelphia phillies', 'philly'],
    'philadelphia phillies': ['phillies', 'phi', 'philly'],
    'astros':                ['hou', 'houston astros', 'houston'],
    'houston astros':        ['astros', 'hou', 'houston'],
    'rangers':               ['tex', 'texas rangers', 'texas'],
    'texas rangers':         ['rangers', 'tex', 'texas'],
    'angels':                ['laa', 'los angeles angels', 'la angels', 'anaheim'],
    'los angeles angels':    ['angels', 'laa', 'la angels'],
    'athletics':             ['oak', 'oakland athletics', 'oakland', "a's"],
    'oakland athletics':     ['athletics', 'oak', "a's"],
    'mariners':              ['sea', 'seattle mariners', 'seattle'],
    'seattle mariners':      ['mariners', 'sea', 'seattle'],
    'padres':                ['sd', 'san diego padres', 'san diego'],
    'san diego padres':      ['padres', 'sd', 'san diego'],
    'rockies':               ['col', 'colorado rockies', 'colorado'],
    'colorado rockies':      ['rockies', 'col', 'colorado'],
    'diamondbacks':          ['ari', 'arizona diamondbacks', 'dbacks', 'd-backs', 'arizona'],
    'arizona diamondbacks':  ['diamondbacks', 'ari', 'dbacks'],
    'marlins':               ['mia', 'miami marlins', 'miami', 'florida marlins'],
    'miami marlins':         ['marlins', 'mia', 'miami'],
    'nationals':             ['was', 'washington nationals', 'washington', 'nats'],
    'washington nationals':  ['nationals', 'was', 'nats'],
    'orioles':               ['bal', 'baltimore orioles', 'baltimore'],
    'baltimore orioles':     ['orioles', 'bal', 'baltimore'],
    'rays':                  ['tb', 'tampa bay rays', 'tampa bay', 'tampa'],
    'tampa bay rays':        ['rays', 'tb', 'tampa bay'],
    'blue jays':             ['tor', 'toronto blue jays', 'toronto', 'jays'],
    'toronto blue jays':     ['blue jays', 'tor', 'toronto'],
    'twins':                 ['min', 'minnesota twins', 'minnesota'],
    'minnesota twins':       ['twins', 'min', 'minnesota'],
    'tigers':                ['det', 'detroit tigers', 'detroit'],
    'detroit tigers':        ['tigers', 'det', 'detroit'],
    'indians':               ['cle', 'cleveland indians', 'cleveland', 'guardians'],
    'guardians':             ['cle', 'cleveland guardians', 'cleveland', 'indians'],
    'cleveland guardians':   ['guardians', 'cle', 'cleveland'],
    'cleveland indians':     ['indians', 'cle', 'cleveland', 'guardians'],
    'royals':                ['kc', 'kansas city royals', 'kansas city'],
    'kansas city royals':    ['royals', 'kc', 'kansas city'],
    'brewers':               ['mil', 'milwaukee brewers', 'milwaukee'],
    'milwaukee brewers':     ['brewers', 'mil', 'milwaukee'],
    'reds':                  ['cin', 'cincinnati reds', 'cincinnati'],
    'cincinnati reds':       ['reds', 'cin', 'cincinnati'],
    'pirates':               ['pit', 'pittsburgh pirates', 'pittsburgh', 'bucs'],
    'pittsburgh pirates':    ['pirates', 'pit', 'pittsburgh'],
    'expos':                 ['mtl', 'montreal expos', 'montreal'],
    'montreal expos':        ['expos', 'mtl', 'montreal'],
}

def _team_variants(team: str) -> list[str]:
    """Return all acceptable team aliases for a given team name.
    Returns an empty list if the team is unknown (team check is skipped).
    """
    t = team.lower().strip()
    extras = _TEAM_VARIANTS.get(t, [])
    return list(dict.fromkeys([t] + [e.lower() for e in extras]))


def _brand_in_title(variants: list[str], title_l: str) -> bool:
    """Return True if any brand variant appears in the (lowercased) title.

    Short abbreviations (≤3 chars) use word-boundary matching to avoid
    false positives — e.g. 'ud' should not match inside 'would'.
    """
    for v in variants:
        if len(v) <= 3:
            if re.search(rf'\b{re.escape(v)}\b', title_l):
                return True
        else:
            if v in title_l:
                return True
    return False


def _apply_exclusions(title_l: str, card_brand_l: str = '') -> bool:
    """Return True if this listing should be excluded.

    card_brand_l: lowercased brand/set name of the card being priced.
    Keywords that appear in the card's own brand are skipped so we don't
    incorrectly filter valid comps (e.g. a Topps Chrome Refractor card
    should not reject listings containing 'refractor').
    """
    if any(k in title_l for k in GRADED_KW):   return True
    if any(k in title_l for k in AUTO_KW):      return True
    if any(k in title_l for k in LOT_KW):       return True
    if any(k in title_l for k in REPRINT_KW):   return True
    if any(k in title_l for k in MULTI_KW):     return True
    if any(k in title_l for k in PARALLEL_KW):  return True
    if re.search(r'/\d{1,3}\b', title_l):       return True

    # Premium parallels — skip check if the card's own brand contains the keyword
    for k in PREMIUM_KW:
        if k in title_l and k not in card_brand_l:
            return True

    # Insert patterns — skip check if the card's own brand contains the keyword
    for k in INSERT_KW:
        if k in title_l and k not in card_brand_l:
            return True

    # Short print / SSP — word-boundary matching to avoid false positives
    # (e.g. 'sp' inside 'display' or 'especially'); skip if card is itself an SP variant
    if not re.search(r'\bsp\b', card_brand_l) and not re.search(r'\bssp\b', card_brand_l):
        if re.search(r'\bsp\b', title_l):    return True
    if not re.search(r'\bssp\b', card_brand_l):
        if re.search(r'\bssp\b', title_l):   return True
    if 'short print' not in card_brand_l and 'short print' in title_l:          return True
    if 'super short print' not in card_brand_l and 'super short print' in title_l: return True

    return False


def filter_items(items, year, brand, player, card_number, team) -> list[dict]:
    """Strict filter: player + year + brand + card number must all match."""
    player_vs = _player_name_variants(player)  # ["david justice", "dave justice"]
    year_s    = str(year)
    brand_vs  = _brand_variants(brand)          # ["upper deck", "ud"]
    cn_clean  = (card_number or '').lstrip('#').strip()
    results   = []

    for item in items:
        price = _extract_price(item)
        if not price or price < 0.50:
            continue

        title   = item.get('title', '') or ''
        title_n = _norm_player(title.lower())   # normalise player punctuation in title

        if not any(pv in title_n for pv in player_vs):           continue
        if year_s   not in title_n:                              continue
        if brand_vs and not _brand_in_title(brand_vs, title_n):  continue
        # Team is NOT used as a hard filter — listings routinely omit team names,
        # and players with multi-team careers would lose too many valid comps.
        # _team_variants() is available for Claude prompt enrichment instead.
        if _apply_exclusions(title_n, brand.lower()):             continue
        if cn_clean and not re.search(rf'#?\b{re.escape(cn_clean)}\b', title_n): continue

        results.append({
            'price':        price,
            'listing_type': _extract_listing_type(item),
            'end_date':     _extract_end_date(item),
            'title':        title,
        })

    return results


def filter_items_relaxed(items, year, player, brand: str = '') -> list[dict]:
    """Relaxed filter: player + year only, no card number or brand required.
    Used as a fallback when strict filtering finds fewer than LOW_DATA_THRESH comps.
    Still excludes graded, lots, autos, reprints and parallels.
    """
    player_vs    = _player_name_variants(player)
    year_s       = str(year)
    card_brand_l = brand.lower()
    results      = []

    for item in items:
        price = _extract_price(item)
        if not price or price < 0.50:
            continue

        title   = item.get('title', '') or ''
        title_n = _norm_player(title.lower())

        if not any(pv in title_n for pv in player_vs): continue
        if year_s not in title_n:                      continue
        if _apply_exclusions(title_n, card_brand_l):   continue

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
                continue   # malformed date — can't trust recency weight, skip item
        else:
            age = 0
        prices_with_age.append((item['price'], age, item.get('listing_type', 'BIN')))

    prices = sorted(p for p, _, _ in prices_with_age)

    # IQR outlier removal — save pre-IQR list so we can fall back to it if
    # the filter removes every item (can happen with very small/uniform sets)
    pre_iqr = prices_with_age[:]
    if len(prices) >= 4:
        q1 = prices[len(prices) // 4]
        q3 = prices[len(prices) * 3 // 4]
        iqr = q3 - q1
        mult = 2.0 if len(prices) < 5 else 1.5
        lo, hi = max(0.50, q1 - mult * iqr), q3 + mult * iqr
        prices_with_age = [(p, a, lt) for p, a, lt in prices_with_age if lo <= p <= hi]

    if not prices_with_age:
        prices_with_age = pre_iqr  # IQR removed everything — use raw list

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


# ══════════════════════════════════════════════════════════════════════════════
# Optional free pricing sources (Phase 6.1 + 6.2) — opt-in via env flags.
# Both are cached aggressively so they don't add material API volume.
# ══════════════════════════════════════════════════════════════════════════════

PRICECHARTING_ENABLED = os.environ.get('PRICECHARTING_ENABLED', '').lower() in ('1', 'true', 'yes')
PRICECHARTING_CACHE   = 'data/pricecharting_cache.csv'
PRICECHARTING_MAX_AGE = 7 * 86400   # refresh weekly

HUNDRED_THIRTY_POINT_ENABLED = os.environ.get('HUNDRED_THIRTY_POINT_ENABLED', '').lower() in ('1', 'true', 'yes')
HTP_CACHE_FILE   = 'data/130point_cache.json'
HTP_CACHE_TTL    = 7 * 86400
HTP_MIN_COMPS    = 5
HTP_RATE_LIMIT_S = 5

_pricecharting_map: Optional[dict] = None
_htp_cache: Optional[dict]         = None
_htp_last_ts: float                = 0.0


def _load_pricecharting_map() -> dict:
    """Lazy-load the PriceCharting reference CSV into {(year, brand, player): price}.
    Refreshes weekly. Returns {} if disabled or unreachable."""
    global _pricecharting_map
    if _pricecharting_map is not None:
        return _pricecharting_map
    if not PRICECHARTING_ENABLED:
        _pricecharting_map = {}
        return _pricecharting_map
    try:
        need_refresh = (
            not os.path.exists(PRICECHARTING_CACHE)
            or (time.time() - os.path.getmtime(PRICECHARTING_CACHE)) > PRICECHARTING_MAX_AGE
        )
        if need_refresh:
            url = os.environ.get('PRICECHARTING_CSV_URL', '')
            if not url:
                log.warning('PriceCharting enabled but PRICECHARTING_CSV_URL not set — skipping')
                _pricecharting_map = {}
                return _pricecharting_map
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            os.makedirs('data', exist_ok=True)
            with open(PRICECHARTING_CACHE, 'wb') as f:
                f.write(r.content)
            log.info('PriceCharting CSV refreshed (%d bytes)', len(r.content))
        import csv
        _pricecharting_map = {}
        with open(PRICECHARTING_CACHE, newline='', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (
                    str(row.get('year', '')).strip(),
                    str(row.get('brand', '') or row.get('set', '')).strip().lower(),
                    str(row.get('player', '') or row.get('name', '')).strip().lower(),
                )
                price = parse_price(row.get('loose-price') or row.get('price') or '')
                if all(key) and price:
                    _pricecharting_map[key] = price
        log.info('Loaded %d PriceCharting reference prices', len(_pricecharting_map))
    except Exception as e:
        log.warning('PriceCharting load failed: %s', e)
        _pricecharting_map = {}
    return _pricecharting_map


def pricecharting_lookup(card: dict) -> Optional[float]:
    """Return a PriceCharting reference price or None."""
    m = _load_pricecharting_map()
    if not m:
        return None
    key = (str(card.get('year', '')).strip(),
           str(card.get('brand', '')).strip().lower(),
           str(card.get('player', '')).strip().lower())
    return m.get(key)


def _load_htp_cache():
    global _htp_cache
    if _htp_cache is not None:
        return _htp_cache
    try:
        with open(HTP_CACHE_FILE) as f:
            _htp_cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _htp_cache = {}
    return _htp_cache


def _save_htp_cache():
    if _htp_cache is None:
        return
    try:
        os.makedirs('data', exist_ok=True)
        with open(HTP_CACHE_FILE, 'w') as f:
            json.dump(_htp_cache, f, separators=(',', ':'))
    except Exception as e:
        log.warning('Failed to save 130point cache: %s', e)


def htp_sold_comps(card: dict) -> list[float]:
    """Fetch 130point sold comps for high-value cards. Cached 7 days per query.
    Returns a list of sale prices, or [] if disabled/empty/failed."""
    global _htp_last_ts
    if not HUNDRED_THIRTY_POINT_ENABLED:
        return []
    cache = _load_htp_cache()
    q = f"{card.get('year', '')} {card.get('brand', '')} {card.get('player', '')} {card.get('card_number', '')}".strip().lower()
    entry = cache.get(q)
    if entry and time.time() - entry.get('ts', 0) < HTP_CACHE_TTL:
        return entry.get('prices', [])
    # Polite rate limit.
    delta = time.time() - _htp_last_ts
    if delta < HTP_RATE_LIMIT_S:
        time.sleep(HTP_RATE_LIMIT_S - delta)
    _htp_last_ts = time.time()
    try:
        r = requests.get(
            'https://130point.com/sales/',
            params={'q': q},
            timeout=20,
            headers={'User-Agent': 'baseball-cards-pricing-agent/1.0 (+github.com/benjamin-cooper/baseball-cards)'},
        )
        if r.status_code != 200:
            log.info('130point returned %s for "%s"', r.status_code, q)
            cache[q] = {'ts': time.time(), 'prices': []}
            _save_htp_cache()
            return []
        prices = re.findall(r'\$(\d+(?:\.\d{1,2})?)', r.text)
        nums = [float(p) for p in prices if 1.0 <= float(p) <= 5000.0]
        cache[q] = {'ts': time.time(), 'prices': nums}
        _save_htp_cache()
        return nums
    except Exception as e:
        log.warning('130point fetch failed for "%s": %s', q, e)
        return []


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
        'description': 'Fetch a web page and return its text content. Use for TCDB or other pricing sites.',
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

Given a card description, gather pricing data from multiple sources using the available tools:

1. search_ebay — find active eBay listings for this exact card
2. fetch_page — check TCDB for community book values:
   - https://www.tcdb.com/Search.cfm?searchterm=QUERY

If a TCDB Reference Price is provided in the card description, treat it as a starting
point only — fetch the live TCDB page to verify it hasn't changed, then compare against
current eBay data to arrive at a market-accurate price.

Rules:
- Price raw/ungraded cards only (ignore PSA/BGS/SGC graded comps)
- Ignore autographed, lot, reprint, and numbered parallel listings
- Focus on cards matching the year, brand, player, and card number exactly
- Weight recent sold/completed listings over active asking prices
- After gathering data, respond with ONLY this JSON (no markdown):

{
  "price": <number>,
  "confidence": "High" | "Medium" | "Low",
  "data_points": <number>,
  "reasoning": "<one sentence>",
  "sources": ["<source1>", ...]
}"""


def execute_tool(name: str, inputs: dict, card: dict = None) -> str:
    if name == 'search_ebay':
        items = ebay_search(inputs['query'])
        if not items:
            return 'No results found.'

        # Pre-filter through exclusions so Claude doesn't anchor on graded/auto/SSP outliers
        if card:
            card_brand_l = card.get('brand', '').lower()
            filtered = [i for i in items
                        if not _apply_exclusions((i.get('title', '') or '').lower(), card_brand_l)]
            items = filtered or items   # fall back to unfiltered if all excluded

        # IQR trim before presenting to Claude
        prices_raw = [float((i.get('price') or {}).get('value') or 0) for i in items]
        prices_pos = sorted(p for p in prices_raw if p > 0)
        if len(prices_pos) >= 4:
            q1  = prices_pos[len(prices_pos) // 4]
            q3  = prices_pos[len(prices_pos) * 3 // 4]
            iqr = q3 - q1
            lo, hi = max(0.50, q1 - 1.5 * iqr), q3 + 1.5 * iqr
            trimmed = [i for i, p in zip(items, prices_raw) if lo <= p <= hi]
            items = trimmed or items

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


_claude_call_count = 0

def price_with_claude(card: dict) -> Optional[dict]:
    """Call Claude with tool use to price a difficult card."""
    global _claude_call_count
    _claude_call_count += 1
    client = get_claude()
    tcdb_ref     = card.get('tcdb_price') or 'unknown'
    team_aliases = _team_variants(card.get('team', ''))
    team_str     = ', '.join(team_aliases) if len(team_aliases) > 1 else (card.get('team') or 'N/A')
    desc = (
        f"Year: {card['year']}\n"
        f"Brand: {card['brand']}\n"
        f"Player: {card['player']}\n"
        f"Card Number: {card['card_number'] or 'N/A'}\n"
        f"Team: {card['team'] or 'N/A'}\n"
        f"Team aliases (use for comp matching): {team_str}\n"
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
                messages=messages,
                timeout=30,   # 30s per API round — SIGALRM covers the full card
            )

            if resp.stop_reason == 'tool_use':
                tool_results = []
                for block in resp.content:
                    if block.type == 'tool_use':
                        result = execute_tool(block.name, block.input, card=card)
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

def needs_pricing(row: list, row_index: int, existing_by_id: dict = None) -> bool:
    """Return True if this card should be re-priced given the current RUN_MODE.

    Pricing metadata (confidence, last_updated, avg_price) is looked up from
    the existing JSON results — the sheet is treated as read-only card catalog.
    """
    def get(col): return (row[col].strip() if col < len(row) and row[col] else '')

    # START_ROW: skip everything before the requested starting point
    if START_ROW > 0 and row_index < START_ROW:
        return False

    player = get(C['PLAYER'])
    year   = get(C['YEAR'])
    brand  = get(C['BRAND'])
    if not player or not year or not brand:
        return False

    # Player mode: force re-price any card whose player matches the target
    if RUN_MODE == 'player' and TARGET_PLAYER:
        return TARGET_PLAYER in player.lower()

    # Look up pricing metadata from JSON (source of truth), fall back to sheet
    _card_id  = make_card_id(year, brand, player, get(C['CARD_NUMBER']))
    _existing = (existing_by_id or {}).get(_card_id, {})
    price      = str(_existing.get('avg_price') or '') or get(C['AVG_PRICE'])
    last_upd   = _existing.get('last_updated', '') or get(C['LAST_UPDATED'])
    confidence = _existing.get('confidence', '')    or get(C['CONFIDENCE'])

    # TCDB mode: re-price only cards that fell back to TCDB reference pricing
    if RUN_MODE == 'tcdb':
        return 'tcdb ref' in confidence.lower()

    if STALE_DAYS == 0:
        return True   # force mode — re-price everything regardless

    if not price or price == '0':
        return True

    if last_upd:
        try:
            lu = datetime.fromisoformat(last_upd.replace('Z', '+00:00'))
            if lu.tzinfo is None:
                lu = lu.replace(tzinfo=timezone.utc)
            age_days = (datetime.now(timezone.utc) - lu).days

            threshold = _freshness_threshold_days(price, confidence)
            if age_days < threshold:
                return False
        except Exception:
            pass

    return True


def _freshness_threshold_days(price_str, confidence: str) -> int:
    """How many days a card's price can be reused before we re-price it.
    Cheap commons refresh slowly, high-value cards refresh weekly. TCDB fallbacks
    and low-confidence rows refresh sooner because they lack real market data."""
    try:
        price = float(price_str) if price_str else 0.0
    except (TypeError, ValueError):
        price = 0.0
    conf_lc = (confidence or '').lower()
    if 'tcdb' in conf_lc or 'floor' in conf_lc:
        return 14
    if 'low' in conf_lc:
        return 7
    if price < 1.0:  return 60
    if price < 5.0:  return 30
    if price < HIGH_VALUE_THRESH: return 14   # $5–$10
    return 7                                  # ≥ HIGH_VALUE_THRESH = refresh weekly


def process_card(row: list, row_number: int) -> Optional[dict]:
    """Price one card.

    Returns a dict with:
      'row'  — 1-based sheet row number
      'card' — card data dict for the results JSON
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

    # ── Step 1: eBay listings (strict filter) ────────────────────────────────────
    # Normalise player name in the query (strip commas/dots) so eBay search works
    # correctly for names like "Sandy Alomar, Jr." or "Cal Ripken, Jr."
    query_player = re.sub(r'[,.]', '', card['player']).strip()
    query = f"{card['year']} {card['brand']} {query_player}"

    ebay_items = ebay_search(query)   # raises EbayQuotaExhausted if daily limit hit

    ebay_filtered = filter_items(
        ebay_items, card['year'], card['brand'], card['player'],
        card['card_number'], card['team']
    )
    result     = weighted_average(ebay_filtered)
    ebay_count = len(ebay_filtered)
    fallback   = None   # tracks which fallback tier was used

    # ── Step 1b: Relaxed filter — player + year only, no card number/brand ────
    # Fires when strict comps are too thin. Gives a market signal even for
    # cards that are rarely listed under an exact card-number search.
    if result['count'] < LOW_DATA_THRESH:
        relaxed_ebay = filter_items_relaxed(ebay_items, card['year'], card['player'], card['brand'])
        if len(relaxed_ebay) >= LOW_DATA_THRESH:
            result     = weighted_average(relaxed_ebay)
            fallback   = 'relaxed'
            ebay_count = len(relaxed_ebay)
            log.info('  → Relaxed filter: %d comps', result['count'])

    # ── Step 1c-1: PriceCharting (Phase 6.1) ──────────────────────────────────
    # Cross-check / supplement when eBay data is thin. Zero per-card API cost —
    # the weekly-cached CSV has already been loaded once.
    if result['count'] < LOW_DATA_THRESH:
        pc_price = pricecharting_lookup(card)
        if pc_price and pc_price > 0:
            log.info('  → PriceCharting reference: $%.2f', pc_price)
            if result['count'] == 0:
                result = {'price': pc_price, 'count': 1, 'median': pc_price,
                          'min': pc_price, 'max': pc_price}
                fallback = 'pricecharting'
            else:
                # Blend with the existing (thin) eBay data.
                result['price'] = round((result['price'] + pc_price) / 2, 2)

    # ── Step 1c-2: 130point sold comps (Phase 6.2) ────────────────────────────
    # Only fire for high-value cards where we'd otherwise call Claude.
    if (result.get('price', 0) >= HIGH_VALUE_THRESH
            and result['count'] < CLAUDE_MIN_COMPS
            and HUNDRED_THIRTY_POINT_ENABLED):
        htp_prices = htp_sold_comps(card)
        if len(htp_prices) >= HTP_MIN_COMPS:
            # Feed 130point prices through weighted_average for IQR outlier removal.
            synthetic = [{'price': p, 'listing_type': 'Sold', 'end_date': None}
                         for p in htp_prices]
            htp_result = weighted_average(synthetic)
            if htp_result.get('count', 0) >= HTP_MIN_COMPS:
                log.info('  → 130point: %d sold comps $%.2f', htp_result['count'], htp_result['price'])
                result = htp_result
                fallback = '130point'

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
    else:
        source = f'eBay ({ebay_count})'
        if fallback == 'relaxed': source += ' [relaxed]'

    use_claude = (
        result['count'] < LOW_DATA_THRESH
        or (result['price'] >= HIGH_VALUE_THRESH and result['count'] < CLAUDE_MIN_COMPS)
        or fallback == 'tcdb'   # stale column F value — ask Claude to verify against live TCDB
    )
    # Phase 6.2: skip Claude when 130point already gave us enough comps.
    if fallback == '130point' and result['count'] >= HTP_MIN_COMPS:
        use_claude = False

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

    return {
        'row':  row_number,
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

# Phase 6.3/6.4/6.5/6.6 — post-processing improvements that cost zero API calls.
#   6.3 Bayesian smoothing: for cards with thin eBay data, blend the raw price
#       with player-level and set-level priors.
#   6.4 Median-of-last-3-runs: replace avg_price with median(current, prev-1,
#       prev-2) to smooth day-to-day noise.
#   6.5 TCDB anomaly floor: if the new price is <30% of the sheet-provided TCDB
#       reference (column F), floor it at 50% of TCDB ref.
#   6.6 Confidence recalibration: promote/demote confidence using recent
#       volatility from price_history.

SMOOTHING_K = 5   # strength of Bayesian smoothing (higher = trust prior more)
ANOMALY_DROP_RATIO = 0.3      # trigger if new_price < 30% of TCDB ref
ANOMALY_FLOOR_FRAC  = 0.5     # floor at 50% of TCDB ref

def _apply_smoothing_and_floor(cards: list[dict], priced_this_run: list[dict]):
    """Mutate the cards list in place with Phase 6.3–6.6 adjustments.

    Only cards priced in this run are candidates; historical entries are
    left alone so we don't rewrite portfolio history retroactively."""
    fresh_ids = {r['card']['card_id'] for r in priced_this_run if r.get('card')}
    if not fresh_ids:
        return

    # Load price history for median-of-3 + volatility.
    try:
        with open(HISTORY_FILE) as f:
            history = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        history = {}

    # Precompute player and set means for Bayesian prior.
    from collections import defaultdict
    player_sums  = defaultdict(lambda: [0.0, 0])
    set_sums     = defaultdict(lambda: [0.0, 0])
    for c in cards:
        p = c.get('avg_price', 0)
        if p and p > 0:
            pl = c.get('player') or ''
            st = f"{c.get('year') or ''}_{c.get('brand') or ''}"
            player_sums[pl][0] += p; player_sums[pl][1] += 1
            set_sums[st][0]    += p; set_sums[st][1]    += 1

    for c in cards:
        if c.get('card_id') not in fresh_ids:
            continue
        raw_price = c.get('avg_price', 0) or 0
        if raw_price <= 0:
            continue
        raw_count = _extract_count_from_confidence(c.get('confidence', ''))

        # 6.3 Bayesian smoothing (only for thin data).
        if raw_count < LOW_DATA_THRESH:
            pl = c.get('player') or ''
            st = f"{c.get('year') or ''}_{c.get('brand') or ''}"
            p_total, p_n = player_sums.get(pl, [0.0, 0])
            s_total, s_n = set_sums.get(st,    [0.0, 0])
            # Exclude self from the prior.
            p_n = max(0, p_n - 1); p_total = max(0.0, p_total - raw_price)
            s_n = max(0, s_n - 1); s_total = max(0.0, s_total - raw_price)
            p_mean = p_total / p_n if p_n else 0
            s_mean = s_total / s_n if s_n else 0
            if p_n + s_n:
                prior = (p_mean * p_n * 2 + s_mean * s_n) / (p_n * 2 + s_n)
                if prior > 0:
                    w_raw = raw_count / (raw_count + SMOOTHING_K)
                    smoothed = w_raw * raw_price + (1 - w_raw) * prior
                    c['smoothed_price'] = round(smoothed, 2)

        # 6.4 Median-of-last-3-runs smoothing.
        hist = history.get(c.get('card_id'), [])
        recent_prices = [h.get('price') for h in hist[-2:] if isinstance(h.get('price'), (int, float))]
        recent_prices.append(raw_price)
        if len(recent_prices) >= 2:
            med = _median(recent_prices)
            # Only apply if the raw is a >25% outlier vs the median of recent runs.
            if med and abs(raw_price - med) / med > 0.25:
                c['avg_price'] = round(med, 2)
                log.info('  → Median-of-runs smoothing: %s $%.2f → $%.2f',
                         c['card_id'], raw_price, med)

        # 6.5 TCDB anomaly floor (column F reference).
        tcdb_ref = c.get('tcdb_price')
        try:
            tcdb_ref_f = float(tcdb_ref) if tcdb_ref else 0.0
        except (TypeError, ValueError):
            tcdb_ref_f = 0.0
        if tcdb_ref_f > 0 and c['avg_price'] < ANOMALY_DROP_RATIO * tcdb_ref_f:
            floored = round(ANOMALY_FLOOR_FRAC * tcdb_ref_f, 2)
            log.warning('  → TCDB floor: %s priced $%.2f, TCDB ref $%.2f → floor $%.2f',
                        c['card_id'], c['avg_price'], tcdb_ref_f, floored)
            c['avg_price'] = floored
            conf = c.get('confidence', '')
            if 'anomaly' not in conf.lower():
                c['confidence'] = 'Low (anomaly floored)'

        # 6.6 Confidence recalibration from recent volatility.
        _recalibrate_confidence(c, hist)


def _extract_count_from_confidence(conf: str) -> int:
    """Heuristic: infer the comp count from the confidence label."""
    lc = (conf or '').lower()
    if 'very high' in lc: return 12
    if 'high'      in lc: return 7
    if 'medium'    in lc: return 4
    if 'low'       in lc: return 2
    return 0


def _recalibrate_confidence(c: dict, hist: list):
    """Promote/demote confidence using volatility of the last few runs."""
    prices = [h.get('price') for h in hist[-10:] if isinstance(h.get('price'), (int, float))]
    if len(prices) < 3:
        return
    med = _median(prices)
    if not med:
        return
    sd = _stddev(prices)
    cov = sd / med if med else 0
    conf = c.get('confidence', '')
    lc = conf.lower()
    # Demote if recent volatility is extreme (>40% of median)
    if cov > 0.4 and 'high' in lc and 'very high' not in lc:
        c['confidence'] = 'Medium (volatile)'
    elif cov > 0.6 and 'very high' in lc:
        c['confidence'] = 'High (volatile)'
    # Promote if 10+ runs of low volatility
    elif len(prices) >= 10 and cov < 0.05 and lc.startswith('medium'):
        c['confidence'] = 'High (stable)'


def build_results_json(all_rows: list[list], priced_cards: list[dict],
                       existing_by_id: dict = None) -> dict:
    """Merge freshly priced cards with existing JSON data into a full snapshot.

    The sheet provides the card catalog (player, year, brand, etc.).
    Pricing data (avg_price, confidence, last_updated) comes from the JSON —
    the sheet pricing columns are ignored so the sheet stays read-only.
    """
    fresh    = {r['row']: r['card'] for r in priced_cards}
    _existing = existing_by_id or {}

    cards: list = []
    for i, row in enumerate(all_rows[1:], start=2):   # skip header row
        def get(col): return (row[col] if col < len(row) else '').strip() if col < len(row) else ''
        player = get(C['PLAYER'])
        if not player:
            continue

        if i in fresh:
            c = fresh[i]
        else:
            card_id = make_card_id(get(C['YEAR']), get(C['BRAND']), player, get(C['CARD_NUMBER']))
            _ex = _existing.get(card_id, {})
            c = {
                'player':       player,
                'year':         get(C['YEAR']),
                'brand':        get(C['BRAND']),
                'card_number':  get(C['CARD_NUMBER']),
                'team':         get(C['TEAM']),
                'tcdb_price':   parse_price(get(C['TCDB_PRICE'])),
                'avg_price':    _ex.get('avg_price') or 0,
                'median':       _ex.get('median') or 0,
                'confidence':   _ex.get('confidence', ''),
                'last_updated': _ex.get('last_updated', ''),
                'card_id':      card_id,
            }
        # Every spreadsheet row is a distinct physical card — two rows with the
        # same card_id are two copies of the same card, both should count.
        cards.append(c)

    # ── Algorithmic smoothing + anomaly floor + confidence recalibration ─────
    _apply_smoothing_and_floor(cards, priced_cards)

    priced = [c for c in cards if c.get('avg_price')]
    total  = sum(c['avg_price'] for c in priced)
    # Dedupe by card_id for ranked display only — two physical copies of the
    # same card both count toward total but should appear once in Top 25.
    _seen_ids: dict = {}
    for c in priced:
        cid = c.get('card_id', '')
        if cid not in _seen_ids or c['avg_price'] > _seen_ids[cid]['avg_price']:
            _seen_ids[cid] = c
    top25  = sorted(_seen_ids.values(), key=lambda c: c['avg_price'], reverse=True)[:25]

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
        add_files = [RESULTS_FILE, HISTORY_FILE]
        for extra in (EBAY_CACHE_FILE, RUN_METADATA_FILE, SUMMARY_FILE,
                      PRICECHARTING_CACHE, HTP_CACHE_FILE):
            if os.path.exists(extra):
                add_files.append(extra)
        subprocess.run(['git', 'add', *add_files], check=True)
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


class _CardTimeout(Exception):
    pass

def _card_timeout_handler(signum, frame):
    raise _CardTimeout()

def process_card_timed(row: list, row_number: int) -> Optional[dict]:
    """process_card() wrapped in a SIGALRM wall-clock timeout (Linux/macOS only)."""
    old = signal.signal(signal.SIGALRM, _card_timeout_handler)
    signal.alarm(CARD_TIMEOUT_SEC)
    try:
        return process_card(row, row_number)
    except _CardTimeout:
        log.warning('Row %d timed out after %ds — skipping', row_number, CARD_TIMEOUT_SEC)
        return None
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


_run_errors: list = []   # accumulated for run_metadata.json

def process_batch(batch: list, service) -> list:
    """Price a list of (row_num, row) tuples. Returns result dicts.
    Results are written to JSON only — the sheet is treated as read-only.
    Raises EbayQuotaExhausted if the daily quota runs out.
    """
    results, api_calls = [], 0

    for row_num, row in batch:
        try:
            r = process_card_timed(row, row_num)
            if r:
                results.append(r)
                api_calls += 1
        except EbayQuotaExhausted:
            raise
        except Exception as e:
            log.error('Failed row %d: %s', row_num, e)
            _run_errors.append({'row': row_num, 'error': str(e)[:200]})
        if api_calls > 0 and api_calls % 100 == 0:
            log.info('Rate limit pause…')
            time.sleep(0.5)

    return results


def main():
    global C, _run_start_ts, _input_audit

    _run_start_ts = time.time()

    log.info('=== Baseball Card Pricing Agent ===')
    log.info('Mode: %s  |  Batch size: %d  |  Stale threshold: %d days',
             RUN_MODE.upper(), BATCH_SIZE, STALE_DAYS)
    if RUN_MODE == 'player':
        log.info('Target player: "%s"', TARGET_PLAYER or '(none)')
    if RUN_MODE == 'tcdb':
        log.info('Targeting TCDB-fallback cards only (confidence contains "tcdb ref")')

    service = get_sheets_service()
    rows    = read_sheet(service)

    if len(rows) < 2:
        log.error('Sheet appears empty')
        sys.exit(1)

    # ── Dynamic column detection ───────────────────────────────────────────────
    C = detect_columns(rows[0])

    # ── Input audit (log-only, does not skip rows) ─────────────────────────────
    _input_audit = audit_input_rows(rows)

    # ── Load existing pricing results (JSON is the source of truth) ───────────
    existing_by_id: dict = {}
    if os.path.exists(RESULTS_FILE):
        try:
            with open(RESULTS_FILE) as f:
                _data = json.load(f)
            for c in _data.get('cards', []):
                if c.get('card_id'):
                    existing_by_id[c['card_id']] = c
            log.info('Loaded %d existing pricing results from JSON', len(existing_by_id))
        except Exception as e:
            log.warning('Could not load existing results JSON: %s', e)

    # ── Find candidates ────────────────────────────────────────────────────────
    candidates = [
        (i + 2, row)
        for i, row in enumerate(rows[1:])
        if needs_pricing(row, i + 2, existing_by_id)
    ]
    log.info('%d / %d cards need pricing', len(candidates), len(rows) - 1)

    if not candidates:
        log.info('Nothing to price — exiting.')
        # Still rebuild the results JSON so the page stays fresh (rows already in memory)

    # ── Run modes ─────────────────────────────────────────────────────────────
    all_results: list = []

    def _save_and_exit(reason: str, label: str = 'partial'):
        """Graceful shutdown — saves progress and exits cleanly."""
        log.warning('=== %s ===', reason)
        log.info('Saving progress for %d cards priced so far…', len(all_results))
        output = build_results_json(rows, all_results, existing_by_id)
        _save_outputs(output, all_results)
        commit_progress(label)
        log.info('Progress saved.')
        sys.exit(0)

    # Alias kept for call sites that use the old name
    def _save_and_exit_quota(reason: str):
        _save_and_exit(reason, 'quota-exhausted')

    # ── SIGTERM handler — fires when GitHub Actions cancels the job ───────────
    # Register inside main() so the closure captures rows / all_results.
    def _sigterm_handler(signum, frame):
        _save_and_exit('SIGTERM received — job cancelled, saving progress', 'cancelled')
    signal.signal(signal.SIGTERM, _sigterm_handler)

    if RUN_MODE == 'full':
        total = len(candidates)
        for chunk_start in range(0, total, FULL_RUN_CHUNK):
            chunk  = candidates[chunk_start:chunk_start + FULL_RUN_CHUNK]
            log.info('--- Chunk %d–%d of %d ---',
                     chunk_start + 1, chunk_start + len(chunk), total)
            try:
                chunk_results = process_batch(chunk, service)
            except EbayQuotaExhausted as e:
                _save_and_exit_quota(str(e))
            all_results.extend(chunk_results)
            output = build_results_json(rows, all_results, existing_by_id)   # rows is held in memory — no re-read
            _save_outputs(output, all_results)
    else:
        batch = candidates if RUN_MODE in ('player', 'tcdb') else candidates[:BATCH_SIZE]
        try:
            all_results = process_batch(batch, service)
        except EbayQuotaExhausted as e:
            _save_and_exit_quota(str(e))

    log.info('Processed %d cards total', len(all_results))

    # Final save (full mode already saved incrementally, this is a no-op if
    # nothing changed; batch/player mode saves here for the first time)
    os.makedirs('data', exist_ok=True)
    output = build_results_json(rows, all_results, existing_by_id)
    _save_outputs(output, all_results)
    log.info('Done. Total value: $%.2f across %d cards', output['total_value'], output['cards_priced'])


# Run-wide telemetry — populated by main() / process_batch() for run_metadata.json.
_run_start_ts: float = 0.0
_input_audit:  dict  = {}


def _write_run_metadata(output: dict, results: list):
    """Emit data/run_metadata.json summarising the run for the frontend badge."""
    try:
        duration = round(time.time() - _run_start_ts, 1) if _run_start_ts else None
        meta = {
            'timestamp':         datetime.now(timezone.utc).isoformat(),
            'run_mode':          RUN_MODE,
            'cards_processed':   len(results),
            'cards_priced':      output.get('cards_priced', 0),
            'total_value':       output.get('total_value', 0),
            'api_calls': {
                'ebay_misses':  _ebay_cache_misses,
                'ebay_hits':    _ebay_cache_hits,
                'claude':       _claude_call_count,
                'sheets':       1,   # single read + optional batch write
            },
            'cache_hit_rate':    round(_ebay_cache_hits / (_ebay_cache_hits + _ebay_cache_misses), 3)
                                  if (_ebay_cache_hits + _ebay_cache_misses) else 0.0,
            'input_audit':       _input_audit,
            'errors':            _run_errors[:50],   # cap to keep file small
            'duration_seconds':  duration,
        }
        with open(RUN_METADATA_FILE, 'w') as f:
            json.dump(meta, f, indent=2, default=str)
        log.info('Wrote %s', RUN_METADATA_FILE)
    except Exception as e:
        log.warning('Failed to write run metadata: %s', e)


# ── Frontend summary sidecar ─────────────────────────────────────────────────
# The frontend used to recompute player stats / era buckets / HHI / volatility
# on every filter change. Precomputing once here lets the dashboard do a fast
# first paint from a small JSON file, then hydrate the full card list lazily.
# ─────────────────────────────────────────────────────────────────────────────

# Maps confidence strings to a discount weight for Phase 4.5 portfolio total.
_CONF_WEIGHT = {
    'very high': 1.0,
    'high':      0.8,
    'medium':    0.6,
    'low':       0.4,
    'tcdb':      0.3,
    'floor':     0.3,
}

def _conf_weight(conf: str) -> float:
    lc = (conf or '').lower()
    for k, w in _CONF_WEIGHT.items():
        if k in lc:
            return w
    return 0.5


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    var  = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _write_summary_sidecar(output: dict):
    """Emit data/pricing_summary.json — small precomputed aggregate the frontend
    loads first for fast initial paint, before hydrating the full cards list."""
    try:
        cards  = [c for c in output.get('cards', []) if c.get('avg_price')]
        priced = [c for c in cards if c.get('avg_price', 0) > 0]
        prices = [c['avg_price'] for c in priced]

        # Load history for volatility + market-mover calcs.
        try:
            with open(HISTORY_FILE) as f:
                history = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            history = {}

        # Per-card % change over the most recent pair of snapshots.
        pct_change: dict = {}
        for c in priced:
            h = history.get(c.get('card_id'), [])
            if len(h) >= 2 and h[-2].get('price'):
                pct_change[c['card_id']] = (h[-1]['price'] - h[-2]['price']) / h[-2]['price'] * 100.0

        # Player stats (total value, card count, copy count, avg, volatility).
        from collections import defaultdict
        player_agg = defaultdict(lambda: {'total': 0.0, 'unique': 0, 'copies': 0, 'pct_changes': []})
        for c in priced:
            p = c.get('player') or 'Unknown'
            a = player_agg[p]
            a['total']  += c['avg_price']
            a['unique'] += 1
            a['copies'] += c.get('quantity', 1) or 1
            if c['card_id'] in pct_change:
                a['pct_changes'].append(pct_change[c['card_id']])
        player_stats = []
        for p, a in player_agg.items():
            player_stats.append({
                'player':     p,
                'total':      round(a['total'], 2),
                'unique':     a['unique'],
                'copies':     a['copies'],
                'avg':        round(a['total'] / a['unique'], 2) if a['unique'] else 0,
                'volatility': round(_stddev(a['pct_changes']), 2),
            })
        player_stats.sort(key=lambda r: r['total'], reverse=True)

        # HHI — portfolio concentration (0..10000).
        total = sum(prices) or 1
        hhi = round(sum((p / total) ** 2 for p in prices) * 10000, 1)

        # Confidence-weighted total.
        weighted_total = round(sum(c['avg_price'] * _conf_weight(c.get('confidence', ''))
                                   for c in priced), 2)

        # Market movers (already pre-sorted by delta magnitude).
        movers = sorted(
            ({'card_id': cid, 'pct': round(v, 2)} for cid, v in pct_change.items()),
            key=lambda m: abs(m['pct']),
            reverse=True
        )[:40]

        summary = {
            'last_updated':    output.get('last_updated'),
            'total_cards':     output.get('total_cards'),
            'cards_priced':    output.get('cards_priced'),
            'total_value':     output.get('total_value'),
            'avg_value':       output.get('avg_value'),
            'median_value':    round(_median(prices), 2),
            'top_card_value':  output.get('top_card_value'),
            'hhi':             hhi,
            'weighted_total':  weighted_total,
            'by_era':          output.get('by_era'),
            'by_brand':        output.get('by_brand'),
            'player_stats':    player_stats,
            'market_movers':   movers,
            'top_25_ids':      [c.get('card_id') for c in output.get('top_cards', [])[:25]],
        }
        with open(SUMMARY_FILE, 'w') as f:
            json.dump(summary, f, separators=(',', ':'), default=str)
        log.info('Wrote %s (%.0f KB)', SUMMARY_FILE, os.path.getsize(SUMMARY_FILE) / 1024)
    except Exception as e:
        log.warning('Failed to write summary sidecar: %s', e)


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
        json.dump(output, f, separators=(',', ':'), default=str)
    log.info('Saved %s (%.0f KB)', RESULTS_FILE, os.path.getsize(RESULTS_FILE) / 1024)

    # Persist eBay cache + run metadata + summary sidecar.
    _save_ebay_persist_cache()
    _write_run_metadata(output, results)
    _write_summary_sidecar(output)


if __name__ == '__main__':
    main()
