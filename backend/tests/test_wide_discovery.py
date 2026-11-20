"""Broad systematic discovery: no hand-selected titles, mocked OpenAlex only."""
import asyncio
from fastapi.testclient import TestClient
from app.main import app
from app.openalex import citation_candidates, collect_papers, expand_citation_neighborhood
from app.schemas import Paper, SearchRequest, SearchQuery, AnalyzeRequest, ResolveRequest


def item(n, group='AI Security', refs=None):
    return Paper(id=f'https://openalex.org/W{n}', title=f'Work number {n}',
                 abstract='Actual provider abstract, at least forty characters long and source verified.',
                 abstract_source=f'https://openalex.org/W{n}', groups=[group],
                 referenced_works=refs or [])


def record(n, refs=None, abstract=True):
    return {'id':f'https://openalex.org/W{n}', 'title':f'Work number {n}',
            'abstract_inverted_index': {'Provider':[0], 'verified':[1], 'abstract':[2], 'text':[3]},
            'referenced_works': refs or []} if abstract else {'id':f'https://openalex.org/W{n}', 'title':f'Work number {n}'}


def test_broad_sampling_uses_three_distinct_rankings(monkeypatch):
    calls=[]
    class Client:
        def __init__(self,**_):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*_):pass
        async def get(self,url,params):
            calls.append(params.copy())
            sort=params.get('sort')
            index={'relevance_score:desc':1,'cited_by_count:desc':2,'publication_date:desc':3}[sort]
            class Response:
                def raise_for_status(self):pass
                def json(self):return {'results':[record(index)]}
            return Response()
    monkeypatch.setattr('app.openalex.httpx.AsyncClient', Client)
    request=SearchRequest(queries=[SearchQuery(label='Security',query='machine learning security')],
                          limit_per_query=3,diversify=True)
    papers=asyncio.run(collect_papers(request))
    assert len(papers)==3
    assert {p['sort'] for p in calls}=={'relevance_score:desc','cited_by_count:desc','publication_date:desc'}


def test_one_hop_citations_discover_unmentioned_works_and_keep_source_abstracts(monkeypatch):
    seeds=[item(1,refs=['https://openalex.org/W12','https://openalex.org/W13']),
           item(2,'XAI',refs=['https://openalex.org/W12','https://openalex.org/W14'])]
    assert citation_candidates(seeds)[0]==('W12',['AI Security','XAI'])
    calls=[]
    class Client:
        def __init__(self,**_):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*_):pass
        async def get(self,url,params):
            calls.append(params.copy())
            assert params['filter'].startswith('id:W12|')
            class Response:
                def raise_for_status(self):pass
                def json(self):return {'results':[record(12),record(13,abstract=False),record(14)]}
            return Response()
    monkeypatch.setattr('app.openalex.httpx.AsyncClient',Client)
    neighbors=asyncio.run(expand_citation_neighborhood(seeds,10))
    assert {p.id for p in neighbors}=={'https://openalex.org/W12','https://openalex.org/W14'}
    assert all(p.abstract_source for p in neighbors)
    assert neighbors[0].groups==['AI Security','XAI']
    assert len(calls)==1


def test_no_application_paper_or_search_query_cap():
    queries=[SearchQuery(label=f'Field {i}', query=f'machine learning robustness {i}') for i in range(40)]
    req=SearchRequest(queries=queries,limit_per_query=5000,citation_expansion=10000)
    assert len(req.queries)==40 and req.citation_expansion==10000
    assert req.limit_per_query==5000
    records=[item(i) for i in range(3001)]
    assert len(AnalyzeRequest(papers=records).papers)==3001
    assert len(ResolveRequest(papers=records).papers)==3001


def test_openalex_cursor_pagination_with_api_key(monkeypatch):
    calls=[]
    monkeypatch.setenv('OPENALEX_API_KEY','local-test-key')
    class Client:
        def __init__(self,**_):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*_):pass
        async def get(self,url,params):
            calls.append(dict(params))
            index=0 if params['cursor']=='*' else 1
            class Response:
                def raise_for_status(self):pass
                def json(self):return {'results':[record(1000+index)]*100,
                                        'meta':{'next_cursor':['next','last'][index]}}
            return Response()
    monkeypatch.setattr('app.openalex.httpx.AsyncClient',Client)
    request=SearchRequest(queries=[SearchQuery(label='Security',query='machine learning security')],
                          limit_per_query=102,diversify=False)
    papers=asyncio.run(collect_papers(request))
    assert len(papers)==2
    assert [c['cursor'] for c in calls]==['*','next']
    assert all(c['api_key']=='local-test-key' for c in calls)


def test_route_does_not_use_bibliography_or_named_paper_audits(monkeypatch):
    async def fetched(req):return [item(1)]
    async def expanded(seeds,budget):return [item(4,'XAI')]
    monkeypatch.setattr('app.main.collect_papers',fetched)
    monkeypatch.setattr('app.main.expand_citation_neighborhood',expanded)
    response=TestClient(app).post('/api/papers/search',json={
        'queries':[{'label':'Security','query':'general machine learning security'}],
        'citation_expansion':600,'diversify':True})
    assert response.status_code==200
    result=response.json()
    assert result['count']==2 and result['collection']['citation_added']==1
    assert not any('patch' in key or 'curated' in key for key in result)
