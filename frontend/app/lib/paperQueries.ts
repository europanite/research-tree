/** Systematic field sampling, deliberately excluding individual paper titles. */
export const FIELD_SURVEY_QUERIES = `AI Security | adversarial machine learning
AI Security | adversarial examples
AI Security | adversarial robustness
AI Security | physical-world adversarial attacks
AI Security | robust computer vision
AI Security | localized perturbations
AI Security | universal adversarial perturbations
AI Security | transformation robustness
AI Security | generative adversarial networks
AI Security | certified robustness
AI Security | security of machine learning systems
AI Security | robustness of deep neural networks
AI Security | computer vision security
AI Security | robust object recognition
AI Security | data integrity in machine learning
AI Security | privacy in machine learning
AI Security | AI safety and trustworthy systems
AI Security | robustness verification neural networks
AI Security | cybersecurity machine learning
XAI | explainable artificial intelligence
XAI | interpretable machine learning
XAI | explanation methods neural networks
XAI | interpretability deep vision systems
XAI | causal reasoning machine learning
XAI | feature attribution and saliency
XAI | visual saliency and attention
XAI | gradient-based interpretability
XAI | mechanistic interpretability
XAI | reliability of model explanations`;
export const BASIC_QUERIES = 'AI Security | adversarial machine learning\nXAI | explainable artificial intelligence';
export type PaperQuery = {label:string;query:string};
export function parsePaperQueries(input:string): PaperQuery[] {
  const parsed=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{
    const at=line.indexOf('|');
    if(at < 1)throw new Error('Each line must be: group | search phrase');
    return {label:line.slice(0,at).trim(),query:line.slice(at+1).trim()};
  });
  if(!parsed.length||parsed.some(v=>!v.label||v.label.length>60||v.query.length<2||v.query.length>250))
    throw new Error('Enter at least one valid search phrase.');
  return parsed;
}
