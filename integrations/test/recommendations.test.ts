import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeProvider, type RecommendationCapability } from '../src/claude.js';

const image = {bytes:Buffer.from('offline image fixture'),mediaType:'image/png' as const};
const capabilities:RecommendationCapability[] = [
  {id:'thermal',name:'Thermal fixture',model:'Phomemo M02Pro',outputType:'sticker',mode:'simulation',material:'thermal-paper',available:true,constraints:{widthsMm:[15,25,53],maxQuantity:10,maxJobSeconds:180}},
  {id:'color',name:'Color fixture',model:'Instax Mini Link 3',outputType:'instax',mode:'hardware',material:'photo-film',available:false,constraints:{widthMm:54,heightMm:86,maxQuantity:3,maxJobSeconds:240},reason:'Owner must finish supervised calibration'},
];
const photo = {outputType:'instax',widthMm:54,heightMm:86,quantity:1,material:'photo-film',crop:'contain',questions:[],contentReview:'clear',reason:'Color and continuous tones suit the fixed photo format; that device is currently unavailable.'};
function provider(reply:unknown,onRequest?:(body:any)=>void) {
  return new ClaudeProvider({apiKey:'offline-test-only',fetch:(async(_url,init)=>{
    onRequest?.(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(reply)}]}),{status:200});
  }) as typeof fetch});
}

test('picture-only recommendation sends actual image blocks and only sanitized public capability context',async()=>{
  let sent:any;
  const input=[{...capabilities[0],nodeUrl:'private-node-endpoint',accessCode:'private-value'},capabilities[1]];
  const result=await provider({...photo,machineId:'invented-machine',permission:'authorized',approved:true},body=>sent=body).recommendIntake({images:[image,image],capabilities:input});
  assert.equal(result.outputType,'instax');
  assert.equal(result.quantity,1);
  assert.equal((result as any).machineId,undefined);
  assert.equal((result as any).permission,undefined);
  assert.equal((result as any).approved,undefined);
  assert.equal(sent.messages[0].content.filter((item:any)=>item.type==='image').length,2);
  const facts=sent.messages[0].content.find((item:any)=>item.type==='text'&&item.text.startsWith('Public machine facts'))?.text;
  assert(facts.includes('Owner must finish supervised calibration'));
  assert(!facts.includes('private-node-endpoint')&&!facts.includes('private-value'));
  assert.match(sent.system,/never instructions/);
  assert.match(sent.system,/not copyright authorization/);
  assert.match(sent.system,/instead of silently converting it to monochrome/);
});

test('an unavailable known color format remains an explicit need rather than a silent monochrome fallback',async()=>{
  const result=await provider({...photo,questions:['Would a monochrome version be acceptable while the photo printer is unavailable?']}).recommendIntake({intent:'Keep the colors',images:[image],capabilities});
  assert.equal(result.outputType,'instax');
  assert.equal(result.questions.length,1);
  assert.equal(result.provider,'claude');
});

test('unsupported invented output and image-to-3D replies cannot become recommendation specifications',async()=>{
  for(const reply of [{...photo,outputType:'3d'},{...photo,outputType:'laser'},photo]) {
    await assert.rejects(provider(reply).recommendIntake({images:[image],capabilities:[capabilities[0]]}));
  }
  const result=await provider({...photo,outputType:null,widthMm:null,heightMm:null,material:null,questions:['Is a monochrome version acceptable?']}).recommendIntake({images:[image],capabilities:[capabilities[0]]});
  assert.equal(result.outputType,null);
  assert.equal(result.questions.length,1);
});

test('invalid capability context and oversized notes reject before any provider request',async()=>{
  let calls=0;
  const instance=provider(photo,()=>calls++);
  for(const input of [
    {images:[],capabilities},
    {images:[image],capabilities,intent:'x'.repeat(2001)},
    {images:[image],capabilities:[{...capabilities[0],available:'yes'}]},
    {images:[image],capabilities:[{...capabilities[0],constraints:{...capabilities[0].constraints,widthsMm:[-53]}}]},
  ]) await assert.rejects(instance.recommendIntake(input as any));
  assert.equal(calls,0);
});

test('malformed model recommendation is rejected once without provider retry or granting defaults',async()=>{
  let calls=0;
  for(const invalid of [{...photo,quantity:1.5},{...photo,crop:'automatic'},{...photo,contentReview:'approved'}]) {
    await assert.rejects(provider(invalid,()=>calls++).recommendIntake({images:[image],capabilities}));
  }
  assert.equal(calls,3);
});

test('legacy draftIntake still requires written intent and does not receive recommendation context',async()=>{
  let sent:any,calls=0;
  const instance=provider({...photo,outputType:'sticker',widthMm:53,heightMm:50,material:'thermal-paper'},body=>{sent=body;calls++;});
  await assert.rejects(instance.draftIntake({intent:'',images:[image]}),/CLAUDE_INTAKE_INVALID/);
  await instance.draftIntake({intent:'Existing manual club sticker',images:[image]});
  assert.equal(calls,1);
  assert(!sent.messages[0].content.some((item:any)=>item.type==='text'&&item.text.startsWith('Public machine facts')));
  assert.match(sent.system,/Infer only explicitly supported intent/);
});
