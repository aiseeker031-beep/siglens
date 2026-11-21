import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Checks whether an IPv4 or IPv6 address belongs to loopback, link-local,
 * RFC1918 private, CGNAT, multicast, or cloud metadata address space.
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast & reserved
    return false;
  }

  if (version === 6) {
    if (ip === '::' || ip === '::1') return true;
    // IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1 or ::ffff:7f00:1
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice(7);
      if (net.isIP(mapped) === 4) {
        return isPrivateOrReservedIp(mapped);
      }
      return true;
    }
    // Unique local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8)
    if (
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe8') ||
      ip.startsWith('fe9') ||
      ip.startsWith('fea') ||
      ip.startsWith('feb') ||
      ip.startsWith('ff')
    ) {
      return true;
    }
    return false;
  }

  return false;
}

export interface SafeUrlOptions {
  allowHttpLocalhost?: boolean;
  resolveDns?: boolean;
}

/**
 * Validates that a user-supplied URL is safe against SSRF (syntactic host/IP checks).
 */
export function assertSafeExternalUrlSync(rawUrl: string, opts: SafeUrlOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs containing embedded credentials are not permitted.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (opts.allowHttpLocalhost && isLoopbackHost) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Local endpoint must use HTTP or HTTPS.');
    }
    return parsed;
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('External URLs must use HTTPS.');
  }

  if (
    isLoopbackHost ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new Error('Private or internal network URLs are blocked for security.');
  }

  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new Error('Private or reserved IP ranges are blocked for security.');
  }

  return parsed;
}

/**
 * Full async SSRF validator including DNS resolution verification against private/metadata IPs.
 */
export async function assertSafeExternalUrl(
  rawUrl: string,
  opts: SafeUrlOptions = {},
): Promise<URL> {
  const parsed = assertSafeExternalUrlSync(rawUrl, opts);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (opts.allowHttpLocalhost && isLoopbackHost) {
    return parsed;
  }

  if (opts.resolveDns !== false && !net.isIP(host)) {
    let records: { address: string }[];
    try {
      records = await dns.lookup(host, { all: true });
    } catch {
      throw new Error('Unable to resolve external hostname.');
    }
    if (records.length === 0) {
      throw new Error('Hostname did not resolve to a valid public IP.');
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error('Hostname resolves to a blocked private or internal IP range.');
      }
    }
  }

  return parsed;
}

