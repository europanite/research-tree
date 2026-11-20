import {FIELD_SURVEY_QUERIES,parsePaperQueries} from '../lib/paperQueries';
test('broad survey names fields, never specific publications',()=>{
  const queries=parsePaperQueries(FIELD_SURVEY_QUERIES);
  expect(queries.length).toBe(29);
  const addedOrRetained = [
    'adversarial machine learning',
    'adversarial examples',
    'adversarial robustness',
    'physical-world adversarial attacks',
    'robust computer vision',
    'localized perturbations',
    'universal adversarial perturbations',
    'transformation robustness',
    'visual saliency and attention',
    'gradient-based interpretability',
    'generative adversarial networks',
    'certified robustness',
  ];
  for (const topic of addedOrRetained) {
    expect(queries.filter(q => q.query === topic)).toHaveLength(1);
  }
  expect(new Set(queries.map(q => q.query)).size).toBe(29);
  expect(queries.every(q=>q.label==='AI Security'||q.label==='XAI')).toBe(true);
  expect(FIELD_SURVEY_QUERIES.toLowerCase()).not.toContain('patch');
  expect(FIELD_SURVEY_QUERIES.toLowerCase()).not.toContain('brown');
});
test('parser enforces server-compatible limits',()=>{
  expect(()=>parsePaperQueries('No separator')).toThrow();
  expect(parsePaperQueries(Array(100).fill('XAI | explainability').join('\n'))).toHaveLength(100);
});
