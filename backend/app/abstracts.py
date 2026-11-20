"""Resolve *source-provided* abstracts, never synthesize them from keywords.

Only arXiv Atom <summary> and OpenAlex abstract_inverted_index are accepted.
The curated CSV is a bibliography of identifiers, never a text source.
"""
import asyncio
from difflib import SequenceMatcher
import os
import re
import unicodedata
import xml.etree.ElementTree as ET

import httpx

from .openalex import restore_abstract
from .schemas import Paper

ARXIV = 'https://export.arxiv.org/api/query'
OPENALEX = 'https://api.openalex.org/works'
ATOM_NS = {'atom': 'http://www.w3.org/2005/Atom'}


def normalized_title(value: str) -> str:
    normalized = unicodedata.normalize('NFKC', value).casefold()
    return ' '.join(re.findall(r'[\w]+', normalized))


def titles_match(actual: str, expected: str) -> bool:
    a, b = normalized_title(actual), normalized_title(expected)
    return bool(a and b and (a == b or SequenceMatcher(None, a, b).ratio() >= 0.92))


def clean_source_abstract(raw: str | None) -> str:
    """Whitespace normalization is formatting only; no summaries or rewriting."""
    text = ' '.join((raw or '').split())
    if not (40 <= len(text) <= 12000):
        return ''
    return text


def arxiv_id(paper: Paper) -> str | None:
    match = re.fullmatch(r'arxiv:(\d{4}\.\d{4,5})(?:v\d+)?', paper.id, re.I)
    if match:
        return match.group(1)
    for field in (paper.url or '', paper.id):
        match = re.fullmatch(r'https?://(?:www\.)?arxiv\.org/abs/(\d{4}\.\d{4,5})(?:v\d+)?/?', field, re.I)
        if match:
            return match.group(1)
    return None


def canonical_doi(paper: Paper) -> str | None:
    candidate = paper.doi or (paper.id[4:] if paper.id.lower().startswith('doi:') else '')
    candidate = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', candidate, flags=re.I).strip()
    return candidate.lower() if re.fullmatch(r'10\.\d{4,9}/\S+', candidate, re.I) else None


def annotate(paper: Paper, abstract: str, source: str) -> Paper:
    updated = paper.model_copy(deep=True)
    updated.abstract = abstract
    updated.abstract_source = source
    return updated


async def fetch_arxiv(client: httpx.AsyncClient, ids: list[str]) -> dict[str, tuple[str, str]]:
    """The official arXiv Atom summary is the submitted abstract."""
    if not ids:
        return {}
    response = await client.get(ARXIV, params={'id_list': ','.join(ids), 'max_results': len(ids)})
    response.raise_for_status()
    root = ET.fromstring(response.content)
    fetched = {}
    for entry in root.findall('atom:entry', ATOM_NS):
        url = entry.findtext('atom:id', default='', namespaces=ATOM_NS)
        match = re.search(r'/abs/(\d{4}\.\d{4,5})(?:v\d+)?', url)
        if not match:
            continue
        title = entry.findtext('atom:title', default='', namespaces=ATOM_NS)
        abstract = clean_source_abstract(entry.findtext('atom:summary', default='', namespaces=ATOM_NS))
        if abstract:
            fetched[match.group(1)] = (title, abstract)
    return fetched


async def fetch_doi(client: httpx.AsyncClient, doi: str) -> dict:
    params = {'select': 'id,title,doi,abstract_inverted_index'}
    if os.getenv('OPENALEX_API_KEY'):
        params['api_key'] = os.environ['OPENALEX_API_KEY']
    response = await client.get(f'{OPENALEX}/https://doi.org/{doi}', params=params)
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, dict):
        raise ValueError('Invalid OpenAlex DOI record')
    return result


async def resolve_papers(bibliography: list[Paper]) -> dict:
    """Resolve by stable IDs, report every omission explicitly. Ignore input abstracts.

    Known IDs are not matched to nearby or merely similar publications.
    """
    empty = [p.model_copy(update={'abstract': '', 'abstract_source': ''}, deep=True)
             for p in bibliography]
    good: dict[int, Paper] = {}
    omitted: dict[int, dict] = {}
    ids: dict[str, list[int]] = {}
    dois: list[tuple[int, str]] = []
    for index, paper in enumerate(empty):
        arxiv = arxiv_id(paper)
        doi = canonical_doi(paper)
        if arxiv:
            ids.setdefault(arxiv, []).append(index)
        elif doi:
            dois.append((index, doi))
        else:
            omitted[index] = {'id': paper.id, 'title': paper.title, 'reason': 'No supported arXiv ID or DOI'}

    timeout = httpx.Timeout(45.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        if ids:
            arxiv_keys = list(ids)
            for offset in range(0, len(arxiv_keys), 50):
                batch = arxiv_keys[offset:offset + 50]
                try:
                    retrieved = await fetch_arxiv(client, batch)
                except (httpx.HTTPError, ET.ParseError) as error:
                    retrieved = {}
                    reason = f'arXiv source request failed ({type(error).__name__})'
                    for key in batch:
                        for i in ids[key]:
                            p = empty[i]
                            omitted[i] = {'id': p.id, 'title': p.title, 'reason': reason}
                for key in batch:
                    for i in ids[key]:
                        if i in omitted:
                            continue
                        p = empty[i]
                        match = retrieved.get(key)
                        if not match:
                            omitted[i] = {'id': p.id, 'title': p.title, 'reason': 'Abstract unavailable from arXiv'}
                        elif not titles_match(match[0], p.title):
                            omitted[i] = {'id': p.id, 'title': p.title, 'reason': 'arXiv title does not match bibliography'}
                        else:
                            good[i] = annotate(p, match[1], f'https://arxiv.org/abs/{key}')
                if offset + 50 < len(arxiv_keys):
                    await asyncio.sleep(3)

        semaphore = asyncio.Semaphore(3)
        async def load_doi(i: int, doi: str):
            async with semaphore:
                p = empty[i]
                try:
                    work = await fetch_doi(client, doi)
                    found_doi = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', str(work.get('doi') or ''), flags=re.I).lower()
                    if found_doi != doi or not titles_match(str(work.get('title') or ''), p.title):
                        reason = 'DOI or OpenAlex title does not match bibliography'
                    else:
                        abstract = clean_source_abstract(restore_abstract(work.get('abstract_inverted_index')))
                        if not abstract:
                            reason = 'Original abstract unavailable from OpenAlex'
                        else:
                            good[i] = annotate(p, abstract, str(work['id']))
                            return
                except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                    reason = f'OpenAlex lookup failed ({type(error).__name__})'
                omitted[i] = {'id': p.id, 'title': p.title, 'reason': reason}
        await asyncio.gather(*(load_doi(i, doi) for i, doi in dois))
    return {'papers': [good[i] for i in sorted(good)], 'count': len(good),
            'requested': len(empty), 'omitted': [omitted[i] for i in sorted(omitted)],
            'notes': 'Only verbatim-source abstracts reconstructed from arXiv or OpenAlex. Missing and unmatched records are omitted.'}
