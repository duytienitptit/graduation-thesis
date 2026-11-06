import { CatalogOption, ColourOption, Product } from './catalog.port.js';

// Sample values until Person 1's catalog exists.
const COLOURS: ColourOption[] = [
  { id: 'white', name: 'Trắng', hex: '#ffffff' },
  { id: 'black', name: 'Đen', hex: '#000000' },
  { id: 'grey', name: 'Xám', hex: '#9ca3af' },
  { id: 'navy', name: 'Xanh navy', hex: '#1e2a55' },
  { id: 'blue', name: 'Xanh dương', hex: '#1d6fd8' },
  { id: 'green', name: 'Xanh lá', hex: '#15803d' },
  { id: 'red', name: 'Đỏ', hex: '#dc2626' },
  { id: 'yellow', name: 'Vàng', hex: '#facc15' },
];

const COTTON: CatalogOption = { id: 'cotton', name: 'Cotton 100%' };
const CVC: CatalogOption = { id: 'cvc', name: 'Cotton pha CVC' };
const COOL_KNIT: CatalogOption = { id: 'cool-knit', name: 'Thun lạnh' };
const MESH: CatalogOption = { id: 'mesh', name: 'Thun mè thể thao' };

const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

export const PRODUCTS: Product[] = [
  {
    id: 'printed-shirt',
    name: 'Áo in hình',
    shirtType: 'PRINTED',
    colours: COLOURS,
    materials: [COTTON, CVC, COOL_KNIT],
    sizes: SIZES,
  },
  {
    id: 'football-shirt',
    name: 'Áo đá bóng',
    shirtType: 'FOOTBALL',
    colours: COLOURS,
    materials: [COOL_KNIT, MESH],
    sizes: SIZES,
  },
  {
    id: 'volleyball-shirt',
    name: 'Áo bóng chuyền',
    shirtType: 'VOLLEYBALL',
    colours: COLOURS,
    materials: [COOL_KNIT, MESH],
    sizes: SIZES,
  },
];
