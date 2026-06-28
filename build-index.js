/**
 * AGNT Tool Codec — Capability Index Builder
 * 
 * Scans all plugin directories and builds a searchable capability manifest.
 * Run: node build-index.js [plugin-dir-1] [plugin-dir-2] ...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildCapabilityIndex(pluginDirs) {
  const index = { 
    tools: [], 
    generated: new Date().toISOString(), 
    version: '1.0.0',
    sources: pluginDirs
  };
  const seen = new Set();

  for (const dir of pluginDirs) {
    if (!fs.existsSync(dir)) {
      console.log('⚠️  Skipping non-existent dir:', dir);
      continue;
    }
    
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    console.log('📁 Scanning:', dir, '(' + entries.length + ' plugins)');
    
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
        console.log('  ⚠️  Skipping malformed manifest:', entry.name);
      }
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

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dirs = args.filter(a => !a.startsWith('--'));

if (dirs.length === 0) {
  // Default: scan AGNT plugins
  dirs.push('C:\\Users\\jacks\\OneDrive\\Desktop\\agnt-evo\\backend\\plugins\\dev');
}

console.log('=== AGNT Tool Codec — Capability Index Builder ===\n');

const index = buildCapabilityIndex(dirs);

const outputPath = path.join(__dirname, 'capability-index.json');
fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));

console.log('\n✅ Capability index built!');
console.log('   Tools indexed:', index.tools.length);
console.log('   Sources:', dirs.length);
console.log('   Output:', outputPath);

// Domain breakdown
const domains = {};
index.tools.forEach(t => { domains[t.domain] = (domains[t.domain] || 0) + 1; });
console.log('\n📊 Domain breakdown:');
Object.entries(domains).sort((a,b) => b[1] - a[1]).forEach(([d, c]) => {
  console.log('   ' + d + ': ' + c);
});
