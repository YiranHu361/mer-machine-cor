import { readFileSync } from 'node:fs';
import { createClaudeProvider, type ClaudeImage } from '../src/claude.js';
const needed=['FABRARY_RUN_LIVE_CLAUDE','ANTHROPIC_API_KEY','FABRARY_CLAUDE_ARTIFACT_PATH','FABRARY_CLAUDE_RESULT_PATH','FABRARY_CLAUDE_CAPTURED_AT'];
const missing=needed.filter(key=>!process.env[key]);
if(missing.length||process.env.FABRARY_RUN_LIVE_CLAUDE!=='1'||process.env.FABRARY_CLAUDE_COMPLETION_CREDIBLE!=='1'){
 console.log(JSON.stringify({status:'BLOCKED',integration:'Claude actual image intake + fresh output verification',missing,reason:'Explicit opt-in, API key, real approved artwork and fresh result frame, timestamp and credible completion assertion are required. No API call made.'}));process.exit(2);
}
function image(path:string):ClaudeImage {
 const mediaType=path.toLowerCase().endsWith('.png')?'image/png':path.toLowerCase().endsWith('.webp')?'image/webp':'image/jpeg';
 return {bytes:readFileSync(path),mediaType};
}
const provider=createClaudeProvider();
const approved=image(process.env.FABRARY_CLAUDE_ARTIFACT_PATH!);
const draft=await provider.draftIntake({intent:'Propose a specification for this authorized club artwork as a 53 by 50 mm thermal sticker, quantity one. Ask about any unresolved essentials.',images:[approved]});
const verification=await provider.verifyOutput({approvedArtifact:approved,resultFrame:image(process.env.FABRARY_CLAUDE_RESULT_PATH!),capturedAt:process.env.FABRARY_CLAUDE_CAPTURED_AT!,completionCredible:true,jobId:'live-claude-check',machineId:'operator-asserted-machine',expected:{outputType:'sticker',widthMm:53,heightMm:50}});
console.log(JSON.stringify({status:'OBSERVED',model:provider.model,draft,verification,scope:'API exercised; output truth still depends on supplied capture and completion evidence'}));
