import asyncio
from app.abstracts import arxiv_id, canonical_doi, titles_match, fetch_arxiv, resolve_papers, clean_source_abstract
from app.schemas import Paper


def paper(ident, title, abstract='Editorial paraphrase'):
    return Paper(id=ident, title=title, abstract=abstract, groups=['AI Security'])


def test_matching_and_ids_are_strict():
    assert arxiv_id(paper('arxiv:1412.6572', 'Example')) == '1412.6572'
    assert canonical_doi(paper('doi:10.1234/test', 'Example')) == '10.1234/test'
    assert titles_match('Adversarial   PATCH', 'Adversarial Patch')
    assert not titles_match('Another unrelated research article', 'Adversarial Patch')
    assert clean_source_abstract('short') == ''


def test_arxiv_summary_is_exactly_from_atom():
    contents = b'''<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>http://arxiv.org/abs/1412.6572v3</id>
    <title>Explaining and Harnessing Adversarial Examples</title>
    <summary>The original author-submitted abstract here is a deliberately distinctive test fixture and does not come from the editorial CSV text.</summary>
    </entry></feed>'''
    class Reply:
        content = contents
        def raise_for_status(self): return None
    class Client:
        async def get(self, *args, **kwargs): return Reply()
    results = asyncio.run(fetch_arxiv(Client(), ['1412.6572']))
    assert results['1412.6572'][1].startswith('The original author-submitted')


def test_resolver_skips_mismatched_title_and_absent_abstract(monkeypatch):
    class DummyClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
    async def mocked_arxiv(client, ids):
        return {'1412.6572': ('Completely different title', 'A perfectly lengthy and valid abstract for testing different metadata.'),
                '1312.6199': ('Intriguing properties of neural networks', 'The original provider text about network vulnerabilities and behavior is available and recorded here.')}
    monkeypatch.setattr('app.abstracts.httpx.AsyncClient', DummyClient)
    monkeypatch.setattr('app.abstracts.fetch_arxiv', mocked_arxiv)
    records = [paper('arxiv:1412.6572', 'Explaining and Harnessing Adversarial Examples'),
               paper('arxiv:1312.6199', 'Intriguing properties of neural networks'),
               paper('bad:id', 'Anything')]
    result = asyncio.run(resolve_papers(records))
    assert result['requested'] == 3 and result['count'] == 1
    assert result['papers'][0].abstract.startswith('The original provider text')
    assert result['papers'][0].abstract_source == 'https://arxiv.org/abs/1312.6199'
    assert len(result['omitted']) == 2
    assert result['omitted'][0]['reason'] == 'arXiv title does not match bibliography'
    assert result['omitted'][1]['reason'] == 'No supported arXiv ID or DOI'


def test_resolver_rejects_submitted_fake_abstract_if_provider_has_none(monkeypatch):
    class DummyClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
    async def mocked_arxiv(client, ids): return {}
    monkeypatch.setattr('app.abstracts.httpx.AsyncClient', DummyClient)
    monkeypatch.setattr('app.abstracts.fetch_arxiv', mocked_arxiv)
    result = asyncio.run(resolve_papers([paper('arxiv:1412.6572', 'Explaining and Harnessing Adversarial Examples')]))
    assert result['count'] == 0 and len(result['omitted']) == 1


def test_doi_resolution_checks_provider_title_and_doi(monkeypatch):
    class DummyClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
    async def mocked_doi(client, doi):
        return {'id': 'https://openalex.org/W99', 'title': 'Known scientific work',
                'doi': 'https://doi.org/10.1234/testing',
                'abstract_inverted_index': {'This':[0], 'original':[1], 'provider':[2], 'abstract':[3],
                  'is':[4], 'several':[5], 'words':[6], 'longer':[7], 'than':[8], 'any':[9],
                  'invented':[10], 'editorial':[11], 'text':[12], 'supplied':[13]}}
    monkeypatch.setattr('app.abstracts.httpx.AsyncClient', DummyClient)
    monkeypatch.setattr('app.abstracts.fetch_doi', mocked_doi)
    records=[paper('doi:10.1234/testing','Known scientific work'),
             paper('doi:10.9999/wrong','Wrong paper')]
    data=asyncio.run(resolve_papers(records))
    assert data['count']==1
    assert data['papers'][0].abstract_source=='https://openalex.org/W99'
    assert data['papers'][0].abstract.startswith('This original provider abstract')
    assert data['omitted'][0]['reason']=='DOI or OpenAlex title does not match bibliography'
