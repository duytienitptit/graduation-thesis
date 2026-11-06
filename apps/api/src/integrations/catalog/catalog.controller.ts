import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { CatalogPort } from './catalog.port.js';

@Controller('catalog/products')
export class CatalogController {
  constructor(private readonly catalog: CatalogPort) {}

  @Get()
  list() {
    return this.catalog.listProducts();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const product = await this.catalog.getProduct(id);
    if (!product) throw new NotFoundException();
    return product;
  }
}
