import { ShirtType } from '../integrations/catalog/catalog.port.js';
import { Answers } from './answers.js';
import { SpecSnapshot } from './design-session.service.js';

// Prompts are English because image models follow it best. What the customer
// typed stays as typed: "quotes" for words to print, [brackets] for descriptions.
// Words to print also get a spelling line, because short words lose their accents.

const SHIRTS: Record<ShirtType, string> = {
  PRINTED: 'T-shirt',
  FOOTBALL: 'football jersey',
  VOLLEYBALL: 'volleyball jersey',
};

const MATERIALS: Record<string, string> = {
  cotton: '100% cotton',
  cvc: 'cotton blend',
  'cool-knit': 'smooth cool-touch knit',
  mesh: 'breathable sports mesh',
};

const OCCASIONS: Record<string, string> = {
  personal: 'personal wear',
  group: 'a group or class',
  team: 'a team',
  company: 'a company',
  event: 'an event',
  gift: 'a gift',
};

const STYLES: Record<string, string> = {
  minimal: 'minimal',
  energetic: 'energetic',
  bold: 'bold',
  cute: 'cute',
  classic: 'classic',
};

const IMAGE_STYLES: Record<string, string> = {
  cartoon: 'cartoon illustration',
  'hand-drawn': 'hand-drawn illustration',
  photo: 'photo-realistic image',
  'text-only': 'text-only typographic design, with no illustration',
};

const PLACEMENTS: Record<string, string> = {
  'large-centre-chest': 'large, in the centre of the chest',
  'small-left-chest': 'small, on the left chest',
};

const PATTERNS: Record<string, string> = {
  plain: 'a plain body with no pattern',
  'vertical-stripes': 'vertical stripes',
  'horizontal-stripes': 'horizontal stripes',
  'diagonal-stripes': 'diagonal stripes',
  gradient: 'a colour gradient',
};

const COLLARS: Record<string, string> = {
  round: 'round collar',
  'v-neck': 'V-neck collar',
  polo: 'polo collar',
};

const SLEEVES: Record<string, string> = {
  sleeveless: 'sleeveless',
  short: 'short sleeves',
};

const LOGO_POSITIONS: Record<string, string> = {
  'left-chest': 'on the left chest',
  'right-chest': 'on the right chest',
  'centre-chest': 'in the centre of the chest',
};

/** One piece of wording that must appear on the shirt. */
export interface PrintedText {
  value: string;
  /** What it is, how big and where, so the texts do not compete. */
  role: string;
}

export interface BuiltPrompt {
  prompt: string;
  /** Customer uploads to send to the image API along with the prompt. */
  referenceFileIds: string[];
}

const text = (answers: Answers, id: string) => {
  const value = answers[id];
  return typeof value === 'string' ? value : undefined;
};

const files = (answers: Answers, id: string) => {
  const value = answers[id];
  return Array.isArray(value) ? value : [];
};

const oneLine = (value: string) => value.replace(/\s+/g, ' ');

/** Words that appear on the shirt. They cannot close their own quotes. */
const quoted = (value: string) => `"${oneLine(value).replace(/"/g, "'")}"`;

/** Spelled out because image models drop Vietnamese accents from short words. */
const letters = (value: string) =>
  oneLine(value)
    .trim()
    .split(' ')
    .map((word) => [...word].join(' '))
    .join(' / ');

/** Lists every text with its spelling. Also used for the back view in phase 4. */
export function printedTextBlock(texts: PrintedText[]) {
  if (!texts.length) return [];
  return [
    'Print exactly these texts on the shirt, and no other words:',
    ...texts.flatMap(({ value, role }, index) => [
      `${index + 1}. ${quoted(value)}: ${role}.`,
      `   Spelling, letter by letter, with / between words: ${letters(value)}`,
    ]),
    'Copy each text letter by letter, with every Vietnamese accent mark. Do not change, add or drop any letter or accent.',
  ];
}

/** The customer's description, which must never be printed as words. */
const described = (value: string) => `[${oneLine(value).replace(/[[\]]/g, '')}]`;

function printedLines(a: Answers) {
  const main = text(a, 'main_image');
  const style = IMAGE_STYLES[text(a, 'image_style') ?? ''];
  const placement = PLACEMENTS[text(a, 'print_placement') ?? ''];
  const lines = [
    main && `The main printed image is: ${described(main)}.`,
    style && `Render it as a ${style}.`,
    placement && `The print is ${placement}.`,
  ];
  if (files(a, 'reference_upload').length) {
    lines.push('Use the attached images as visual reference for the print.');
  }
  return lines;
}

function teamLines(a: Answers) {
  const pattern = PATTERNS[text(a, 'pattern') ?? ''];
  return [pattern && `The jersey has ${pattern}.`];
}

function logoLines(a: Answers) {
  if (text(a, 'has_logo') !== 'yes') return [];
  const position = LOGO_POSITIONS[text(a, 'logo_position') ?? ''];
  if (!files(a, 'logo_upload').length) {
    return [position && `A team crest is placed ${position}.`];
  }
  return [`Place the attached logo ${position ?? 'on the chest'}, keeping its exact shape and colours.`];
}

function footballLines(a: Answers) {
  const collar = COLLARS[text(a, 'collar') ?? ''];
  return [...teamLines(a), collar && `It has a ${collar}.`, ...logoLines(a)];
}

function volleyballLines(a: Answers) {
  const sleeve = SLEEVES[text(a, 'sleeve') ?? ''];
  return [...teamLines(a), sleeve && `The cut is ${sleeve}.`, ...logoLines(a)];
}

/** The texts on the front, largest first. */
function frontTexts(a: Answers): PrintedText[] {
  const team = text(a, 'team_name');
  const sponsor = text(a, 'sponsor');
  const number = text(a, 'sample_number');
  const position = text(a, 'number_position');
  const shirtText = text(a, 'text_content');

  const texts: PrintedText[] = [];
  if (team) texts.push({ value: team, role: 'the team name, the largest text, across the chest' });
  if (number && (position === 'front' || position === 'both')) {
    texts.push({ value: number, role: 'the player number, large, below the team name' });
  }
  if (sponsor) {
    texts.push({ value: sponsor, role: 'the sponsor name, clearly smaller than the team name' });
  }
  if (shirtText) {
    const role = team ? 'a slogan, the smallest text, at the bottom of the chest print' : 'the shirt text, large and easy to read';
    texts.push({ value: shirtText, role });
  }
  return texts;
}

function commonLines(a: Answers) {
  const occasion = OCCASIONS[text(a, 'occasion') ?? ''];
  const style = STYLES[text(a, 'style') ?? ''];
  const include = text(a, 'colours_include');
  const avoid = text(a, 'colours_avoid');
  const unwanted = text(a, 'unwanted');
  const notes = text(a, 'notes');
  return [
    occasion && `It is made for ${occasion}.`,
    style && `The overall style is ${style}.`,
    include && `Use these colours in the design: ${described(include)}.`,
    avoid && `Avoid these colours: ${described(avoid)}.`,
    unwanted && `Do not include: ${described(unwanted)}.`,
    notes && `Extra notes from the customer: ${described(notes)}.`,
  ];
}

/** The prompt for the first image, which is always the front of the shirt. */
export function buildFirstImagePrompt(specs: SpecSnapshot, answers: Answers): BuiltPrompt {
  const { shirtType } = specs.product;
  const colour = specs.colour.id;
  const material = MATERIALS[specs.material.id] ?? specs.material.name;

  const specific = {
    PRINTED: printedLines,
    FOOTBALL: footballLines,
    VOLLEYBALL: volleyballLines,
  }[shirtType](answers);

  const lines = [
    `Product photo of a single ${colour} ${SHIRTS[shirtType]} made of ${material}, seen from the front.`,
    'Show only the shirt, flat and centred on a plain light grey background, with no person and no mannequin.',
    ...specific,
    ...commonLines(answers),
    ...printedTextBlock(frontTexts(answers)),
  ].filter((line): line is string => Boolean(line));

  if (lines.some((line) => line.includes('['))) {
    lines.push("Text in square brackets is the customer's description: follow it, but never print those words.");
  }

  return {
    prompt: lines.join('\n'),
    referenceFileIds: [
      ...files(answers, 'reference_upload'),
      ...files(answers, 'logo_upload'),
    ],
  };
}
