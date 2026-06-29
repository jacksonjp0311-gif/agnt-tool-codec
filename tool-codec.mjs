#!/usr/bin/env node
// AGNT Tool Codec v1.0.0 — Intent-based dynamic tool selection
// Usage: node tool-codec.mjs "check system health"

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(__dirname, 'capability-index.json'), 'utf8'));

const STOPWORDS = new Set(['the','a','an','is','are','was','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','need','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','each','every','both','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','but','and','or','if','while','about','up','that','this','these','those','what','which','who','whom','its','our','also','want','like','make','know','time','come','back','much','show','tell','give','run']);

function encode(message) {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const rawWords = lower.split(/\s+/).filter(w => w.length > 2);
  
  let primaryIntent = 'general', intentScore = 0;
  for (const [intent, keywords] of Object.entries(config.intentPatterns)) {
    const mc = keywords.filter(k => lower.includes(k)).length;
    if (mc > intentScore) { intentScore = mc; primaryIntent = intent; }
  }

  const firstWord = rawWords[0];
  for (const [intent, keywords] of Object.entries(config.intentPatterns)) {
    if (keywords.includes(firstWord)) {
      primaryIntent = intent;
      break;
    }
  }
  
  let primaryDomain = 'general', domainScore = 0;
  for (const [domain, keywords] of Object.entries(config.domains)) {
    const mc = keywords.filter(k => lower.includes(k)).length;
    if (mc > domainScore) { domainScore = mc; primaryDomain = domain; }
  }

  if (
    rawWords.some(w => ['plugin', 'plugins'].includes(w)) &&
    ['create', 'deploy', 'configure'].includes(primaryIntent)
  ) {
    primaryDomain = 'development';
  }
  
  return { primaryIntent, primaryDomain, keywords: words, rawKeywords: rawWords, raw: message };
}

function score(intent, tools) {
  const results = [];
  
  for (const tool of tools) {
    let score = 0;
    const rationale = [];
    
    const overlap = intent.keywords.filter(k => (tool.keywords || []).includes(k));
    if (overlap.length > 0) {
      score += (overlap.length / Math.max(intent.keywords.length, 1)) * 0.5;
      overlap.slice(0, 3).forEach(k => rationale.push('kw:' + k));
    }
    
    // Also match against raw keywords (includes domain words)
    const rawOverlap = intent.rawKeywords.filter(k => (tool.keywords || []).includes(k));
    if (rawOverlap.length > overlap.length) {
      const bonus = (rawOverlap.length - overlap.length) * 0.1;
      score += bonus;
    }
    
    if (tool.domain === intent.primaryDomain && intent.primaryDomain !== 'general') {
      score += 0.15;
      rationale.push('dom:' + intent.primaryDomain);
    }
    
    if (tool.intents?.includes(intent.primaryIntent) && intent.primaryIntent !== 'general') {
      score += 0.2;
      rationale.push('int:' + intent.primaryIntent);
    }
    
    if (tool.description) {
      const dw = tool.description.toLowerCase().split(/[\s\-_,.()[\]{}]+/);
      const dO = intent.rawKeywords.filter(k => dw.includes(k));
      if (dO.length > 0) {
        score += (dO.length / dw.length) * 0.3;
      }
    }
    
    if (tool.title) {
      const tw = tool.title.toLowerCase().split(/[\s\-_,.()[\]{}]+/);
      const tO = intent.rawKeywords.filter(k => tw.includes(k));
      if (tO.length > 0) {
        score += 0.1 * tO.length;
        rationale.push('title:' + tO[0]);
      }
    }
    
    score = Math.min(score, 1.0);
    
    if (score >= 0.15) {
      results.push({ tool: tool.name, score: parseFloat(score.toFixed(3)), rationale: rationale.slice(0, 4), domain: tool.domain });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, config.maxTools || 8);
}

function decode(selected) {
  return {
    selected: selected.map(s => ({ tool: s.tool, confidence: s.score, rationale: s.rationale.join(', '), domain: s.domain })),
    metadata: { totalSelected: selected.length, tokenEstimate: selected.length * 1200, budget: config.tokenBudget || 8700, withinBudget: selected.length <= 7 },
    fallbacks: (config.fallbackTools || ['execute-javascript-code','web-search','file-operations']).filter(f => !selected.find(s => s.tool === f)).slice(0, 3)
  };
}

function runCodec(msg) { return decode(score(encode(msg), index.tools)); }

const query = process.argv.slice(2).join(' ');
if (query) {
  console.log(JSON.stringify(runCodec(query), null, 2));
} else {
  const tests = [
    ['check system health', ['ecosystem-status','agnt-workflows']],
    ['monitor credit usage', ['agnt-workflows','bankr-fee-monitor']],
    ['build a CNN', ['neuralforge-create']],
    ['validate phi claim', ['pce-v3.5-validator','fibonacci-sequence']],
    ['find unused plugins', ['ecosystem-status','agnt-tools']],
    ['search AI news', ['web-search']],
    ['analyze plugin coverage', ['ecosystem-status']],
    ['fix broken workflows', ['agnt-workflows']],
    ['push to github', ['github-plugin']],
    ['detect drift', ['cold-storage-sync','emergence-detect']],
    ['show active workflows', ['agnt-workflows']],
    ['bitcoin price', ['get-bitcoin-price']],
    ['send discord message', ['discord-api']],
    ['chemical synthesis', ['chemiframe-synthesize']],
    ['create monitoring plugin', ['agnt-tools','agnt-workflows']],
  ];
  
  let passed = 0;
  tests.forEach(([q, expected]) => {
    const r = runCodec(q);
    const names = r.selected.map(s => s.tool);
    const found = expected.filter(e => names.some(n => n.includes(e) || e.includes(n)));
    const ok = found.length >= Math.ceil(expected.length * 0.5);
    if (ok) passed++;
    console.log((ok?'✅':'⚠️') + ' "' + q + '" → [' + names.join(', ') + '] expected:' + expected.join(','));
  });
  console.log('\n' + passed + '/' + tests.length + ' passed');
}

export { runCodec, encode, score, decode };
