import { promises as dns } from 'dns';

// In-memory cache so leads sharing a domain (common when scraping many
// businesses from the same city) don't repeat the same DNS lookup.
const mxCache = new Map<string, boolean>();

// Confirms the domain has real mail-exchange (MX) records, i.e. it's a
// genuine, registered, mail-accepting domain. This is a free, local, no-key
// check (Node's built-in dns module) — it proves the domain can receive mail,
// not that the specific mailbox exists, which is the honest limit of what's
// achievable without a paid mailbox-verification API.
export async function domainHasMailServer(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  if (mxCache.has(key)) return mxCache.get(key)!;

  try {
    const records = await dns.resolveMx(key);
    const ok = Array.isArray(records) && records.length > 0;
    mxCache.set(key, ok);
    return ok;
  } catch {
    mxCache.set(key, false);
    return false;
  }
}

export async function verifyEmailDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  return domain ? domainHasMailServer(domain) : false;
}
