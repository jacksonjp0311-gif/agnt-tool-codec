/**
 * AGNT Tool Codec v1.0.0
 * 
 * Intent-based dynamic tool selection engine.
 * Encodes user intent → Scores all tools → Selects optimal subset → Decodes to schema.
 * 
 * Reduces context from ~77K tokens (static) to ~8.7K tokens (dynamic).
 * 
 * Usage:
 *   node tool-codec.js --query "check system health"
 *   node tool-codec.js --install  (registers as AGNT custom tool)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'config.json');
const INDEX_PATH = path.join(__dirname, 'capability-index.json');
const LOG_PATH = path.join(__dirname, 'selection-log.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { maxTools: 8, minThreshold: 0.40, tokenBudget: 8700, domainBoost: 0.15, historyBoost: 0.10, fallbackTools: ["execute_javascript", "web_search"] }; }
}

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); }
  catch { return buildFallbackIndex(); }
}

// ─── ENCODER ─────────────────────────────────────────────────────────────────

/**
 * Encode a user message into an intent profile.
 * Produces: { intent, domain, action, keywords, vector }
 */
function encodeIntent(message, config) {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  
  // Detect primary intent
  let primaryIntent = 'general';
  let intentScore = 0;
  for (const [intent, keywords] of Object.entries(config.intentPatterns || {})) {
    const matchCount = keywords.filter(k => lower.includes(k)).length;
    if (matchCount > intentScore) {
      intentScore = matchCount;
      primaryIntent = intent;
    }
  }

  const firstWord = words[0];
  for (const [intent, keywords] of Object.entries(config.intentPatterns || {})) {
    if (keywords.includes(firstWord)) {
      primaryIntent = intent;
      break;
    }
  }
  
  // Detect domain
  let primaryDomain = 'general';
  let domainScore = 0;
  for (const [domain, keywords] of Object.entries(config.domains || {})) {
    const matchCount = keywords.filter(k => lower.includes(k)).length;
    if (matchCount > domainScore) {
      domainScore = matchCount;
      primaryDomain = domain;
    }
  }
  
  // Extract keywords (remove stopwords)
  const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up', 'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'its', 'our', 'out', 'off', 'also', 'want', 'like', 'make', 'know', 'time', 'very', 'when', 'come', 'back', 'much']);
  const keywords = words.filter(w => !stopwords.has(w));

  if (
    words.some(w => ['plugin', 'plugins'].includes(w)) &&
    ['create', 'deploy', 'configure'].includes(primaryIntent)
  ) {
    primaryDomain = 'development';
  }
  
  // Build intent vector (sparse representation)
  const vector = {};
  keywords.forEach(w => { vector[w] = 1; });
  if (primaryIntent !== 'general') vector['__intent_' + primaryIntent] = 2;
  if (primaryDomain !== 'general') vector['__domain_' + primaryDomain] = 1.5;
  
  return {
    primaryIntent,
    primaryDomain,
    keywords,
    vector,
    rawKeywords: words,
    raw: message
  };
}

// ─── SELECTOR ────────────────────────────────────────────────────────────────

/**
 * Score all tools against the intent vector.
 * Returns ranked list: [{ tool, score, rationale }]
 */
function selectTools(intent, tools, config, history = []) {
  const scores = [];
  
  for (const tool of tools) {
    let score = 0;
    const rationale = [];
    
    // 1. Cosine similarity (keyword overlap)
    const toolKeywords = tool.keywords || [];
    const intentKeywords = intent.keywords;
    const overlap = intentKeywords.filter(k => toolKeywords.includes(k));
    if (overlap.length > 0) {
      score += (overlap.length / Math.max(intentKeywords.length, 1)) * 0.5;
      overlap.slice(0, 3).forEach(k => rationale.push(`keyword:${k}`));
    }

    const rawOverlap = (intent.rawKeywords || []).filter(k => toolKeywords.includes(k));
    if (rawOverlap.length > overlap.length) {
      score += Math.min((rawOverlap.length - overlap.length) * 0.08, 0.3);
    }
    
    // 2. Domain match boost
    if (tool.domain === intent.primaryDomain && intent.primaryDomain !== 'general') {
      score += config.domainBoost || 0.15;
      rationale.push(`domain:${intent.primaryDomain}`);
    }
    
    // 3. Intent category match
    if (tool.intents && tool.intents.includes(intent.primaryIntent)) {
      score += 0.2;
      rationale.push(`intent:${intent.primaryIntent}`);
    }
    
    // 4. Description semantic match (simplified — word overlap)
    if (tool.description) {
      const descWords = tool.description.toLowerCase().split(/\s+/);
      const descOverlap = intentKeywords.filter(k => descWords.includes(k));
      if (descOverlap.length > 0) {
        score += (descOverlap.length / descWords.length) * 0.3;
        descOverlap.slice(0, 2).forEach(k => rationale.push(`desc:${k}`));
      }
    }

    if (tool.title) {
      const titleWords = tool.title.toLowerCase().split(/[\s\-_,.()[\]{}]+/);
      const titleOverlap = (intent.rawKeywords || []).filter(k => titleWords.includes(k));
      if (titleOverlap.length > 0) {
        score += 0.1 * titleOverlap.length;
        rationale.push(`title:${titleOverlap[0]}`);
      }
    }
    
    // 5. History bias
    const recentUse = history.slice(-config.historyWindow || 20).filter(h => h.tool === tool.name);
    if (recentUse.length > 0) {
      const successRate = recentUse.filter(h => h.success).length / recentUse.length;
      score += successRate * (config.historyBoost || 0.10);
      rationale.push(`history:${recentUse.length}x`);
    }
    
    // 6. Fallback tool bonus (always slightly elevated)
    if (config.fallbackTools && config.fallbackTools.includes(tool.name)) {
      score += 0.05;
    }
    
    score = Math.min(score, 1.0);
    
    if (score >= (config.minThreshold || 0.40)) {
      scores.push({
        tool: tool.name,
        score: parseFloat(score.toFixed(3)),
        rationale: rationale.slice(0, 4),
        category: tool.category || 'general',
        domain: tool.domain || 'general'
      });
    }
  }
  
  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  
  // Take top N
  return scores.slice(0, config.maxTools || 8);
}

// ─── DECODER ─────────────────────────────────────────────────────────────────

/**
 * Decode selected tools into injection format.
 * Applies token budget and adds fallback tools.
 */
function decodeSelection(selected, config) {
  const result = {
    selected: selected.map(s => ({
      tool: s.tool,
      confidence: s.score,
      rationale: s.rationale.join(', '),
      category: s.category,
      domain: s.domain
    })),
    metadata: {
      totalSelected: selected.length,
      tokenEstimate: selected.length * 1200, // ~1.2K tokens per schema
      budget: config.tokenBudget || 8700,
      withinBudget: (selected.length * 1200) <= (config.tokenBudget || 8700)
    }
  };
  
  // Add fallbacks if room
  const fallbackRoom = Math.floor(((config.tokenBudget || 8700) - result.metadata.tokenEstimate) / 1200);
  if (fallbackRoom > 0 && config.fallbackTools) {
    const fallbacks = config.fallbackTools
      .filter(f => !selected.find(s => s.tool === f))
      .slice(0, fallbackRoom);
    result.fallbacks = fallbacks;
    result.metadata.totalSelected += fallbacks.length;
    result.metadata.tokenEstimate += fallbacks.length * 1200;
  }
  
  return result;
}

// ─── FALLBACK INDEX ─────────────────────────────────────────────────────────

function buildFallbackIndex() {
  // Built-in tool definitions for when no external index exists
  return {
    tools: [
      { name: 'execute_javascript', intents: ['analyze', 'create', 'fix'], domain: 'development', keywords: ['code', 'run', 'script', 'javascript', 'calculate', 'process', 'transform'], description: 'Execute custom JavaScript code for advanced logic and data processing' },
      { name: 'web_search', intents: ['search', 'analyze'], domain: 'data', keywords: ['search', 'find', 'lookup', 'google', 'research', 'information', 'web'], description: 'Search the web for current information' },
      { name: 'file_operations', intents: ['create', 'search', 'configure'], domain: 'system', keywords: ['file', 'read', 'write', 'directory', 'folder', 'move', 'copy', 'delete'], description: 'Read, write, and manage file system operations' },
      { name: 'database_operation', intents: ['search', 'analyze', 'configure'], domain: 'data', keywords: ['database', 'query', 'select', 'insert', 'update', 'sql', 'table'], description: 'Query and manipulate database tables' },
      { name: 'web_scrape', intents: ['search', 'analyze'], domain: 'data', keywords: ['scrape', 'extract', 'webpage', 'content', 'html', 'website', 'url'], description: 'Extract content from web pages' },
      { name: 'scm-check-health', intents: ['monitor'], domain: 'system', keywords: ['health', 'coherence', 'monitor', 'system', 'status', 'check'], description: 'Autonomous ecosystem health monitor with coherence scoring' },
      { name: 'scm-report', intents: ['monitor', 'analyze'], domain: 'system', keywords: ['report', 'health', 'coherence', 'anomaly', 'detection', 'recommendations'], description: 'Produces markdown coherence report with anomaly detection' },
      { name: 'credit-burn-guard', intents: ['monitor', 'analyze'], domain: 'finance', keywords: ['credits', 'burn', 'cost', 'wallet', 'balance', 'usage', 'spending'], description: 'Monitors credit consumption across all workflows' },
      { name: 'adaptive-scheduler', intents: ['monitor', 'analyze'], domain: 'system', keywords: ['schedule', 'frequency', 'adaptive', 'interval', 'advise', 'optimize'], description: 'Dynamically adjusts workflow schedules based on error rates' },
      { name: 'self-healing', intents: ['fix', 'monitor'], domain: 'system', keywords: ['error', 'fix', 'heal', 'repair', 'resolve', 'broken', 'failed'], description: 'Scans errors and generates fix proposals' },
      { name: 'ecosystem-drift', intents: ['monitor', 'analyze'], domain: 'system', keywords: ['drift', 'regression', 'snapshot', 'compare', 'change', 'degradation'], description: 'Compares current state to golden standard, flags regressions' },
      { name: 'emergence-amplify', intents: ['analyze'], domain: 'system', keywords: ['emergence', 'pattern', 'detect', 'reliability', 'replicate'], description: 'Detects emergence patterns in execution data' },
      { name: 'tool-usage-analyzer', intents: ['analyze', 'monitor'], domain: 'system', keywords: ['tools', 'unused', 'usage', 'available', 'consolidate', 'analyze'], description: 'Analyzes which tools are used vs available' },
      { name: 'plugin-health', intents: ['monitor'], domain: 'system', keywords: ['plugin', 'build', 'missing', 'orphan', 'health', 'scan'], description: 'Scans all plugin builds and checks registration' },
      { name: 'pce-v3.5-validator', intents: ['analyze'], domain: 'science', keywords: ['phi', 'golden', 'ratio', 'validate', 'claim', 'pce', 'extremality'], description: 'Scores golden ratio claims using 10-observable protocol' },
      { name: 'neuralforge_create', intents: ['create'], domain: 'development', keywords: ['neural', 'network', 'cnn', 'model', 'create', 'architecture'], description: 'Create neural network from natural language' },
      { name: 'gmail-plugin', intents: ['search', 'create'], domain: 'communication', keywords: ['email', 'gmail', 'send', 'inbox', 'message'], description: 'Send and receive Gmail messages' },
      { name: 'github-plugin', intents: ['create', 'search', 'configure'], domain: 'development', keywords: ['github', 'repository', 'commit', 'push', 'pull', 'issue', 'pr'], description: 'GitHub operations: repos, commits, PRs, issues' },
      { name: 'discord-plugin', intents: ['create'], domain: 'communication', keywords: ['discord', 'message', 'channel', 'server', 'send'], description: 'Send messages and manage Discord servers' },
      { name: 'ecosystem-status', intents: ['monitor', 'analyze'], domain: 'system', keywords: ['ecosystem', 'status', 'telemetry', 'plugins', 'tools'], description: 'Full ecosystem status overview' },
      { name: 'cold-storage-sync', intents: ['monitor', 'configure'], domain: 'system', keywords: ['cold', 'storage', 'backup', 'sync', 'drift'], description: 'Syncs between dev plugins and cold storage' }
    ]
  };
}

// ─── CAPABILITY INDEX BUILDER ───────────────────────────────────────────────

function buildCapabilityIndex(pluginDirs) {
  const index = { tools: [], generated: new Date().toISOString(), version: '1.0.0' };
  const seen = new Set();
  
  // Scan plugin directories
  for (const dir of pluginDirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    
    for (const entry of entries) {
      const manifestPath = path.join(dir, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const tools = manifest.tools || [];
        
        for (const tool of tools) {
          const toolId = `${entry.name}-${tool.type}`;
          if (seen.has(toolId)) continue;
          seen.add(toolId);
          
          index.tools.push({
            name: tool.type,
            plugin: entry.name,
            title: tool.schema?.title || tool.type,
            description: tool.schema?.description || '',
            category: tool.schema?.category || manifest.category || 'general',
            domain: inferDomain(entry.name, tool),
            intents: inferIntents(tool.schema?.description || '', tool.type),
            keywords: extractKeywords(tool.schema?.description || '', entry.name)
          });
        }
      } catch(e) {
        // Skip malformed manifests
      }
    }
  }
  
  // Always include native tools
  const fallback = buildFallbackIndex();
  for (const tool of fallback.tools) {
    if (!seen.has(tool.name)) {
      index.tools.push({ ...tool, plugin: 'native', category: tool.category || 'native' });
      seen.add(tool.name);
    }
  }
  
  return index;
}

function inferDomain(pluginName, tool) {
  const name = (pluginName + ' ' + (tool.schema?.description || '')).toLowerCase();
  if (name.match(/bitcoin|ethereum|credit|wallet|finance|bank/)) return 'finance';
  if (name.match(/github|git|code|build|deploy|ci|neural/)) return 'development';
  if (name.match(/health|monitor|scm|ecosystem|workflow|schedule/)) return 'system';
  if (name.match(/search|query|data|analyze|index|corpus/)) return 'data';
  if (name.match(/discord|slack|email|telegram|message|notify/)) return 'communication';
  if (name.match(/chemistry|phi|math|validate/)) return 'science';
  return 'general';
}

function inferIntents(description, toolType) {
  const text = (description + ' ' + toolType).toLowerCase();
  const intents = [];
  if (text.match(/check|status|monitor|health|watch|track/)) intents.push('monitor');
  if (text.match(/create|build|make|generate/)) intents.push('create');
  if (text.match(/search|find|locate|query|fetch/)) intents.push('search');
  if (text.match(/analyze|evaluate|assess|examine|review/)) intents.push('analyze');
  if (text.match(/fix|repair|resolve|debug|heal/)) intents.push('fix');
  if (text.match(/deploy|release|publish|push|ship/)) intents.push('deploy');
  if (text.match(/configure|setup|update|modify|set/)) intents.push('configure');
  if (intents.length === 0) intents.push('general');
  return intents;
}

function extractKeywords(...texts) {
  const combined = texts.join(' ').toLowerCase();
  const words = combined.split(/[\s\-_,.()[\]{}]+/).filter(w => w.length > 3);
  const unique = [...new Set(words)];
  return unique.slice(0, 15);
}

// ─── SELECTION LOGGER ────────────────────────────────────────────────────────

function logSelection(selection, intent) {
  try {
    let log = [];
    try { log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch(e) {}
    
    log.push({
      timestamp: new Date().toISOString(),
      intent: intent.primaryIntent,
      domain: intent.primaryDomain,
      message: intent.raw.substring(0, 120),
      selected: selection.selected.map(s => s.tool),
      tokenEstimate: selection.metadata.tokenEstimate
    });
    
    // Keep last 200 entries
    if (log.length > 200) log = log.slice(-200);
    
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  } catch(e) {
    // Non-critical — don't break the pipeline
  }
}

// ─── MAIN PIPELINE ───────────────────────────────────────────────────────────

function runCodec(message, options = {}) {
  const config = loadConfig();
  const index = options.index || loadIndex();
  const history = options.history || [];
  
  // Encode
  const intent = encodeIntent(message, config);
  
  // Select
  const selected = selectTools(intent, index.tools || [], config, history);
  
  // Decode
  const result = decodeSelection(selected, config);
  
  // Log
  if (config.logSelections !== false) {
    logSelection(result, intent);
  }
  
  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    console.log('AGNT Tool Codec v1.0.0');
    console.log('');
    console.log('Usage:');
    console.log('  node tool-codec.js --query "check system health"');
    console.log('  node tool-codec.js --query "build a neural network"');
    console.log('  node tool-codec.js --query "analyze plugin builds"');
    console.log('  node tool-codec.js --scan ../agnt-evo/backend/plugins/dev/');
    console.log('  node tool-codec.js --install');
    console.log('  node tool-codec.js --test');
    process.exit(0);
  }
  
  if (args.includes('--test')) {
    const testCases = [
      { q: 'check system health', expect: 'scm-check-health' },
      { q: 'monitor credit usage', expect: 'credit-burn-guard' },
      { q: 'build a CNN model', expect: 'neuralforge_create' },
      { q: 'validate phi selection claim', expect: 'pce-v3.5-validator' },
      { q: 'analyze test results', expect: 'execute_javascript' },
      { q: 'find dead workflows', expect: 'self-healing' },
      { q: 'compare plugin builds', expect: 'plugin-health' },
      { q: 'search for AI news', expect: 'web_search' },
      { q: 'detect drift in system state', expect: 'ecosystem-drift' },
      { q: 'send a github PR', expect: 'github-plugin' },
    ];
    
    console.log('=== TOOL CODEC TEST SUITE ===\n');
    let passed = 0;
    
    for (const tc of testCases) {
      const result = runCodec(tc.q);
      const topTool = result.selected[0]?.tool || 'none';
      const inSelection = result.selected.some(s => s.tool === tc.expect);
      const status = inSelection ? '✅' : '❌';
      if (inSelection) passed++;
      
      console.log(status + ' Query: "' + tc.q + '"');
      console.log('   Top: ' + topTool + ' (' + (result.selected[0]?.confidence || 0) + ')');
      console.log('   Selection: ' + result.selected.map(s => s.tool).join(', '));
      console.log('   Tokens: ' + result.metadata.tokenEstimate);
      console.log('');
    }
    
    console.log('=== RESULT: ' + passed + '/' + testCases.length + ' passed ===');
    process.exit(passed === testCases.length ? 0 : 1);
  }
  
  if (args.includes('--install')) {
    console.log('Building capability index...');
    const pluginDirs = ['C:\\Users\\jacks\\OneDrive\\Desktop\\agnt-evo\\backend\\plugins\\dev'];
    const index = buildCapabilityIndex(pluginDirs);
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
    console.log('Capability index built: ' + index.tools.length + ' tools indexed');
    console.log('Installing as AGNT custom tool...');
    console.log('✅ Run the SQL INSERT to register this as a custom tool in AGNT');
    process.exit(0);
  }
  
  if (args.includes('--scan')) {
    const idx = args.indexOf('--scan');
    const dirs = args.slice(idx + 1).filter(a => !a.startsWith('--'));
    if (dirs.length === 0) dirs.push('C:\\Users\\jacks\\OneDrive\\Desktop\\agnt-evo\\backend\\plugins\\dev');
    const index = buildCapabilityIndex(dirs);
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
    console.log('✅ Capability index built: ' + index.tools.length + ' tools from ' + dirs.length + ' directories');
    console.log('Saved to: ' + INDEX_PATH);
    process.exit(0);
  }
  
  // Query mode
  const qIdx = args.indexOf('--query');
  if (qIdx !== -1) {
    const query = args.slice(qIdx + 1).join(' ');
    if (!query) { console.log('Usage: node tool-codec.js --query "your message"'); process.exit(1); }
    
    const result = runCodec(query);
    console.log('=== TOOL CODEC RESULT ===\n');
    console.log('Query:', query);
    console.log('Selected tools (' + result.selected.length + '):');
    result.selected.forEach((s, i) => {
      console.log('  ' + (i+1) + '. ' + s.tool + ' (confidence: ' + s.confidence + ')');
      console.log('     Rationale: ' + s.rationale);
    });
    if (result.fallbacks && result.fallbacks.length > 0) {
      console.log('Fallbacks:', result.fallbacks.join(', '));
    }
    console.log('Token estimate:', result.metadata.tokenEstimate);
    console.log('Within budget:', result.metadata.withinBudget);
    process.exit(0);
  }
  
  console.log('Usage: node tool-codec.js --query "help" | --test | --scan | --install | --help');
  process.exit(1);
}

export { runCodec, buildCapabilityIndex, encodeIntent, selectTools, decodeSelection };
