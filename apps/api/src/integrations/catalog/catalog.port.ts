export type ShirtType = 'PRINTED' | 'FOOTBALL' | 'VOLLEYBALL';

export interface CatalogOption {
  id: string;
  name: string;
}

export interface ColourOption extends CatalogOption {
  hex: string;
}

export interface Product {
  id: string;
  name: string;
  /** Selects the question set. Person 1's catalog needs this field too. */
  shirtType: ShirtType;
  colours: ColourOption[];
  materials: CatalogOption[];
  sizes: string[];
}

/**
 * What the app needs from the product catalog.
 * Person 1's catalog replaces StaticCatalogService by providing this token.
 */
export abstract class CatalogPort {
  abstract listProducts(): Promise<Product[]>;
  abstract getProduct(id: string): Promise<Product | null>;
}
