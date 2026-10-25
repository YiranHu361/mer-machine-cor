import { readFileSync } from 'node:fs';
import { createClaudeProvider, type ClaudeImage } from '../src/claude.js';
const needed=['FABYN_RUN_LIVE_CLAUDE','ANTHROPIC_API_KEY','FABYN_CLAUDE_ARTIFACT_PATH'];
const missing=needed.filter(key=>!process.env[key]);
if(missing.length||process.env.FABYN_RUN_LIVE_CLAUDE!=='1'){
 console.log(JSON.stringify({status:'BLOCKED',integration:'Claude image intake',missing,reason:'Explicit opt-in, API key, approved artwork are required. No API call made.'}));process.exit(2);
}
function image(path:string):ClaudeImage {
 const mediaType=path.toLowerCase().endsWith('.png')?'image/png':path.toLowerCase().endsWith('.webp')?'image/webp':'image/jpeg';
 return {bytes:readFileSync(path),mediaType};
}
const provider=createClaudeProvider();
const approved=image(process.env.FABYN_CLAUDE_ARTIFACT_PATH!);
const draft=await provider.draftIntake({intent:'Propose a specification for this authorized club artwork as a 53 by 50 mm thermal sticker, quantity one. Ask about any unresolved essentials.',images:[approved]});
console.log(JSON.stringify({status:'OBSERVED',model:provider.model,draft,scope:'Image intake API exercised'}));
