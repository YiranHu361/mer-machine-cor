// Nano Banana (Gemini image models) draws design drafts as pictures: bold
// black-and-white line art for stickers, a colour illustration for photo prints.
// One picture per call through the Interactions API; deterministic code checks
// every returned file before it is stored or printed.
import { checkedImage, draftPictures, type ImageDraft, type ImageDraftInput } from './picture-drafts.js';
export { imageType, draftPrompt, type ImageDraft, type ImageDraftInput } from './picture-drafts.js';
export const DEFAULT_NANO_BANANA_MODEL = 'gemini-nano-banana-2.1';
/** The first generated image in an Interaction response. */
export function parseInteractionImage(data:unknown):ImageDraft['image'] {
  const d=data as {status?:string;steps?:{type?:string;content?:{type?:string;data?:unknown}[]}[];output_image?:{data?:unknown}};
  if(d?.status&&d.status!=='completed')throw new Error(`NANO_BANANA_INCOMPLETE: ${d.status}`);
  const blocks=(d?.steps??[]).filter(s=>s?.type==='model_output').flatMap(s=>Array.isArray(s.content)?s.content:[]);
  return checkedImage(blocks.find(b=>b?.type==='image'&&typeof b.data==='string')?.data??d?.output_image?.data,'NANO_BANANA');
}
export class NanoBananaProvider {
  readonly model:string;
  private readonly request:typeof fetch;
  constructor(private readonly options:{apiKey:string;model?:string;fetch?:typeof fetch;timeoutMs?:number}) {
    if(!options.apiKey)throw new Error('NANO_BANANA_BLOCKED: GEMINI_API_KEY is missing');
    this.model=options.model||DEFAULT_NANO_BANANA_MODEL;
    this.request=options.fetch??globalThis.fetch;
  }
  private async draw(prompt:string):Promise<ImageDraft['image']> {
    const response=await this.request('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':this.options.apiKey,'content-type':'application/json'},body:JSON.stringify({model:this.model,input:[{type:'text',text:prompt}]}),signal:AbortSignal.timeout(this.options.timeoutMs??90_000)});
    if(!response.ok){
      const detail=await response.json().then((b:any)=>String(b?.error?.message??'').slice(0,200)).catch(()=> '');
      throw new Error(`NANO_BANANA_REQUEST_FAILED: HTTP ${response.status}${detail?`: ${detail}`:''}; check GEMINI_API_KEY, model access and billing`);
    }
    return parseInteractionImage(await response.json());
  }
  draftImages(input:ImageDraftInput):Promise<ImageDraft[]> {
    return draftPictures(input,prompt=>this.draw(prompt),'NANO_BANANA');
  }
}
export function createNanoBananaProvider(env:NodeJS.ProcessEnv=process.env):NanoBananaProvider {
  return new NanoBananaProvider({apiKey:env.GEMINI_API_KEY??'',model:env.FABRARY_NANO_BANANA_MODEL});
}
