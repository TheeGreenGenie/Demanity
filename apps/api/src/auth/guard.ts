import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { findSession, type Session, type SessionScope } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
    sessionToken: string | null;
  }
}

/**
 * Guest mode (R2): every request starts as a guest. Read-only routes need
 * nothing; any route that writes must use `requireSession`.
 */
export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export function loadSession(pool: Pool) {
  return async (req: FastifyRequest) => {
    const token = bearerToken(req);
    req.sessionToken = token;
    req.session = token ? await findSession(pool, token) : null;
  };
}

export function requireSession(opts: { scopes: SessionScope[]; statuses?: Session['status'][] }) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session) return reply.code(401).send({ error: 'sign_in_required' });
    if (!opts.scopes.includes(req.session.scope)) {
      return reply.code(403).send({ error: 'insufficient_scope' });
    }
    if (opts.statuses && !opts.statuses.includes(req.session.status)) {
      return reply.code(403).send({ error: 'account_not_ready', status: req.session.status });
    }
  };
}
