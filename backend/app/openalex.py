"""OpenAlex metadata collector; public scholarly metadata, not a hosted AI service."""
import asyncio
from collections import Counter, defaultdict
import os
import re

import httpx

from .schemas import Paper, SearchRequest

API = 'https://api.openalex.org/works'


class OpenAlexAPIError(Exception):
    """Provider failure with the public HTTP status and collection phase, never credentials."""

    def __init__(self, status: int | None, phase: str, detail: str):
        self.status = status
        self.phase = phase
        self.detail = detail
        label = f'HTTP {status}' if status is not None else 'network error'
        hint = ''
        if status == 429:
            hint = ' Check the OpenAlex rate limit/daily budget; a free OPENALEX_API_KEY is recommended for broad surveys.'
        elif status in (401, 403):
            hint = ' Check that OPENALEX_API_KEY is valid and activated, or remove the invalid key.'
        elif status == 400:
            hint = ' Check OpenAlex query/filter parameters.'
        elif status is None:
            hint = ' Check connectivity to api.openalex.org from inside the backend container.'
        super().__init__(f'OpenAlex {label} during {phase}: {detail}.{hint}')


def _provider_detail(response: httpx.Response) -> str:
    """Display a short provider-supplied error without exposing an API key."""
    try:
        body = response.json()
        if isinstance(body, dict):
            raw = body.get('message') or body.get('error') or response.reason_phrase
        else:
            raw = response.reason_phrase
    except (ValueError, TypeError):
        raw = response.reason_phrase
    result = ' '.join(str(raw).split())
    secret = os.getenv('OPENALEX_API_KEY', '')
    if secret:
        result = result.replace(secret, '[redacted]')
    return result[:280]


def _retry_wait(response: httpx.Response, attempt: int) -> float | None:
    """Retry short-lived throttling; never sleep through a long daily-quota wait."""
    if response.status_code not in (429, 500, 502, 503, 504):
        return None
    raw = response.headers.get('retry-after', '').strip()
    if raw:
        try:
            wait = float(raw)
        except ValueError:
            wait = float(2 ** attempt)
        if wait > 15:
            return None
        return max(0.2, wait)
    # A daily-credit failure is not fixed by immediate repeats.
    if response.status_code == 429:
        try:
            body = response.json()
            message = str(body.get('message', '')).lower() if isinstance(body, dict) else ''
        except ValueError:
            message = ''
        if any(word in message for word in ('daily', 'budget', 'credit', 'plan upgrade', 'insufficient')):
            return None
    return float(2 ** attempt)


async def openalex_page(client: httpx.AsyncClient, params: dict, phase: str) -> dict:
    """Retrieve one API page with bounded retries and actionable diagnostics."""
    interval = 0.06 if os.getenv('OPENALEX_API_KEY') else 0.2
    for attempt in range(3):
        try:
            response = await client.get(API, params=params)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get('results'), list):
                raise OpenAlexAPIError(None, phase, 'unexpected response JSON structure')
            return payload
        except httpx.HTTPStatusError as error:
            response = error.response
            wait = _retry_wait(response, attempt) if attempt < 2 else None
            if wait is None:
                raise OpenAlexAPIError(response.status_code, phase, _provider_detail(response)) from error
            await asyncio.sleep(wait)
        except httpx.RequestError as error:
            if attempt == 2:
                raise OpenAlexAPIError(None, phase, type(error).__name__) from error
            await asyncio.sleep(2 ** attempt)
        except ValueError as error:
            raise OpenAlexAPIError(None, phase, 'invalid response JSON') from error
        finally:
            await asyncio.sleep(interval)
    raise AssertionError('unreachable')


def restore_abstract(inverted: dict | None) -> str:
    """Restore OpenAlex positional inverted index, including repeated words."""
    if not isinstance(inverted, dict):
        return ''
    positions: dict[int, str] = {}
    for word, offsets in inverted.items():
        if not isinstance(word, str) or not isinstance(offsets, list):
            continue
        for position in offsets:
            if isinstance(position, int) and 0 <= position < 4000:
                positions[position] = word
    return ' '.join(positions[i] for i in sorted(positions))


def normalize_work(work: dict, group: str) -> Paper | None:
    title = (work.get('title') or work.get('display_name') or '').strip()
    if len(title) < 2:
        return None
    identifier = str(work.get('id') or work.get('doi') or '')
    doi = work.get('doi')
    abstract = restore_abstract(work.get('abstract_inverted_index'))
    if len(abstract) > 12000:
        return None
    return Paper(
        id=identifier[:300], title=title[:1000],
        abstract=abstract,
        year=work.get('publication_year'), doi=doi if isinstance(doi, str) else None,
        url=doi or identifier or None, groups=[group],
        abstract_source=identifier if abstract else '',
        cited_by_count=max(0, int(work.get('cited_by_count') or 0)),
        referenced_works=(work.get('referenced_works') or []),
    )


async def collect_papers(request: SearchRequest) -> list[Paper]:
    """Page through public OpenAlex works, keeping only genuine supplied abstracts.

    limit_per_query counts source-abstract-bearing records, not raw search hits.
    When an OpenAlex API key is configured, cursor pagination can move beyond the
    provider's 10,000-result basic-page boundary. There is no application paper cap.
    """
    seen: dict[str, Paper] = {}
    timeout = httpx.Timeout(35.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for term in request.queries:
            # Three independent rankings avoid interpreting the top relevance
            # results as the whole field. The legacy request remains unchanged.
            rankings = (('relevance_score:desc', 'cited_by_count:desc', 'publication_date:desc')
                        if request.diversify else (None,))
            q, remainder = divmod(request.limit_per_query, len(rankings))
            for index, ranking in enumerate(rankings):
                target = q + (1 if index < remainder else 0)
                if target == 0:
                    continue
                accepted, page = 0, 1
                use_cursor = bool(os.getenv('OPENALEX_API_KEY'))
                cursor = '*' if use_cursor else None
                while accepted < target:
                    params = {
                        'search': term.query,
                        'per_page': 100,
                        'select': 'id,title,display_name,doi,publication_year,abstract_inverted_index,cited_by_count,referenced_works',
                    }
                    if use_cursor:
                        params['cursor'] = cursor
                    else:
                        if page > 100:
                            raise ValueError('OpenAlex basic paging ends at 10,000 results per query/ranking. '
                                             'Set OPENALEX_API_KEY for unlimited cursor paging.')
                        params['page'] = page
                    if ranking:
                        params['sort'] = ranking
                    if os.getenv('OPENALEX_API_KEY'):
                        params['api_key'] = os.environ['OPENALEX_API_KEY']
                    payload = await openalex_page(
                        client, params, f'search {term.query!r} ({ranking or "default"}, page {page})')
                    works = payload['results']
                    if not works:
                        break
                    for work in works:
                        paper = normalize_work(work, term.label)
                        if paper is None or not paper.abstract or not paper.abstract_source:
                            continue
                        key = paper.id.lower() or paper.title.casefold()
                        if key in seen:
                            existing = seen[key]
                            if term.label not in existing.groups:
                                existing.groups.append(term.label)
                        else:
                            seen[key] = paper
                        accepted += 1
                        if accepted >= target:
                            break
                    if len(works) < 100:
                        break
                    if use_cursor:
                        next_cursor = (payload.get('meta') or {}).get('next_cursor')
                        if not next_cursor or next_cursor == cursor:
                            break
                        cursor = next_cursor
                    else:
                        page += 1
                    await asyncio.sleep(0)
    return list(seen.values())


def _work_id(value: str) -> str | None:
    """Accept provider OpenAlex work IDs only; never search by paper name."""
    matched = re.fullmatch(r'(?:https://openalex.org/)?(W[0-9]+)', value, flags=re.I)
    return matched.group(1).upper() if matched else None


def citation_candidates(seeds: list[Paper]) -> list[tuple[str, list[str]]]:
    """Discover citations shared across the seed corpus; no hand-picked anchors."""
    counts: Counter[str] = Counter()
    group_evidence: dict[str, set[str]] = defaultdict(set)
    seed_ids = {_work_id(p.id) for p in seeds}
    for paper in seeds:
        references = {_work_id(ref) for ref in paper.referenced_works}
        for ref in references:
            if ref and ref not in seed_ids:
                counts[ref] += 1
                group_evidence[ref].update(paper.groups)
    # Frequent citations shared by several source works rank first; cross-field
    # presence breaks ties but never substitutes a manually chosen work.
    return [(ref, sorted(group_evidence[ref])) for ref in sorted(
        counts, key=lambda ref: (-counts[ref], -len(group_evidence[ref]), ref))]


async def expand_citation_neighborhood(seeds: list[Paper], budget: int) -> list[Paper]:
    """Fetch one-hop reference neighbors, subject to the same original-abstract rules."""
    if budget <= 0 or not seeds:
        return []
    candidates = citation_candidates(seeds)
    found: list[Paper] = []
    # Read at most 3x budget: not every referenced work has a source abstract.
    max_ids = min(len(candidates), budget * 3)
    timeout = httpx.Timeout(35.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for offset in range(0, max_ids, 50):
            batch = candidates[offset: offset + 50]
            params = {
                'filter': 'openalex:' + '|'.join(ref for ref, _groups in batch),
                'per_page': 100,
                'select': 'id,title,display_name,doi,publication_year,abstract_inverted_index,cited_by_count,referenced_works',
            }
            if os.getenv('OPENALEX_API_KEY'):
                params['api_key'] = os.environ['OPENALEX_API_KEY']
            payload = await openalex_page(client, params, f'citation expansion (batch {offset // 50 + 1})')
            tagged = {ref: groups for ref, groups in batch}
            for work in payload['results']:
                ref = _work_id(str(work.get('id') or ''))
                if ref not in tagged:
                    continue
                paper = normalize_work(work, 'Citation neighborhood')
                if paper is None or not paper.abstract or not paper.abstract_source:
                    continue
                # These are discovery-context memberships, not verified topic labels.
                paper.groups = tagged[ref]
                found.append(paper)
                if len(found) >= budget:
                    return found
            await asyncio.sleep(0)
    return found
