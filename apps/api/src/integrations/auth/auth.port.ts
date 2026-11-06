import { Role } from '../../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * The only thing the rest of the app needs from login.
 * Person 1's real login replaces DevAuthService by providing this token.
 */
export abstract class AuthPort {
  abstract verifyToken(token: string): Promise<AuthUser | null>;
}
