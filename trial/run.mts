// Throwaway phase 0 trial. Delete once a Nano Banana variant is chosen.
// Run from apps/api: pnpm exec tsx ../../trial/run.mts <PRINTED|FOOTBALL|VOLLEYBALL> <model>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFirstImagePrompt, printedTextBlock } from '../apps/api/src/design/prompt-builder.js';

const root = resolve(import.meta.dirname);
const key = readFileSync(resolve(root, '../.env'), 'utf8')
  .match(/^GEMINI_API_KEY=(.*)$/m)?.[1]
  .trim()
  .replace(/^["']|["']$/g, '');
if (!key) throw new Error('GEMINI_API_KEY is missing from .env');

const [type = 'FOOTBALL', model = 'gemini-2.5-flash-image'] = process.argv.slice(2);

const CASES: Record<string, any> = {
  FOOTBALL: {
    specs: spec('FOOTBALL', 'red', 'mesh'),
    answers: {
      team_name: 'FC Sài Gòn',
      pattern: 'vertical-stripes',
      collar: 'polo',
      has_logo: 'yes',
      logo_position: 'left-chest',
      logo_upload: ['logo'],
      sponsor: 'Ánh Dương',
      occasion: 'team',
      style: 'energetic',
      has_text: 'yes',
      text_content: 'Đoàn kết - Quyết thắng',
    },
    back: [
      { value: 'TUẤN', role: 'the player name, across the upper back' },
      { value: '10', role: 'the player number, very large, below the name' },
    ],
    logo: true,
  },
  PRINTED: {
    specs: spec('PRINTED', 'white', 'cotton'),
    answers: {
      main_image: 'Con hổ đang gầm',
      image_style: 'cartoon',
      print_placement: 'large-centre-chest',
      back_print: 'printed',
      occasion: 'group',
      style: 'bold',
      has_text: 'yes',
      text_content: 'Lớp 12A1 - Mãi bên nhau',
      colours_include: 'cam và đen',
    },
    back: [{ value: '12A1', role: 'small, centred below the collar, the only print on the back' }],
    logo: false,
  },
  VOLLEYBALL: {
    specs: spec('VOLLEYBALL', 'navy', 'cool-knit'),
    answers: {
      team_name: 'Bóng chuyền Hà Nội',
      sleeve: 'sleeveless',
      pattern: 'gradient',
      has_logo: 'yes',
      logo_position: 'centre-chest',
      logo_upload: ['logo'],
      number_position: 'both',
      sample_number: '7',
      occasion: 'team',
      style: 'classic',
      has_text: 'no',
    },
    back: [
      { value: 'LAN', role: 'the player name, across the upper back' },
      { value: '7', role: 'the player number, very large, below the name' },
    ],
    logo: true,
  },
};

function spec(shirtType: string, colour: string, material: string) {
  return {
    product: { id: 'x', name: 'x', shirtType },
    colour: { id: colour, name: colour, hex: '' },
    material: { id: material, name: material },
    size: 'L',
    quantity: 1,
  } as any;
}

const png = (path: string) => readFileSync(path).toString('base64');

async function generate(prompt: string, images: string[]) {
  const started = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key! },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              ...images.map((data) => ({ inline_data: { mime_type: 'image/png', data } })),
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
      }),
    },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.replaceAll(key!, '***').slice(0, 400)}`);
  const json = JSON.parse(body);
  const image = json.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
  if (!image) throw new Error(`No image: ${body.slice(0, 400)}`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s, ${json.usageMetadata?.totalTokenCount} tokens`);
  return image.inlineData.data as string;
}

const KEEP = 'Keep the product unchanged: the same shirt, colours, pattern, collar, fabric and design details. Same plain light grey background, shown alone with no person and no mannequin.';

const trial = CASES[type];
const out = resolve(root, 'output', `${type.toLowerCase()}-${model}`);
mkdirSync(out, { recursive: true });

const logo = trial.logo ? [png(resolve(root, 'logo.png'))] : [];
const front = buildFirstImagePrompt(trial.specs, trial.answers).prompt;
const back = `The attached image is the front of a shirt. Show the back of exactly this shirt, flat. ${KEEP}\n${printedTextBlock(trial.back).join('\n')}`;
const closeUp = trial.logo
  ? `The first attached image is a shirt. The second is its original logo. Show a close-up of the logo area on exactly this shirt, with the logo sharp and filling most of the frame, keeping the logo's exact shape and colours. ${KEEP}`
  : `The attached image is a shirt. Show a close-up of its main print, sharp and filling most of the frame. ${KEEP}`;
const copyText = ' Copy all text exactly as it appears on the shirt, with every Vietnamese accent mark.';

writeFileSync(resolve(out, 'prompts.txt'), `FRONT\n${front}\n\nBACK\n${back}\n\nCLOSE-UP\n${closeUp}\n`);

console.log(`${type} with ${model}\nfront`);
const frontImage = await generate(front, logo);
writeFileSync(resolve(out, 'front.png'), Buffer.from(frontImage, 'base64'));
console.log('back');
writeFileSync(resolve(out, 'back.png'), Buffer.from(await generate(back, [frontImage]), 'base64'));
console.log('close-up');
writeFileSync(resolve(out, 'closeup.png'), Buffer.from(await generate(closeUp + copyText, [frontImage, ...logo]), 'base64'));
console.log(`saved to ${out}`);
