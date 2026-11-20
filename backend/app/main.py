import csv
import logging
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool

from .analysis import analyze
from .abstracts import resolve_papers
from .openalex import OpenAlexAPIError, collect_papers, expand_citation_neighborhood
from .schemas import AnalyzeRequest, SearchRequest, ResolveRequest, Paper

app = FastAPI(title='Semantic Tree Paper API', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origins=[
    'http://localhost:8081', 'http://127.0.0.1:8081',
], allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])


@app.get('/api/health')
def health():
    return {'status': 'ok', 'mode': 'local-embedding'}


@app.get('/api/papers/curated')
async def curated_papers():
    """Get original source abstracts on demand; never use editorial summaries."""
    base = Path(__file__).resolve()
    candidates = [base.parents[1] / 'examples' / 'papers-real.csv',
                  base.parents[2] / 'examples' / 'papers-real.csv']
    source = next((path for path in candidates if path.is_file()), None)
    if source is None:
        raise HTTPException(503, 'Curated bibliography is missing from the image.')
    with source.open(encoding='utf-8', newline='') as handle:
        entries = list(csv.DictReader(handle))
    bibliography = [Paper(id=item['id'], title=item['title'], abstract='',
                          year=int(item['year']), doi=item.get('doi') or None,
                          url=item.get('url') or None,
                          groups=item['group'].split(';')) for item in entries]
    result = await resolve_papers(bibliography)
    return {**{k: ([p.model_dump() for p in v] if k == 'papers' else v) for k, v in result.items()},
            'source': 'Original abstracts retrieved live from arXiv / OpenAlex'}


@app.post('/api/papers/resolve')
async def resolve_uploaded_papers(request: ResolveRequest):
    """Ignore submitted abstract, resolve only matching arXiv IDs / DOIs."""
    result = await resolve_papers(request.papers)
    return {k: ([p.model_dump() for p in v] if k == 'papers' else v) for k, v in result.items()}


@app.post('/api/papers/search')
async def search(request: SearchRequest):
    try:
        seeds = await collect_papers(request)
        if not seeds:
            raise ValueError('No publications with original abstracts were returned.')
        neighbors = await expand_citation_neighborhood(seeds, request.citation_expansion)
        unique = {p.id.lower(): p for p in seeds}
        added = 0
        for paper in neighbors:
            key = paper.id.lower()
            if key in unique:
                unique[key].groups = list(dict.fromkeys(unique[key].groups + paper.groups))
            else:
                unique[key] = paper
                added += 1
        papers = list(unique.values())
        return {'papers': [paper.model_dump() for paper in papers], 'count': len(papers),
                'collection': {'search_papers': len(seeds), 'citation_added': added,
                               'queries': len(request.queries), 'diversified': request.diversify},
                'source': 'OpenAlex: multi-ranking search + one-hop citation expansion; original abstracts only'}
    except OpenAlexAPIError as exc:
        logging.warning('OpenAlex retrieval failed: %s', exc)
        raise HTTPException(429 if exc.status == 429 else 502, str(exc)) from exc
    except httpx.HTTPError as exc:
        logging.warning('OpenAlex transport error: %s', type(exc).__name__)
        raise HTTPException(502, f'OpenAlex network error: {type(exc).__name__}; check backend connectivity.') from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post('/api/papers/analyze')
async def analyze_papers(request: AnalyzeRequest):
    try:
        return await run_in_threadpool(analyze, request)
    except (ValueError, ImportError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(503, f'Local model unavailable: {type(exc).__name__}') from exc
