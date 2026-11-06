import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { AuthUser } from './auth.port.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Every route needs login unless it says otherwise. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user,
);
