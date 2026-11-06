import { Injectable } from '@nestjs/common';
import { PRODUCTS } from './catalog.data.js';
import { CatalogPort, Product } from './catalog.port.js';

/** Stand-in catalog: the 3 shirt types, kept in code. */
@Injectable()
export class StaticCatalogService extends CatalogPort {
  async listProducts() {
    return PRODUCTS;
  }

  async getProduct(id: string): Promise<Product | null> {
    return PRODUCTS.find((product) => product.id === id) ?? null;
  }
}
