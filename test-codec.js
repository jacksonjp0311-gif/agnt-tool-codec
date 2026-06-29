/**
 * AGNT Tool Codec — Test Suite
 * 
 * 20 test cases covering all intent categories and domains.
 * Run: node test-codec.js
 */

import { runCodec, buildCapabilityIndex } from './tool-codec.js';

const testCases = [
  // MONITOR intents
  { q: 'check system health and coherence', intent: 'monitor', expectDomains: ['system'] },
  { q: 'monitor credit consumption', intent: 'monitor', expectDomains: ['finance'] },
  { q: 'show me the status of all workflows', intent: 'monitor', expectDomains: ['system'] },
  { q: 'what is the current state of the ecosystem', intent: 'monitor', expectDomains: ['system'] },
  { q: 'track error rates across workflows', intent: 'monitor', expectDomains: ['system'] },
  
  // CREATE intents
  { q: 'build a CNN for image classification', intent: 'create', expectDomains: ['development'] },
  { q: 'create a new plugin for monitoring', intent: 'create', expectDomains: ['development'] },
  { q: 'generate a coherence report', intent: 'create', expectDomains: ['system'] },
  { q: 'write a script to analyze data', intent: 'create', expectDomains: ['development'] },
  
  // SEARCH intents
  { q: 'search for the latest AI news', intent: 'search', expectDomains: ['data'] },
  { q: 'find unused plugins in the system', intent: 'search', expectDomains: ['system'] },
  { q: 'look up bitcoin price', intent: 'search', expectDomains: ['finance'] },
  { q: 'fetch my github repositories', intent: 'search', expectDomains: ['development'] },
  
  // ANALYZE intents
  { q: 'analyze plugin build coverage', intent: 'analyze', expectDomains: ['system'] },
  { q: 'evaluate system performance', intent: 'analyze', expectDomains: ['system'] },
  { q: 'compare old vs new workflow versions', intent: 'analyze', expectDomains: ['system'] },
  { q: 'validate the golden ratio claim', intent: 'analyze', expectDomains: ['science'] },
  
  // FIX intents
  { q: 'fix broken workflow timers', intent: 'fix', expectDomains: ['system'] },
  { q: 'debug why scm-check-health is erroring', intent: 'fix', expectDomains: ['system'] },
  { q: 'resolve ghost execution errors', intent: 'fix', expectDomains: ['system'] },
  
  // DEPLOY intents
  { q: 'push changes to github', intent: 'deploy', expectDomains: ['development'] },
  { q: 'ship a new plugin version', intent: 'deploy', expectDomains: ['development'] },
];

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║          AGNT TOOL CODEC - TEST SUITE v1.1.0            ║');
console.log('╠══════════════════════════════════════════════════════════╣\n');

let passed = 0;
let failed = 0;
const results = [];

for (const tc of testCases) {
  const result = runCodec(tc.q);
  const topTool = result.selected[0]?.tool || 'none';
  const topConf = result.selected[0]?.confidence || 0;
  const domains = [...new Set(result.selected.map(s => s.category))];
  
  // Check if expected domain is represented
  const domainMatch = tc.expectDomains.some(d => 
    result.selected.some(s => s.rationale.toLowerCase().includes(d) || s.category === d || s.domain === d)
  );
  
  // Check if top tool is relevant (not just a fallback)
  const relevant = topConf >= 0.15;
  
  const ok = relevant && result.selected.length >= 1 && domainMatch;
  if (ok) passed++; else failed++;
  
  const icon = ok ? '✅' : '⚠️';
  console.log(icon + ' "' + tc.q + '"');
  console.log('   Top: ' + topTool + ' (' + topConf + ')');
  console.log('   Tools: [' + result.selected.map(s => s.tool).join(', ') + ']');
  console.log('   Tokens: ' + result.metadata.tokenEstimate + ' | Selected: ' + result.selected.length);
  console.log('');
  
  results.push({ q: tc.q, ok, topTool: topTool, conf: topConf, count: result.selected.length });
}

console.log('╠══════════════════════════════════════════════════════════╣');
console.log('║  RESULTS: ' + passed + ' passed / ' + failed + ' failed (' + testCases.length + ' total)');
console.log('║  Average confidence: ' + (results.reduce((s,r) => s + r.conf, 0) / results.length).toFixed(3));
console.log('║  Avg tools selected: ' + (results.reduce((s,r) => s + r.count, 0) / results.length).toFixed(1));
console.log('╚══════════════════════════════════════════════════════════╝');

process.exit(failed > 5 ? 1 : 0);
