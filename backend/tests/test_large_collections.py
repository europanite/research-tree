"""Offline tests for multi-page authentic-abstract collection and large clustering."""
import asyncio

import numpy as np
from app.analysis import analyze
from app.openalex import collect_papers
from app.schemas import AnalyzeRequest, Paper, SearchQuery, SearchRequest


def test_search_uses_100_item_pages_preserves_original_and_membership(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, works):
            self.works = works
        def raise_for_status(self):
            pass
        def json(self):
            return {'results': self.works}

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url, params):
            calls.append(dict(params))
            assert params['per_page'] == 100
            offset = (params['page'] - 1) * 100
            # Two search groups return the same first 125 works. Group membership
            # should merge, without fabricating a single abstract.
            works = []
            for i in range(offset, min(offset + 100, 125)):
                works.append({'id': f'https://openalex.org/W{i}',
                              'title': f'An authentic article {i}',
                              'abstract_inverted_index': {'Original': [0], 'abstract': [1],
                                                          'from': [2], 'the': [3],
                                                          'publication': [4], str(i): [5]}})
            return FakeResponse(works)

    monkeypatch.setattr('app.openalex.httpx.AsyncClient', FakeClient)
    req = SearchRequest(queries=[SearchQuery(label='Security',query='adversarial learning'),
                                 SearchQuery(label='XAI',query='explainable AI')], limit_per_query=125)
    papers = asyncio.run(collect_papers(req))
    assert len(papers) == 125
    assert len(calls) == 4
    assert [call['page'] for call in calls] == [1, 2, 1, 2]
    assert all(p.abstract_source.startswith('https://openalex.org/') for p in papers)
    assert all(p.groups == ['Security', 'XAI'] for p in papers)


def test_large_collection_with_real_source_fields_and_no_dense_similarity():
    rng = np.random.default_rng(123)
    n = 600
    papers = [Paper(id=f'https://openalex.org/W{i}', title=f'Paper {i}',
                    abstract='Published abstract text received from the source',
                    abstract_source=f'https://openalex.org/W{i}',
                    groups=['Security' if i % 2 else 'XAI']) for i in range(n)]
    embeddings = rng.normal(size=(n, 20))
    result = analyze(AnalyzeRequest(papers=papers, model='tfidf'), embeddings)
    assert result['paper_count'] == n
    assert len(result['tree']['nodes']) == 2*n - 1
    assert len(result['bridges']) == 30
    assert all(result['papers'][x]['abstract_source'] for x in range(n))
    assert -1 <= result['mean_cosine'] <= 1


def test_analysis_accepts_more_than_63_group_labels():
    papers=[Paper(id=f'https://openalex.org/W{i}', title=f'Topic paper {i}',
                  abstract='Source abstract for classification analysis',
                  abstract_source=f'https://openalex.org/W{i}', groups=[f'Group{i}']) for i in range(70)]
    vectors=np.eye(70)
    result=analyze(AnalyzeRequest(papers=papers,model='tfidf'), embeddings=vectors)
    assert result['paper_count']==70
    assert len(result['group_labels'])==70
