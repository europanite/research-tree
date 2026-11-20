import csv
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app


def bibliography():
    base = Path(__file__).resolve()
    candidates = [base.parents[1] / 'examples' / 'papers-real.csv',
                  base.parents[2] / 'examples' / 'papers-real.csv']
    source = next((path for path in candidates if path.is_file()), None)
    assert source is not None, 'Missing examples/papers-real.csv'
    with source.open(encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))


def test_curated_bibliography_contains_no_fake_abstracts():
    rows = bibliography()
    assert len(rows) == 59
    assert len({row['id'] for row in rows}) == 59
    assert all(row['url'].startswith('https://') and row['title'] for row in rows)
    assert 'abstract' not in rows[0]
    assert 'summary_type' not in rows[0]
    assert {row['group'] for row in rows} == {'AI Security', 'XAI', 'AI Security;XAI'}


def test_curated_endpoint_only_passes_metadata_to_resolver(monkeypatch):
    async def fake_resolve(papers):
        assert len(papers) == 59
        assert all(not p.abstract and not p.abstract_source for p in papers)
        p = papers[0].model_copy(update={
            'abstract': 'A genuine abstract retrieved from the publication provider for testing.',
            'abstract_source': 'https://arxiv.org/abs/1312.6199',
        })
        return {'papers': [p], 'count': 1, 'requested': 59,
                'omitted': [{'id': v.id, 'title': v.title, 'reason': 'not returned'} for v in papers[1:]],
                'notes': 'test'}
    monkeypatch.setattr('app.main.resolve_papers', fake_resolve)
    response = TestClient(app).get('/api/papers/curated')
    assert response.status_code == 200
    data = response.json()
    assert data['count'] == 1
    assert len(data['omitted']) == 58
    assert data['papers'][0]['abstract_source'].startswith('https://arxiv.org/')


def test_csv_resolution_discards_supplied_editorial_text(monkeypatch):
    async def fake_resolve(papers):
        assert papers[0].abstract == 'NOT ORIGINAL'
        return {'papers': [], 'count': 0, 'requested': 1,
                'omitted': [{'id': papers[0].id, 'title': papers[0].title, 'reason': 'not found'}],
                'notes': 'test'}
    monkeypatch.setattr('app.main.resolve_papers', fake_resolve)
    response = TestClient(app).post('/api/papers/resolve', json={'papers': [
        {'id': 'arxiv:1312.6199', 'title': 'Intriguing properties of neural networks',
         'abstract': 'NOT ORIGINAL'}]})
    assert response.status_code == 200
    assert response.json()['papers'] == []
    assert response.json()['omitted'][0]['reason'] == 'not found'
