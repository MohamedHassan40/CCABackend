import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JWTPayload } from '@cloud-org/shared';

export function signToken(payload: Omit<JWTPayload, 'sub'> & { sub: string }): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, config.jwtSecret) as JWTPayload;
}
















