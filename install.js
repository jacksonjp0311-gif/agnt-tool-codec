/**
 * AGNT Tool Codec — Install Script
 * 
 * Registers the codec as an AGNT custom tool by inserting into the SQLite DB.
 * Run: node install.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.AGNT_DB_PATH || path.join(
  process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming'),
  'AGNT', 'Data', 'agnt.db'
);

const TOOL_ID = 'tool-codec-' + Date.now().toString(36);

// The custom tool definition that AGNT will load
const toolDefinition = {
  id: TOOL_ID,
  base: 'AI',
  title: 'AGNT Tool Codec',
  category: 'custom',
  type: 'custom-tool-codec',
  icon: 'codec',
  description: 'Intent-based dynamic tool selection engine. Analyzes user message, scores all available tools by relevance, and returns a ranked shortlist of the best 5-8 tools for the task. Reduces context usage from ~77K to ~8.7K tokens per call.',
  parameters: {
    instructions: `You are the AGNT Tool Codec. Your job is to analyze the user's message and select the best tools for the task.

## INPUT
User Message: {{User Message}}
Available Tools: {{Available Tools List}}
Recent Tool History: {{Recent History}}

## PROCESS
1. ENCODE: Extract intent (monitor/create/search/analyze/fix/deploy/configure), domain (system/finance/development/data/communication/science), and keywords from the user message.
2. SCORE: For each available tool, compute relevance score based on:
   - Keyword overlap (0-0.5 weight)
   - Domain match (+0.15 boost)
   - Intent category match (+0.20 boost)
   - Description semantic match (0-0.3 weight)
   - History bias (+0.10 if recently used successfully)
3. SELECT: Return top 5-8 tools above 0.40 threshold, sorted by confidence.
4. DECODE: Format as clean shortlist with confidence scores and rationale.

## OUTPUT FORMAT
Return a JSON object:
{
  "selected": [
    {"tool": "tool-name", "confidence": 0.92, "rationale": "keyword:health, domain:system"}
  ],
  "metadata": {
    "totalSelected": 5,
    "tokenEstimate": 6000,
    "withinBudget": true
  },
  "fallbacks": ["execute-javascript-code", "web-search"]
}

## RULES
- Include matching tools above the configured threshold, currently 0.15
- Always include fallbacks that exist in the active runtime index.
- If no tools match above threshold, return top 3 by raw score
- Token budget is 8700 tokens (~7 tools at 1200 each)
- Be precise: only recommend tools that genuinely match the intent`
  },
  outputs: {
    result: { type: 'object', description: 'Ranked tool shortlist with confidence scores' }
  }
};

console.log('=== AGNT Tool Codec Installer ===\n');
console.log('DB Path:', DB_PATH);
console.log('Tool ID:', TOOL_ID);

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ AGNT database not found at:', DB_PATH);
  console.error('Set AGNT_DB_PATH env var to your agnt.db location');
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Check if tool-codec already exists
  db.get("SELECT id, title FROM tools WHERE title LIKE '%Codec%' OR title LIKE '%tool-codec%'", (err, existing) => {
    if (err) {
      console.error('❌ DB error:', err.message);
      db.close();
      process.exit(1);
    }
    
    if (existing) {
      console.log('⚠️  Tool Codec already installed:');
      console.log('   ID:', existing.id);
      console.log('   Title:', existing.title);
      console.log('\nTo reinstall, delete the existing row first:');
      console.log('   DELETE FROM tools WHERE id = "' + existing.id + '";');
      db.close();
      process.exit(0);
    }
    
    // Insert the custom tool
    db.run(
      `INSERT INTO tools (id, base, title, category, type, icon, description, parameters, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TOOL_ID,
        toolDefinition.base,
        toolDefinition.title,
        toolDefinition.category,
        toolDefinition.type,
        toolDefinition.icon,
        toolDefinition.description,
        JSON.stringify(toolDefinition.parameters),
        'system',
        new Date().toISOString(),
        new Date().toISOString()
      ],
      function(err) {
        if (err) {
          console.error('❌ Insert failed:', err.message);
          db.close();
          process.exit(1);
        }
        
        console.log('✅ AGNT Tool Codec installed successfully!');
        console.log('   Tool ID:', TOOL_ID);
        console.log('   Category: custom');
        console.log('   Type: custom-tool-codec');
        console.log('\n📋 Next steps:');
        console.log('   1. Restart AGNT to load the new tool');
        console.log('   2. The codec will appear in your custom tools list');
        console.log('   3. Test with: node tool-codec.js --test');
        console.log('\n📊 Build capability index:');
        console.log('   node tool-codec.js --scan ../agnt-evo/backend/plugins/dev/');
        
        db.close();
      }
    );
  });
});
