import test from 'node:test';
import assert from 'node:assert/strict';
import { NanoBananaProvider, parseInteractionImage, imageType, DEFAULT_NANO_BANANA_MODEL } from '../src/nano-banana.js';
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('fake png body')]);
const interaction=(bytes:Buffer)=>({id:'int_1',object:'interaction',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Here you go'},{type:'image',mime_type:'image/png',data:bytes.toString('base64')}]}]});
const ok=(body:unknown)=>new Response(JSON.stringify(body),{status:200});

test('one Interactions call per draft, with the key in a header and the subject quoted as data',async()=>{
 const calls:{url:string;headers:Record<string,string>;body:any}[]=[];
 const provider=new NanoBananaProvider({apiKey:'unit-test-only',fetch:(async(url,init)=>{calls.push({url:String(url),headers:init?.headers as Record<string,string>,body:JSON.parse(String(init?.body))});return ok(interaction(png));}) as typeof fetch});
 const drafts=await provider.draftImages({subject:'cat',count:3,previousTitles:[],colour:false});
 assert.equal(drafts.length,3);
 assert.equal(calls.length,3);
 assert.equal(calls[0].url,'https://generativelanguage.googleapis.com/v1beta/interactions');
 assert.equal(calls[0].headers['x-goog-api-key'],'unit-test-only');
 assert.equal(calls[0].body.model,DEFAULT_NANO_BANANA_MODEL);
 assert.match(calls[0].body.input[0].text,/"cat".*pure black on a pure white background/);
 assert.equal(new Set(drafts.map(d=>d.title)).size,3,'each draft has its own look');
 assert.deepEqual(Buffer.from(drafts[0].image.bytes),png);
 assert.equal(drafts[0].image.mediaType,'image/png');
});

test('a photo print asks for colour, and a later round moves on to other looks',async()=>{
 const prompts:string[]=[];
 const provider=new NanoBananaProvider({apiKey:'unit-test-only',fetch:(async(_url,init)=>{prompts.push(JSON.parse(String(init?.body)).input[0].text);return ok(interaction(png));}) as typeof fetch});
 const first=await provider.draftImages({subject:'dog',count:1,previousTitles:[],colour:true});
 const second=await provider.draftImages({subject:'dog',count:1,previousTitles:[first[0].title],colour:true});
 assert.doesNotMatch(prompts[0],/no colour/);
 assert.notEqual(first[0].title,second[0].title);
});

test('the returned file must really be an image; its own label is not trusted',()=>{
 assert.equal(imageType(png),'image/png');
 assert.equal(imageType(Buffer.from([0xff,0xd8,0xff,0xe0])),'image/jpeg');
 assert.throws(()=>parseInteractionImage(interaction(Buffer.from('<svg onload="x()"></svg>'))),/NANO_BANANA_IMAGE_INVALID/);
 assert.throws(()=>parseInteractionImage({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'I cannot draw that'}]}]}),/NANO_BANANA_NO_IMAGE/);
 assert.throws(()=>parseInteractionImage({status:'failed',steps:[]}),/NANO_BANANA_INCOMPLETE/);
});

test('one failed picture leaves the others; all failing reports the reason without the key',async()=>{
 let n=0;
 const some=new NanoBananaProvider({apiKey:'unit-test-only',fetch:(async()=>++n===2?new Response('{}',{status:500}):ok(interaction(png))) as typeof fetch});
 assert.equal((await some.draftImages({subject:'cat',count:3,previousTitles:[],colour:false})).length,2);
 const none=new NanoBananaProvider({apiKey:'secret-key-value',fetch:(async()=>new Response(JSON.stringify({error:{message:'API key not valid'}}),{status:400})) as typeof fetch});
 await assert.rejects(none.draftImages({subject:'cat',count:2,previousTitles:[],colour:false}),(e:Error)=>/HTTP 400: API key not valid/.test(e.message)&&!e.message.includes('secret-key-value'));
});

test('missing key and bad input are refused before any call',async()=>{
 assert.throws(()=>new NanoBananaProvider({apiKey:''}),/GEMINI_API_KEY/);
 const provider=new NanoBananaProvider({apiKey:'unit-test-only',fetch:(async()=>{throw new Error('must not call');}) as typeof fetch});
 await assert.rejects(provider.draftImages({subject:' ',count:1,previousTitles:[],colour:false}),/NANO_BANANA_DRAFT_INVALID/);
 await assert.rejects(provider.draftImages({subject:'cat',count:4,previousTitles:[],colour:false}),/NANO_BANANA_DRAFT_INVALID/);
});
