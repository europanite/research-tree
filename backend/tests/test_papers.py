import asyncio
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.analysis import analyze
from app.main import app
from app.openalex import restore_abstract, normalize_work, collect_papers
from app.schemas import AnalyzeRequest, Paper, SearchQuery, SearchRequest


def paper(i, group):
    return Paper(id=f'https://openalex.org/W{i}', title=f'Synthetic research paper {i}',
                 abstract=f'Abstract about domain {group}', abstract_source=f'https://openalex.org/W{i}', groups=[group], year=2024,
                 referenced_works=['https://openalex.org/W1'] if i == 2 else [])


def test_abstract_repeated_words_and_missing():
    assert restore_abstract({'XAI': [0, 2], 'explains': [1]}) == 'XAI explains XAI'
    assert restore_abstract(None) == ''


def test_metadata_normalization():
    raw = {'id':'https://openalex.org/W3', 'title': 'A real paper title',
           'abstract_inverted_index': {'robust': [1], 'Methods': [0]},
           'publication_year': 2025, 'cited_by_count': 4}
    result = normalize_work(raw, 'AI Security')
    assert result.abstract == 'Methods robust'
    assert result.groups == ['AI Security']
    assert result.abstract_source == 'https://openalex.org/W3'


def test_tree_groups_bridges_citations_no_model_download():
    request = AnalyzeRequest(papers=[paper(1,'Security'), paper(2,'Security'),
                                      paper(3,'XAI'), paper(4,'XAI')], model='tfidf', clusters=2)
    vectors = np.array([[1,0,0],[.9,.1,0],[0,1,0],[0,.9,.1]])
    result = analyze(request, embeddings=vectors)
    assert len(result['tree']['nodes']) == 7
    assert len(result['tree']['edges']) == 6
    assert result['tree']['root'] == 'cluster-2'
    assert sum(c['size'] for c in result['clusters']) == 4
    assert len(result['bridges']) == 4
    assert result['shared_papers'] == []
    assert {'from':1, 'to':0} in result['citations']
    assert len({n['id'] for n in result['tree']['nodes']}) == 7


def test_duplicates_merge_groups_and_bad_vectors():
    records = [paper(1,'Security'), paper(1,'XAI'), paper(2,'Security')]
    result = analyze(AnalyzeRequest(papers=records, model='tfidf'),
                     embeddings=np.array([[1,0],[0,1]]))
    assert result['paper_count'] == 2
    assert result['papers'][0]['groups'] == ['Security','XAI']
    assert result['shared_papers'] == [0]
    with pytest.raises(ValueError, match='Invalid embedding'):
        analyze(AnalyzeRequest(papers=[paper(1,'A'), paper(2,'B')], model='tfidf'),
                embeddings=np.array([[float('nan'),0],[0,1]]))


def test_api_health_and_validation():
    client = TestClient(app)
    assert client.get('/api/health').json()['status'] == 'ok'
    assert client.post('/api/papers/analyze', json={'papers': []}).status_code == 422
    assert client.post('/api/papers/search', json={'queries': []}).status_code == 422
    # No 3000-record schema limit: validation still rejects malformed requests.
    assert SearchRequest(queries=[SearchQuery(label='X',query='AI')],limit_per_query=3001).limit_per_query==3001


def test_search_dedup_and_membership(monkeypatch):
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {'results':[{'id':'https://openalex.org/W55', 'title':'Shared paper', 'abstract_inverted_index':{'This':[0], 'study':[1], 'investigates':[2], 'robust':[3], 'explanations':[4], 'of':[5], 'complex':[6], 'models':[7], 'using':[8], 'data':[9]}}]}
    class FakeClient:
        def __init__(self, **kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self, *args):pass
        async def get(self, url, params):return Response()
    monkeypatch.setattr('app.openalex.httpx.AsyncClient', FakeClient)
    request=SearchRequest(queries=[SearchQuery(label='Security',query='adversarial training'),
                                   SearchQuery(label='XAI',query='explainability')], limit_per_query=2)
    found=asyncio.run(collect_papers(request))
    assert len(found)==1
    assert found[0].groups==['Security','XAI']


def test_analyze_api_mocked_embedding(monkeypatch):
    monkeypatch.setattr('app.analysis.embed_papers', lambda papers, model: np.array([[1,0],[0,1]]))
    records = [paper(1,'Security').model_dump(), paper(2,'XAI').model_dump()]
    response = TestClient(app).post('/api/papers/analyze', json={'papers':records, 'model':'minilm'})
    assert response.status_code == 200
    data = response.json()
    assert data['tree']['root'] == 'cluster-0'
    assert len(data['tree']['edges']) == 2
    assert data['papers'][0]['title'] == 'Synthetic research paper 1'
