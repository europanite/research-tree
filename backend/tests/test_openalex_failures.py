"""Regression tests for OpenAlex status handling (no live network or API keys)."""
import asyncio

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.openalex import OpenAlexAPIError, openalex_page
from app.schemas import SearchQuery, SearchRequest


def run(coro):
    return asyncio.run(coro)


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    async def get(self, url, params):
        self.calls += 1
        response = self.replies.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def response(code, body, headers=None):
    request = httpx.Request('GET', 'https://api.openalex.org/works')
    return httpx.Response(code, json=body, headers=headers, request=request)


def test_429_with_retry_after_retries_and_returns_papers(monkeypatch):
    monkeypatch.delenv('OPENALEX_API_KEY', raising=False)
    delays = []
    async def fake_sleep(seconds):
        delays.append(seconds)
    monkeypatch.setattr('app.openalex.asyncio.sleep', fake_sleep)
    client = FakeClient([response(429, {'message': 'Rate limit exceeded'}, {'Retry-After': '1'}),
                         response(200, {'results': []})])
    payload = run(openalex_page(client, {'search': 'robustness'}, 'search robustness'))
    assert payload['results'] == []
    assert client.calls == 2 and 1 in delays


def test_429_budget_does_not_retry(monkeypatch):
    monkeypatch.delenv('OPENALEX_API_KEY', raising=False)
    async def fake_sleep(seconds): pass
    monkeypatch.setattr('app.openalex.asyncio.sleep', fake_sleep)
    client = FakeClient([response(429, {'message': 'Daily budget exhausted'})])
    try:
        run(openalex_page(client, {}, 'search field A'))
        assert False
    except OpenAlexAPIError as error:
        assert error.status == 429 and 'Daily budget exhausted' in str(error)
        assert 'OPENALEX_API_KEY' in str(error)
        assert client.calls == 1


def test_400_returns_context_and_never_retries(monkeypatch):
    async def fake_sleep(seconds): pass
    monkeypatch.setattr('app.openalex.asyncio.sleep', fake_sleep)
    client = FakeClient([response(400, {'message': 'Invalid sort'})])
    try:
        run(openalex_page(client, {}, 'search field B'))
        assert False
    except OpenAlexAPIError as error:
        assert error.status == 400 and 'Invalid sort' in str(error)
        assert 'search field B' in str(error)
        assert client.calls == 1


def test_credential_is_redacted(monkeypatch):
    monkeypatch.setenv('OPENALEX_API_KEY', 'fake-sensitive-test-secret')
    async def fake_sleep(seconds): pass
    monkeypatch.setattr('app.openalex.asyncio.sleep', fake_sleep)
    client = FakeClient([response(403, {'message': 'Bad key fake-sensitive-test-secret'})])
    try:
        run(openalex_page(client, {}, 'search credential'))
        assert False
    except OpenAlexAPIError as error:
        assert 'fake-sensitive-test-secret' not in str(error)
        assert '[redacted]' in str(error)


def test_api_returns_specific_provider_error(monkeypatch):
    async def fake_collect(request):
        raise OpenAlexAPIError(429, 'search adversarial examples', 'Daily budget exhausted')
    monkeypatch.setattr('app.main.collect_papers', fake_collect)
    api_response = TestClient(app).post('/api/papers/search', json={
        'queries': [{'label': 'AI Security', 'query': 'adversarial examples'}]})
    assert api_response.status_code == 429
    assert 'Daily budget exhausted' in api_response.json()['detail']
    assert 'search adversarial examples' in api_response.json()['detail']
