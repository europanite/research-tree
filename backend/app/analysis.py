"""Paper embedding, agglomerative dendrograms, topic descriptions and cross-field edges."""
from collections import Counter
from functools import lru_cache
import math

import numpy as np
from scipy.cluster.hierarchy import linkage as scipy_linkage, cut_tree
from scipy.spatial.distance import pdist
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS

from .schemas import AnalyzeRequest, Paper

STOP = {'study', 'paper', 'based', 'using', 'learning', 'model', 'models', 'method',
        'methods', 'approach', 'approaches', 'results', 'analysis', 'research', 'new',
        'proposed', 'propose', 'task', 'tasks', 'data', 'towards', 'artificial', 'intelligence'}


def normalized_text(paper: Paper) -> str:
    return f'{paper.title}. {paper.abstract}'.strip()


@lru_cache(maxsize=1)
def minilm_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')


@lru_cache(maxsize=1)
def specter2_model():
    # Optional scientific embedding implementation, following AI2's adapter example.
    from transformers import AutoTokenizer
    from adapters import AutoAdapterModel
    tokenizer = AutoTokenizer.from_pretrained('allenai/specter2_base')
    model = AutoAdapterModel.from_pretrained('allenai/specter2_base')
    model.load_adapter('allenai/specter2', source='hf', load_as='proximity', set_active=True)
    model.eval()
    return tokenizer, model


def embed_papers(papers: list[Paper], model_name: str) -> np.ndarray:
    texts = [normalized_text(p) for p in papers]
    if model_name == 'tfidf':
        matrix = TfidfVectorizer(stop_words='english', ngram_range=(1, 2),
                                 max_features=6000, dtype=np.float32).fit_transform(texts)
        return matrix.toarray()
    if model_name == 'minilm':
        return np.asarray(minilm_model().encode(texts, batch_size=16,
                           normalize_embeddings=True, show_progress_bar=False), dtype=np.float64)
    if model_name == 'specter2':
        import torch
        tokenizer, model = specter2_model()
        outputs = []
        with torch.no_grad():
            for offset in range(0, len(papers), 8):
                batch = [p.title + tokenizer.sep_token + p.abstract for p in papers[offset:offset+8]]
                tokens = tokenizer(batch, padding=True, truncation=True, max_length=512,
                                   return_tensors='pt', return_token_type_ids=False)
                outputs.append(model(**tokens).last_hidden_state[:, 0, :].cpu().numpy())
        return np.vstack(outputs)
    raise ValueError('Unknown model')


def topic_name(papers: list[Paper]) -> str:
    texts = [normalized_text(p) for p in papers]
    try:
        vectorizer = TfidfVectorizer(stop_words=list(STOP | set(ENGLISH_STOP_WORDS)),
                                     ngram_range=(1, 2), max_features=12000)
        matrix = vectorizer.fit_transform(texts)
        scores = np.asarray(matrix.mean(axis=0)).ravel()
        ranked = np.argsort(-scores)
        terms = vectorizer.get_feature_names_out()
        chosen = []
        for i in ranked:
            term = str(terms[i])
            if scores[i] <= 0:
                break
            if any(term in old or old in term for old in chosen):
                continue
            chosen.append(term)
            if len(chosen) == 3:
                break
        return ' / '.join(chosen) if chosen else 'Unlabeled topic'
    except ValueError:
        return 'Unlabeled topic'


def graph_from_linkage(papers: list[Paper], z: np.ndarray) -> dict:
    n = len(papers)
    nodes = []
    edges = []
    heights = {f'leaf-{i}': 0.0 for i in range(n)}
    for i, paper in enumerate(papers):
        # Shortened label is for display only: preserve the complete paper in metadata.
        caption = f'{paper.year or "n.d."} · {paper.title}'
        nodes.append({'id': f'leaf-{i}', 'label': caption[:65], 'index': i})
    for i, (left, right, height, _count) in enumerate(z):
        parent = f'cluster-{i}'
        nodes.append({'id': parent})
        heights[parent] = float(height)
        for child_index in (int(left), int(right)):
            child = f'leaf-{child_index}' if child_index < n else f'cluster-{child_index-n}'
            edges.append({'source': parent, 'target': child,
                          'length': max(0.0, float(height)-heights[child])})
    return {'nodes': nodes, 'edges': edges, 'root': f'cluster-{n-2}', 'clippedBranches': 0}


def analyze(request: AnalyzeRequest, embeddings: np.ndarray | None = None) -> dict:
    # Permit deterministic test-time vectors without involving any model download.
    by_id: dict[str, Paper] = {}
    for paper in request.papers:
        key = paper.id.strip().lower() or paper.title.strip().casefold()
        if key in by_id:
            current = by_id[key]
            current.groups = list(dict.fromkeys(current.groups + paper.groups))
        else:
            by_id[key] = paper.model_copy(deep=True)
    papers = list(by_id.values())
    if any(not p.abstract.strip() or not p.abstract_source.strip() for p in papers):
        raise ValueError('Every paper must have an original Abstract with a recorded source. Resolve papers via the backend first.')
    if len(papers) < 2:
        raise ValueError('At least two distinct papers are required.')
    if request.clusters is not None and request.clusters > len(papers):
        raise ValueError('Requested clusters exceed number of unique papers.')
    vectors = np.asarray(embeddings if embeddings is not None else embed_papers(papers, request.model), dtype=np.float64)
    if vectors.ndim != 2 or vectors.shape[0] != len(papers) or not np.isfinite(vectors).all():
        raise ValueError('Invalid embedding matrix')
    norms = np.linalg.norm(vectors, axis=1)
    if np.any(norms < 1e-12):
        raise ValueError('At least one paper has an empty or zero-vector representation.')
    vectors = vectors / norms[:, None]
    d = np.clip(pdist(vectors, metric='cosine'), 0, 2)
    z = scipy_linkage(d, method=request.linkage, optimal_ordering=False)
    labels = cut_tree(z, n_clusters=request.clusters or min(10, max(2, round(math.sqrt(len(papers)/2))))).ravel()
    groups: dict[int, list[int]] = {}
    for i, label in enumerate(labels.tolist()):
        groups.setdefault(label, []).append(i)
    clusters = []
    for label, indices in sorted(groups.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        subset = [papers[i] for i in indices]
        clusters.append({'id': int(label), 'label': topic_name(subset), 'size': len(indices),
                         'paper_indices': indices,
                         'groups': dict(Counter(group for p in subset for group in p.groups))})
    # Avoid allocating an additional N x N similarity matrix for large corpora.
    all_groups = sorted({group for p in papers for group in p.groups})
    group_bits = {group: 1 << index for index, group in enumerate(all_groups)}
    # Object integers avoid fixed-width overflow if more than 63 query labels are used.
    mask_dtype = object if len(all_groups) > 62 else np.int64
    masks = np.array([sum(group_bits[g] for g in p.groups) for p in papers], dtype=mask_dtype)
    bridges = []
    if len(all_groups) > 1:
        import heapq
        nearest = []
        n = len(papers)
        for i in range(n - 1):
            if not masks[i]:
                continue
            start = n * i - i * (i + 1) // 2
            stop = start + (n - i - 1)
            # Valid pairs must have at least one group each and no common group.
            valid = (masks[i + 1:] != 0) & ((masks[i] & masks[i + 1:]) == 0)
            indices = np.flatnonzero(valid)
            if not len(indices):
                continue
            distances = d[start:stop][indices]
            k = min(30, len(indices))
            picks = np.argpartition(distances, k - 1)[:k] if len(indices) > k else np.arange(len(indices))
            for pick in picks:
                j = i + 1 + int(indices[pick])
                similarity = 1 - float(distances[pick])
                value = (similarity, -i, -j, i, j)
                if len(nearest) < 30:
                    heapq.heappush(nearest, value)
                elif value > nearest[0]:
                    heapq.heapreplace(nearest, value)
        for similarity, _a, _b, i, j in sorted(nearest, reverse=True):
            bridges.append({'a': i, 'b': j, 'similarity': round(similarity, 5),
                            'group_a': papers[i].groups[0], 'group_b': papers[j].groups[0]})
    known = {p.id: i for i, p in enumerate(papers) if p.id}
    shared_papers = [i for i, paper in enumerate(papers) if len(paper.groups) > 1]
    citations = [{'from': i, 'to': known[ref]} for i, paper in enumerate(papers)
                 for ref in paper.referenced_works if ref in known and known[ref] != i]
    return {'papers': [p.model_dump() for p in papers], 'model': request.model,
            'linkage': request.linkage, 'tree': graph_from_linkage(papers, z),
            'clusters': clusters, 'bridges': bridges[:30], 'shared_papers': shared_papers, 'citations': citations,
            'paper_count': len(papers), 'group_labels': all_groups,
            'mean_cosine': round(1.0 - float(np.mean(d)), 5),
            'notes': 'Dendrogram indicates embedding proximity, not historical descent or validated ontology. Bridge pairs are candidates, not proven research gaps.'}
