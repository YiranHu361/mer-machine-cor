// OpenAI's Image API draws design drafts as pictures, the same way Nano Banana
// does: black-and-white line art for stickers, colour for photo prints. One
// picture per call; deterministic code checks every returned file.
import { checkedImage, draftPictures, type ImageDraft, type ImageDraftInput } from './picture-drafts.js';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';
export class OpenAIImageProvider {
  readonly model:string;
  private readonly request:typeof fetch;
  constructor(private readonly options:{apiKey:string;model?:string;fetch?:typeof fetch;timeoutMs?:number}) {
    if(!options.apiKey)throw new Error('OPENAI_IMAGE_BLOCKED: OPENAI_API_KEY is missing');
    this.model=options.model||DEFAULT_OPENAI_IMAGE_MODEL;
    this.request=options.fetch??globalThis.fetch;
  }
  private async draw(prompt:string):Promise<ImageDraft['image']> {
    // Square, medium quality: plenty for a 48 mm sticker or an Instax print.
    const response=await this.request('https://api.openai.com/v1/images/generations',{method:'POST',headers:{authorization:`Bearer ${this.options.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:this.model,prompt,n:1,size:'1024x1024',quality:'medium',output_format:'png'}),signal:AbortSignal.timeout(this.options.timeoutMs??120_000)});
    if(!response.ok){
      const detail=await response.json().then((b:any)=>String(b?.error?.message??'').slice(0,200)).catch(()=> '');
      throw new Error(`OPENAI_IMAGE_REQUEST_FAILED: HTTP ${response.status}${detail?`: ${detail}`:''}; check OPENAI_API_KEY, billing and organization verification`);
    }
    const data=await response.json() as {data?:{b64_json?:unknown}[]};
    return checkedImage(data?.data?.[0]?.b64_json,'OPENAI_IMAGE');
  }
  draftImages(input:ImageDraftInput):Promise<ImageDraft[]> {
    return draftPictures(input,prompt=>this.draw(prompt),'OPENAI_IMAGE');
  }
}
export function createOpenAIImageProvider(env:NodeJS.ProcessEnv=process.env):OpenAIImageProvider {
  return new OpenAIImageProvider({apiKey:env.OPENAI_API_KEY??'',model:env.FABYN_OPENAI_IMAGE_MODEL});
}
