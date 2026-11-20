from pydantic import BaseModel, Field, field_validator

class SearchQuery(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    query: str = Field(min_length=2, max_length=250)


class SearchRequest(BaseModel):
    queries: list[SearchQuery] = Field(min_length=1)
    limit_per_query: int = Field(default=100, ge=2)
    diversify: bool = False
    citation_expansion: int = Field(default=0, ge=0)


class Paper(BaseModel):
    id: str = Field(default='', max_length=300)
    title: str = Field(min_length=2, max_length=1000)
    abstract: str = Field(default='', max_length=12000)
    abstract_source: str = Field(default='', max_length=500)
    year: int | None = Field(default=None, ge=1800, le=2200)
    doi: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=500)
    groups: list[str] = Field(default_factory=list)
    cited_by_count: int = Field(default=0, ge=0)
    referenced_works: list[str] = Field(default_factory=list)

    @field_validator('groups')
    @classmethod
    def clean_groups(cls, groups: list[str]) -> list[str]:
        return list(dict.fromkeys(v.strip()[:60] for v in groups if v.strip()))


class AnalyzeRequest(BaseModel):
    papers: list[Paper] = Field(min_length=2)
    model: str = Field(default='minilm', pattern='^(minilm|specter2|tfidf)$')
    linkage: str = Field(default='average', pattern='^(average|complete)$')
    clusters: int | None = Field(default=None, ge=2, le=30)


class ResolveRequest(BaseModel):
    """Bibliographic data; submitted abstract content is never trusted."""
    papers: list[Paper] = Field(min_length=1)
