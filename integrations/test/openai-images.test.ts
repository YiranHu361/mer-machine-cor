import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIImageProvider, DEFAULT_OPENAI_IMAGE_MODEL } from '../src/openai-images.js';
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('fake png body')]);
const ok=(b64:string)=>new Response(JSON.stringify({created:1,data:[{b64_json:b64}]}),{status:200});

test('one Image API call per draft, key as a bearer token, square medium PNG',async()=>{
 const calls:{url:string;headers:Record<string,string>;body:any}[]=[];
 const provider=new OpenAIImageProvider({apiKey:'unit-test-only',fetch:(async(url,init)=>{calls.push({url:String(url),headers:init?.headers as Record<string,string>,body:JSON.parse(String(init?.body))});return ok(png.toString('base64'));}) as typeof fetch});
 const drafts=await provider.draftImages({subject:'cat',count:3,previousTitles:[],colour:false});
 assert.equal(drafts.length,3);
 assert.equal(calls[0].url,'https://api.openai.com/v1/images/generations');
 assert.equal(calls[0].headers.authorization,'Bearer unit-test-only');
 assert.deepEqual({model:calls[0].body.model,n:calls[0].body.n,size:calls[0].body.size,quality:calls[0].body.quality,output_format:calls[0].body.output_format},{model:DEFAULT_OPENAI_IMAGE_MODEL,n:1,size:'1024x1024',quality:'medium',output_format:'png'});
 assert.match(calls[0].body.prompt,/"cat".*pure black on a pure white background/);
 assert.deepEqual(Buffer.from(drafts[0].image.bytes),png);
 assert.equal(new Set(drafts.map(d=>d.title)).size,3);
});

test('a missing or fake picture is refused, and errors never carry the key',async()=>{
 const empty=new OpenAIImageProvider({apiKey:'unit-test-only',fetch:(async()=>new Response(JSON.stringify({data:[]}),{status:200})) as typeof fetch});
 await assert.rejects(empty.draftImages({subject:'cat',count:1,previousTitles:[],colour:true}),/OPENAI_IMAGE_NO_IMAGE/);
 const fake=new OpenAIImageProvider({apiKey:'unit-test-only',fetch:(async()=>ok(Buffer.from('<svg/>').toString('base64'))) as typeof fetch});
 await assert.rejects(fake.draftImages({subject:'cat',count:1,previousTitles:[],colour:true}),/OPENAI_IMAGE_IMAGE_INVALID/);
 const denied=new OpenAIImageProvider({apiKey:'sk-secret-value',fetch:(async()=>new Response(JSON.stringify({error:{message:'Your organization must be verified to use this model.'}}),{status:403})) as typeof fetch});
 await assert.rejects(denied.draftImages({subject:'cat',count:1,previousTitles:[],colour:false}),(e:Error)=>/HTTP 403: Your organization must be verified/.test(e.message)&&!e.message.includes('sk-secret-value'));
 assert.throws(()=>new OpenAIImageProvider({apiKey:''}),/OPENAI_API_KEY/);
});
