import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import {
  CatalogOption,
  CatalogPort,
  ColourOption,
  ShirtType,
} from '../integrations/catalog/catalog.port.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnswerError, Answers, cleanAnswers, missingRequired, uploadedFileIds } from './answers.js';
import { QUESTION_SETS } from './question-sets.js';

export interface ChosenSpecs {
  productId: string;
  colourId: string;
  materialId: string;
  size: string;
  quantity: number;
}

export interface SpecSnapshot {
  product: { id: string; name: string; shirtType: ShirtType };
  colour: ColourOption;
  material: CatalogOption;
  size: string;
  quantity: number;
}

@Injectable()
export class DesignSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogPort,
    private readonly files: FilesPort,
  ) {}

  async create(customer: AuthUser, specs: ChosenSpecs) {
    const specSnapshot = (await this.snapshot(specs)) as unknown as Prisma.InputJsonObject;
    return this.prisma.designSession.create({ data: { customerId: customer.id, specSnapshot } });
  }

  listOwn(customer: AuthUser) {
    return this.prisma.designSession.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const session = await this.prisma.designSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException();
    // Designers working on a task gain access in phase 7.
    if (session.customerId !== user.id && user.role !== Role.MANAGER) {
      throw new ForbiddenException();
    }
    return session;
  }

  /** Replaces the saved draft. It may be partial; submit checks that it is complete. */
  async saveAnswers(customer: AuthUser, id: string, raw: Record<string, unknown>) {
    const session = await this.getOwn(customer, id);
    const set = QUESTION_SETS[(session.specSnapshot as unknown as SpecSnapshot).product.shirtType];

    const { answers, errors } = cleanAnswers(set, raw);
    if (errors.length) throw invalidAnswers(errors);

    const fileIds = uploadedFileIds(set, answers);
    if (fileIds.length && !(await this.files.ownsReadyFiles(customer, fileIds))) {
      throw new BadRequestException('Uploaded image not found');
    }

    await this.updateWhileAnswering(id, { answers });
    return this.getOwn(customer, id);
  }

  async submitAnswers(customer: AuthUser, id: string) {
    const session = await this.getOwn(customer, id);
    const set = QUESTION_SETS[(session.specSnapshot as unknown as SpecSnapshot).product.shirtType];

    const errors = missingRequired(set, session.answers as unknown as Answers);
    if (errors.length) throw invalidAnswers(errors);

    await this.updateWhileAnswering(id, { status: 'ANSWERED' });
    return this.getOwn(customer, id);
  }

  private async getOwn(customer: AuthUser, id: string) {
    const session = await this.prisma.designSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException();
    if (session.customerId !== customer.id) throw new ForbiddenException();
    return session;
  }

  /** The status check is part of the update, so a late save cannot change submitted answers. */
  private async updateWhileAnswering(id: string, data: Prisma.DesignSessionUpdateManyMutationInput) {
    const { count } = await this.prisma.designSession.updateMany({
      where: { id, status: 'ANSWERING' },
      data,
    });
    if (!count) throw new ConflictException('Answers have already been submitted');
  }

  private async snapshot(specs: ChosenSpecs): Promise<SpecSnapshot> {
    const product = await this.catalog.getProduct(specs.productId);
    if (!product) throw new BadRequestException('Unknown product');

    const colour = product.colours.find((option) => option.id === specs.colourId);
    const material = product.materials.find((option) => option.id === specs.materialId);
    if (!colour) throw new BadRequestException('Colour is not available for this product');
    if (!material) throw new BadRequestException('Material is not available for this product');
    if (!product.sizes.includes(specs.size)) {
      throw new BadRequestException('Size is not available for this product');
    }

    return {
      product: { id: product.id, name: product.name, shirtType: product.shirtType },
      colour,
      material,
      size: specs.size,
      quantity: specs.quantity,
    };
  }
}

function invalidAnswers(errors: AnswerError[]) {
  return new BadRequestException({ message: 'Invalid answers', errors });
}
