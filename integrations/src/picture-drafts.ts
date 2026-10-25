// Shared by the picture providers (OpenAI, Nano Banana): what a round asks for,
// how each draft is prompted, and the check every returned file must pass.
export interface ImageDraftInput { subject:string; count:number; previousTitles:string[]; colour:boolean }
export interface ImageDraft { title:string; image:{bytes:Uint8Array;mediaType:'image/png'|'image/jpeg'|'image/webp'} }
export const MAX_IMAGE_BYTES=8*1024*1024;
// Each draft in a round gets its own look, so the requester has a real choice.
const LOOKS={
  mono:[['Bold outline','thick, even black outlines with a few simple inner lines'],['Chunky silhouette','a solid black silhouette with white cut-out details'],['Playful doodle','a friendly hand-drawn doodle with rounded black strokes']],
  colour:[['Flat colour','a flat-colour illustration with clean shapes'],['Watercolour','a soft watercolour illustration'],['Bold cartoon','a bright cartoon illustration with dark outlines']],
} as const;
/** Sniffed from the bytes, never taken from the response's own label. */
export function imageType(bytes:Uint8Array):ImageDraft['image']['mediaType']|null {
  const b=bytes;
  if(b.length>8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47)return 'image/png';
  if(b.length>3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
  if(b.length>12&&String.fromCharCode(...b.subarray(0,4))==='RIFF'&&String.fromCharCode(...b.subarray(8,12))==='WEBP')return 'image/webp';
  return null;
}
/** Base64 from a provider -> checked image bytes, or an error named for that provider. */
export function checkedImage(encoded:unknown,provider:string):ImageDraft['image'] {
  if(typeof encoded!=='string'||!encoded)throw new Error(`${provider}_NO_IMAGE: the model returned no picture, possibly refused by its safety filter`);
  const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
  const mediaType=imageType(bytes);
  if(!mediaType||bytes.length>MAX_IMAGE_BYTES)throw new Error(`${provider}_IMAGE_INVALID: not a PNG, JPEG or WebP up to 8 MiB`);
  return {bytes,mediaType};
}
export function draftPrompt(subject:string,look:string,colour:boolean):string {
  return colour
    ? `Original artwork of ${JSON.stringify(subject)} for a small square photo print: ${look}, on a plain light background, centred with a margin. No text, letters, logos, brands, watermarks or known characters; draw an original design.`
    : `Original sticker artwork of ${JSON.stringify(subject)} for a black-and-white thermal sticker printer: ${look}, pure black on a pure white background, high contrast, no grey, no shading, no colour, no tiny details, one closed shape centred with a white margin. No text, letters, logos, brands, watermarks or known characters; draw an original design.`;
}
/** One picture per look, drawn in parallel; a round fails only when every picture fails. */
export async function draftPictures(input:ImageDraftInput,draw:(prompt:string)=>Promise<ImageDraft['image']>,provider:string):Promise<ImageDraft[]> {
  if(!input.subject.trim()||input.subject.length>40||input.count<1||input.count>3)throw new Error(`${provider}_DRAFT_INVALID`);
  const looks=LOOKS[input.colour?'colour':'mono'];
  // A later round starts after the looks already offered, so drafts differ.
  const offset=input.previousTitles.length;
  const chosen=Array.from({length:input.count},(_,i)=>looks[(offset+i)%looks.length]);
  const settled=await Promise.allSettled(chosen.map(([,look])=>draw(draftPrompt(input.subject,look,input.colour))));
  const drafts=settled.flatMap((r,i)=>r.status==='fulfilled'?[{title:`${input.subject} · ${chosen[i][0]}`.slice(0,60),image:r.value}]:[]);
  if(!drafts.length)throw (settled.find(r=>r.status==='rejected') as PromiseRejectedResult).reason;
  return drafts;
}
