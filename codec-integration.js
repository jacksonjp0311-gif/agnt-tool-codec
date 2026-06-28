/**
 * AGNT Codec Integration v1.0.0
 * 
 * Drop-in module that injects intent-based tool scoring into the 
 * toolSelector.js pipeline. Call codecSelectTools() before the existing
 * selectTools() to pre-rank tools by relevance.
 * 
 * Integration point: orchestrator passes userMessage + allSchemas through
 * the codec first, which returns a ranked subset. The existing keyword matching
 * then applies on top for backward compatibility.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CAPABILITY_PATH = path.join(__dirname, 'capability-index.json');
const LOG_PATH = path.join(__dirname, 'selection-log.json');

// ─── STOPWORDS ───────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had','do','does','did',
  'will','would','could','should','may','might','shall','can','need','to','of','in','for','on',
  'with','at','by','from','as','into','through','during','before','after','above','below',
  'between','out','off','over','under','again','further','then','once','here','there','when',
  'where','why','how','all','each','every','both','few','more','most','other','some','such',
  'no','nor','not','only','own','same','so','than','too','very','just','because','but','and',
  'or','if','while','about','up','that','this','these','those','what','which','who','whom','its',
  'our','also','want','like','make','know','time','come','back','much','show','tell','give','run'
]);

// ─── INTENT PATTERNS ─────────────────────────────────────────────────────────

const INTENT_PATTERNS = {
  monitor: ['check','status','health','monitor','watch','track','observe','survey','inspect','diagnose','alert','coherence','drift','anomaly'],
  create: ['create','build','make','generate','write','compose','design','forge','craft','spawn','implement','develop'],
  search: ['find','search','look','locate','discover','query','fetch','retrieve','get','list','browse','explore'],
  analyze: ['analyze','evaluate','assess','review','study','examine','investigate','benchmark','compare','profile','measure'],
  fix: ['fix','repair','resolve','debug','patch','correct','heal','restore','remediate','troubleshoot'],
  deploy: ['deploy','release','publish','push','ship','launch','install','activate','submit'],
  configure: ['configure','setup','set','update','change','modify','adjust','tune','optimize','enable','disable']
};

const DOMAINS = {
  system: ['scm','health','monitor','scheduler','workflow','execution','coherence','ecosystem','state','status'],
  finance: ['credit','burn','wallet','balance','transaction','cost','bitcoin','price','fee','bank','trading'],
  development: ['code','git','github','build','test','deploy','ci','neural','model','train','api'],
  data: ['analyze','query','search','index','corpus','dataset','benchmark','spreadsheet','database'],
  communication: ['discord','slack','email','telegram','message','notify','send','chat','conversation'],
  science: ['chemistry','phi','math','validate','synthesize','reaction','fibonacci','ratio','molecule']
};

// ─── CAPABILITY INDEX ────────────────────────────────────────────────────────

let _cachedIndex = null;
let _indexMtime = 0;

function getIndex() {
  try {
    const stat = fs.statSync(CAPABILITY_PATH);
    if (stat.mtimeMs !== _indexMtime || !_cachedIndex) {
      _cachedIndex = JSON.parse(fs.readFileSync(CAPABILITY_PATH, 'utf8'));
      _indexMtime = stat.mtimeMs;
    }
    return _cachedIndex;
  } catch {
    return { tools: [] };
  }
}

// ─── ENCODER ─────────────────────────────────────────────────────────────────

export function encodeIntent(message) {
  const lower = message.toLowerCase();
  const words = lower.split(/[\s\-_,.()[\]{}]+/).filter(w => w.length > 2);

  let primaryIntent = 'general', intentScore = 0;
  for (const [intent, keywords] of Object.entries(INTENT_PATTERNS)) {
    const mc = keywords.filter(k => lower.includes(k)).length;
    if (mc > intentScore) { intentScore = mc; primaryIntent = intent; }
  }

  let primaryDomain = 'general', domainScore = 0;
  for (const [domain, keywords] of Object.entries(DOMAINS)) {
    const mc = keywords.filter(k => lower.includes(k)).length;
    if (mc > domainScore) { domainScore = mc; primaryDomain = domain; }
  }

  // Keywords: both filtered and raw (raw catches domain words)
  const keywords = words.filter(w => !STOPWORDS.has(w));
  
  return { primaryIntent, primaryDomain, keywords, rawKeywords: words, raw: message };
}

// ─── SELECTOR ────────────────────────────────────────────────────────────────

export function scoreTools(intent, tools) {
  const results = [];

  for (const tool of tools) {
    if (!tool) continue;
    let score = 0;
    const rationale = [];

    const toolKeywords = tool.keywords || [];
    if (!Array.isArray(toolKeywords)) continue;

    // 1. Filtered keyword overlap (0-0.5)
    const overlap = intent.keywords.filter(k => toolKeywords.includes(k));
    if (overlap.length > 0) {
      score += (overlap.length / Math.max(intent.keywords.length, 1)) * 0.5;
      overlap.slice(0, 3).forEach(k => rationale.push('kw:' + k));
    }

    // 2. Raw keyword overlap (catches domain-critical words)
    const rawOverlap = (intent.rawKeywords || []).filter(k => toolKeywords.includes(k));
    if (rawOverlap.length > overlap.length) {
      score += Math.min((rawOverlap.length - overlap.length) * 0.08, 0.3);
    }

    // 3. Domain match (+0.15)
    if (tool.domain === intent.primaryDomain && intent.primaryDomain !== 'general') {
      score += 0.15;
      rationale.push('dom:' + intent.primaryDomain);
    }

    // 4. Intent match (+0.2)
    if (Array.isArray(tool.intents) && tool.intents.includes(intent.primaryIntent) && intent.primaryIntent !== 'general') {
      score += 0.2;
      rationale.push('int:' + intent.primaryIntent);
    }

    // 5. Description match (0-0.3)
    if (tool.description) {
      const dw = tool.description.toLowerCase().split(/[\s\-_,.()[\]{}]+/);
      const dO = (intent.rawKeywords || []).filter(k => dw.includes(k));
      if (dO.length > 0) {
        score += Math.min((dO.length / dw.length) * 0.3, 0.3);
        dO.slice(0, 2).forEach(k => rationale.push('d:' + k));
      }
    }

    // 6. Title match (+0.1 per word)
    if (tool.title) {
      const tw = tool.title.toLowerCase().split(/[\s\-_,.()[\]{}]+/);
      const tO = (intent.rawKeywords || []).filter(k => tw.includes(k));
      if (tO.length > 0) {
        score += 0.1 * tO.length;
        rationale.push('title:' + tO[0]);
      }
    }

    // 7. Plugin name match (+0.05 per word)
    if (tool.plugin && typeof tool.plugin === 'string') {
      const pw = tool.plugin.toLowerCase().split(/[\s\-_]+/);
      const pO = (intent.rawKeywords || []).filter(k => pw.includes(k));
      if (pO.length > 0) score += 0.05 * pO.length;
    }

    score = Math.min(score, 1.0);

    if (score >= 0.12) {
      results.push({
        tool: tool.name,
        score: parseFloat(score.toFixed(3)),
        rationale: rationale.slice(0, 5).join(' | '),
        domain: tool.domain || 'general',
        category: tool.category || 'general',
        plugin: tool.plugin || 'native',
        title: tool.title || tool.name
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─── DECODE SCHEMAS ──────────────────────────────────────────────────────────

export function mapSchemas(rankedTools, allSchemas) {
  const map = new Map();
  for (const s of allSchemas) {
    const name = s.function?.name || s.name;
    if (name) map.set(name, s);
  }
  return rankedTools
    .map(r => ({ schema: map.get(r.tool), score: r.score, rationale: r.rationale, domain: r.domain }))
    .filter(r => r.schema);
}

// ─── LOG SELECTIONS ──────────────────────────────────────────────────────────

function logSelection(message, ranked) {
  try {
    let log = [];
    try { log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch {}
    log.push({
      ts: new Date().toISOString(),
      message: message.substring(0, 120),
      selected: ranked.slice(0, 8).map(r => ({ tool: r.tool, score: r.score })),
      tokenEstimate: ranked.slice(0, 8).length * 1200
    });
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  } catch {}
}

// ─── MAIN: codecSelectTools ──────────────────────────────────────────────────

/**
 * Main entry point for AGNT integration.
 * 
 * Call this from the orchestrator BEFORE the existing keyword matching.
 * Returns a ranked subset of tool schemas ordered by relevance.
 * 
 * @param {string} userMessage - The user's message
 * @param {Array} allSchemas - All available tool schemas (OpenAPI format)
 * @param {Object} options - { maxTools: 8, log: true }
 * @returns {{ ranked: Array, fallbacks: Array, stats: Object }}
 */
export function codecSelectTools(userMessage, allSchemas, options = {}) {
  const maxTools = options.maxTools || 8;
  const intent = encodeIntent(userMessage);
  const index = getIndex();
  
  // Score all indexed tools
  const ranked = scoreTools(intent, index.tools || []);
  
  // Map back to full schemas
  const withSchemas = mapSchemas(ranked, allSchemas).slice(0, maxTools);
  
  // Determine fallbacks
  const selectedNames = new Set(withSchemas.map(r => r.schema?.function?.name || r.schema?.name));
  const fallbacks = ['execute-javascript-code', 'web-search', 'file-operations']
    .filter(f => !selectedNames.has(f));
  
  // Compute token savings
  const staticTokens = (allSchemas.length || 40) * 1200;
  const dynamicTokens = withSchemas.length * 1200;
  
  const stats = {
    totalAvailable: allSchemas.length || 0,
    indexed: index.tools?.length || 0,
    selected: withSchemas.length,
    intent: intent.primaryIntent,
    domain: intent.primaryDomain,
    keywords: intent.keywords.length,
    staticTokens,
    dynamicTokens,
    savings: staticTokens > 0 ? Math.round((1 - dynamicTokens / staticTokens) * 100) : 0,
    tokenBudgetUsed: Math.round((dynamicTokens / 8700) * 100)
  };
  
  if (options.log !== false) {
    logSelection(userMessage, ranked);
  }
  
  return { ranked: withSchemas, fallbacks, stats, intent };
}

// ─── BENCHMARK ───────────────────────────────────────────────────────────────

export function runBenchmark(testCases) {
  const index = getIndex();
  const results = [];
  let totalStaticTokens = 0;
  let totalDynamicTokens = 0;
  let expectedFound = 0;
  let totalExpected = 0;
  
  for (const tc of testCases) {
    const intent = encodeIntent(tc.q);
    const ranked = scoreTools(intent, index.tools || []);
    const top5 = ranked.slice(0, 5);
    const names = top5.map(r => r.tool);
    
    const found = tc.expect.filter(e => names.some(n => n.includes(e) || e.includes(n)));
    const ok = found.length >= Math.ceil(tc.expect.length * 0.5);
    if (ok) expectedFound++;
    totalExpected++;
    
    const staticTokens = 40 * 1200;
    const dynamicTokens = top5.length * 1200;
    totalStaticTokens += staticTokens;
    totalDynamicTokens += dynamicTokens;
    
    results.push({
      query: tc.q,
      ok,
      topTool: top5[0]?.tool || 'none',
      topScore: top5[0]?.score || 0,
      selected: names,
      found: found.length,
      expected: tc.expect.length,
      intent: intent.primaryIntent,
      domain: intent.primaryDomain
    });
  }
  
  return {
    results,
    summary: {
      total: testCases.length,
      passed: expectedFound,
      accuracy: Math.round((expectedFound / totalExpected) * 100),
      avgStaticTokens: Math.round(totalStaticTokens / testCases.length),
      avgDynamicTokens: Math.round(totalDynamicTokens / testCases.length),
      tokenSavings: Math.round((1 - totalDynamicTokens / totalStaticTokens) * 100),
      indexedTools: index.tools?.length || 0
    }
  };
}

export { getIndex };
