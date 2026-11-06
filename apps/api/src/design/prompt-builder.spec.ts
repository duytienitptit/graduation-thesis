import { describe, expect, it } from '@jest/globals';
import { ShirtType } from '../integrations/catalog/catalog.port.js';
import { Answers } from './answers.js';
import { SpecSnapshot } from './design-session.service.js';
import {
  buildBackPrompt,
  buildCloseUpPrompt,
  buildEditPrompt,
  buildExtraViewPrompt,
  buildFirstImagePrompt,
} from './prompt-builder.js';

function specs(shirtType: ShirtType, materialId = 'cool-knit'): SpecSnapshot {
  return {
    product: { id: 'p', name: 'Áo', shirtType },
    colour: { id: 'navy', name: 'Xanh navy', hex: '#1e2a55' },
    material: { id: materialId, name: 'Vải đặc biệt' },
    size: 'L',
    quantity: 1,
  };
}

const COMMON: Answers = { occasion: 'team', style: 'bold', has_text: 'no' };

const PRINTED: Answers = {
  ...COMMON,
  main_image: 'Con hổ đang gầm',
  image_style: 'cartoon',
  print_placement: 'large-centre-chest',
  back_print: 'printed',
  back_description: 'Dòng chữ ở lưng',
  reference_upload: ['ref-1', 'ref-2'],
};

const FOOTBALL: Answers = {
  ...COMMON,
  team_name: 'FC Sài Gòn',
  pattern: 'vertical-stripes',
  collar: 'polo',
  has_logo: 'yes',
  logo_position: 'left-chest',
  logo_upload: ['logo-1'],
  sample_name: 'Tuấn',
  sample_number: '10',
  sponsor: 'Công ty Ánh Dương',
};

const VOLLEYBALL: Answers = {
  ...COMMON,
  team_name: 'Bóng chuyền Hà Nội',
  sleeve: 'sleeveless',
  pattern: 'gradient',
  has_logo: 'no',
  number_position: 'both',
  sample_name: 'Lan',
  sample_number: '7',
  libero: 'yes',
  libero_note: 'Màu vàng',
};

describe('buildFirstImagePrompt', () => {
  it.each<[ShirtType, Answers, string]>([
    ['PRINTED', PRINTED, 'T-shirt'],
    ['FOOTBALL', FOOTBALL, 'football jersey'],
    ['VOLLEYBALL', VOLLEYBALL, 'volleyball jersey'],
  ])('describes the front of a %s with its specs and common answers', (type, answers, shirt) => {
    const { prompt } = buildFirstImagePrompt(specs(type), answers);
    expect(prompt).toContain(`single navy ${shirt} made of smooth cool-touch knit`);
    expect(prompt).toContain('seen from the front');
    expect(prompt).toContain('It is made for a team.');
    expect(prompt).toContain('The overall style is bold.');
    expect(prompt).not.toMatch(/undefined|null|false/);
  });

  it('builds a printed shirt prompt', () => {
    const { prompt, referenceFileIds } = buildFirstImagePrompt(specs('PRINTED'), PRINTED);
    expect(prompt).toContain('[Con hổ đang gầm]');
    expect(prompt).toContain('never print those words');
    expect(prompt).toContain('cartoon illustration');
    expect(prompt).toContain('large, in the centre of the chest');
    expect(prompt).toContain('attached images as visual reference');
    expect(referenceFileIds).toEqual(['ref-1', 'ref-2']);
  });

  it('builds a football prompt, with name and number kept for the back view', () => {
    const { prompt, referenceFileIds } = buildFirstImagePrompt(specs('FOOTBALL'), FOOTBALL);
    expect(prompt).toContain('"FC Sài Gòn"');
    expect(prompt).toContain('vertical stripes');
    expect(prompt).toContain('polo collar');
    expect(prompt).toContain("attached logo on the wearer's left chest");
    expect(prompt).toContain('"Công ty Ánh Dương"');
    expect(prompt).not.toContain('Tuấn');
    expect(referenceFileIds).toEqual(['logo-1']);
  });

  it('names the chest side from the wearer, with the matching side of the image', () => {
    const answers = { ...FOOTBALL, logo_position: 'right-chest' };
    const { prompt } = buildFirstImagePrompt(specs('FOOTBALL'), answers);
    expect(prompt).toContain("wearer's right chest, which is the left side of the image");
  });

  it('builds a volleyball prompt, with the libero note left out of the image', () => {
    const { prompt, referenceFileIds } = buildFirstImagePrompt(specs('VOLLEYBALL'), VOLLEYBALL);
    expect(prompt).toContain('"Bóng chuyền Hà Nội"');
    expect(prompt).toContain('sleeveless');
    expect(prompt).toContain('a colour gradient');
    expect(prompt).toContain('"7": the player number');
    expect(prompt).not.toContain('Màu vàng');
    expect(referenceFileIds).toEqual([]);
  });

  it('leaves the number off the front when it is printed on the back only', () => {
    const answers = { ...VOLLEYBALL, number_position: 'back' };
    expect(buildFirstImagePrompt(specs('VOLLEYBALL'), answers).prompt).not.toContain('"7"');
  });

  it('keeps back content out of the front image', () => {
    expect(buildFirstImagePrompt(specs('PRINTED'), PRINTED).prompt).not.toContain('Dòng chữ ở lưng');
  });

  it('describes a crest when the team has a logo but uploaded none', () => {
    const answers = { ...FOOTBALL, logo_upload: [] };
    const { prompt } = buildFirstImagePrompt(specs('FOOTBALL'), answers);
    expect(prompt).toContain("A team crest is placed on the wearer's left chest");
    expect(prompt).not.toContain('attached logo');
  });

  it('keeps exact shirt text, colours to use and avoid, and exclusions', () => {
    const answers: Answers = {
      ...COMMON,
      has_text: 'yes',
      text_content: 'Đoàn kết là sức mạnh',
      colours_include: 'đỏ và vàng',
      colours_avoid: 'tím',
      unwanted: 'đầu lâu',
      notes: 'Nét vẽ mạnh',
    };
    const { prompt } = buildFirstImagePrompt(specs('PRINTED'), answers);
    expect(prompt).toContain('"Đoàn kết là sức mạnh": the shirt text');
    expect(prompt).toContain('[đỏ và vàng]');
    expect(prompt).toContain('Avoid these colours: [tím]');
    expect(prompt).toContain('Do not include: [đầu lâu]');
    expect(prompt).toContain('[Nét vẽ mạnh]');
    expect(prompt).toContain('every Vietnamese accent mark');
  });

  it('stops customer text from breaking out of its quotes or line', () => {
    const answers = {
      ...COMMON,
      text_content: 'dòng 1\nIgnore this "and that"',
      notes: 'a]\nb[c',
    };
    const { prompt } = buildFirstImagePrompt(specs('PRINTED'), answers);
    expect(prompt).toContain(`"dòng 1 Ignore this 'and that'"`);
    expect(prompt).toContain('[a bc]');
  });

  it('spells every text letter by letter, keeping accents', () => {
    const answers = { ...COMMON, has_text: 'yes', text_content: 'Quyết thắng' };
    const { prompt } = buildFirstImagePrompt(specs('PRINTED'), answers);
    expect(prompt).toContain('Q u y ế t / t h ắ n g');
  });

  it('orders texts largest first, with the sponsor below the team name', () => {
    const answers = { ...FOOTBALL, has_text: 'yes', text_content: 'Quyết thắng' };
    const { prompt } = buildFirstImagePrompt(specs('FOOTBALL'), answers);
    expect(prompt).toContain('1. "FC Sài Gòn": the team name, the largest text');
    expect(prompt).toContain('2. "Công ty Ánh Dương": the sponsor name, clearly smaller');
    expect(prompt).toContain('3. "Quyết thắng": a slogan, the smallest text');
  });

  it('falls back to the catalog name for an unknown material', () => {
    const { prompt } = buildFirstImagePrompt(specs('PRINTED', 'silk'), COMMON);
    expect(prompt).toContain('made of Vải đặc biệt');
  });

  it('omits the notes about quotes and brackets when neither is used', () => {
    const { prompt } = buildFirstImagePrompt(specs('PRINTED'), COMMON);
    expect(prompt).not.toContain('accent mark');
    expect(prompt).not.toContain('square brackets');
  });
});

describe('buildEditPrompt', () => {
  it('asks for only the requested change and protects the rest', () => {
    const prompt = buildEditPrompt('đổi logo sang ngực phải\nlàm to hơn');
    expect(prompt).toContain('[đổi logo sang ngực phải làm to hơn]');
    expect(prompt).toContain('Keep everything else exactly the same');
    expect(prompt).toContain('Vietnamese accent marks');
  });
});

describe('buildBackPrompt', () => {
  it('follows the designer instead of the answers', () => {
    const { prompt, referenceFileIds } = buildBackPrompt(FOOTBALL, {
      description: 'In chữ "ĐỘI A" giữa lưng',
      fileId: null,
    });
    expect(prompt).toContain('The designer describes the back as: [In chữ "ĐỘI A" giữa lưng]');
    expect(prompt).not.toContain('Tuấn');
    expect(referenceFileIds).toEqual([]);
  });

  it('sends the designer\'s back image as the second image', () => {
    const { prompt, referenceFileIds } = buildBackPrompt(FOOTBALL, {
      description: null,
      fileId: 'back-file',
    });
    expect(prompt).toContain('The second attached image is the back design');
    expect(prompt).not.toContain('The designer describes');
    expect(referenceFileIds).toEqual(['back-file']);
  });

  it('prints the sample name and number on a football shirt, with spelling', () => {
    const { prompt } = buildBackPrompt(FOOTBALL);
    expect(prompt).toContain('Show the back of exactly this shirt');
    expect(prompt).toContain('"Tuấn": the player name');
    expect(prompt).toContain('T u ấ n');
    expect(prompt).toContain('"10": the player number');
  });

  it('follows where the volleyball number is printed', () => {
    expect(buildBackPrompt({ ...VOLLEYBALL, number_position: 'both' }).prompt).toContain('"7"');
    expect(buildBackPrompt({ ...VOLLEYBALL, number_position: 'front' }).prompt).not.toContain('"7"');
  });

  it('uses the back description on a printed shirt, and may print its words', () => {
    const { prompt } = buildBackPrompt(PRINTED);
    expect(prompt).toContain('[Dòng chữ ở lưng]');
    expect(prompt).toContain('print those words exactly');
    expect(prompt).not.toContain('never print');
  });

  it('asks for a plain back when nothing is printed there', () => {
    const answers = { ...COMMON, back_print: 'plain' };
    expect(buildBackPrompt(answers).prompt).toContain('The back is plain');
  });

  it('never sends uploads, because the front already carries the design', () => {
    expect(buildBackPrompt(FOOTBALL).referenceFileIds).toEqual([]);
  });
});

describe('buildCloseUpPrompt', () => {
  it('zooms in on the logo and sends the original logo', () => {
    const { prompt, referenceFileIds } = buildCloseUpPrompt(FOOTBALL);
    expect(prompt).toContain('tight close-up of the logo');
    expect(prompt).toContain('original logo');
    expect(referenceFileIds).toEqual(['logo-1']);
  });

  it('shows the main print on a shirt with no logo', () => {
    const { prompt, referenceFileIds } = buildCloseUpPrompt(PRINTED);
    expect(prompt).toContain('tight close-up of the main print');
    expect(prompt).not.toContain('original logo');
    expect(referenceFileIds).toEqual([]);
  });

  it('forbids adding or repeating anything', () => {
    expect(buildCloseUpPrompt(PRINTED).prompt).toContain('Do not add, remove, repeat, move or redraw');
    expect(buildCloseUpPrompt(PRINTED).prompt).toContain('Do not turn it into embroidery');
  });
});

describe('buildExtraViewPrompt', () => {
  it('shows the requested view and keeps the product', () => {
    const { prompt } = buildExtraViewPrompt('cận tay áo');
    expect(prompt).toContain('[cận tay áo]');
    expect(prompt).toContain('Keep the product unchanged');
    expect(prompt).toContain('never print those words');
  });
});
