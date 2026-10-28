import { describe, expect, it } from 'vitest';
import { normalizeUrl, rankUrls } from '@/lib/pipeline/discover';
import { isPrivateIp, safeGet } from '@/lib/pipeline/probe';
import { slugify } from '@/lib/pipeline/util';

const h = (url: string) => ({ url, title: url, description: '' });

describe('discover ranking', () => {
  const hits = [
    h('https://medium.com/@a/pipedrive-oauth'),
    h('https://dev.to/b/pipedrive-oauth-guide'),
    h('https://stackoverflow.com/q/1/pipedrive-oauth'),
    h('https://blog.example.com/pipedrive'),
    h('https://pipedrive.readme.io/docs/marketplace-oauth-authorization'),
    h('https://developers.pipedrive.com/docs/api/v1/oauth?x=1#y'),
    h('https://developers.pipedrive.com/docs/api/v1/oauth'),
    h('https://www.pipedrive.com/en/marketplace/app-approval-process'),
    h('https://nango.dev/docs/integrations/all/pipedrive'),
  ];
  const r = rankUrls(hits, { domain: 'pipedrive.com', devDocsHost: 'developers.pipedrive.com' });

  it('puts official hosts first and dedupes by normalized URL', () => {
    expect(r[0].official).toBe(true);
    expect(r.filter((x) => x.url.includes('developers.pipedrive.com/docs/api/v1/oauth')).length).toBe(1);
    expect(r.filter((x) => x.official).length).toBeGreaterThanOrEqual(2);
  });
  it('keeps at most one aggregator and includes a review page', () => {
    expect(r.filter((x) => x.publisher === 'community').length).toBeLessThanOrEqual(1);
    expect(r.some((x) => x.review)).toBe(true);
    expect(r.length).toBeLessThanOrEqual(8);
  });
  it('normalizes urls', () => {
    expect(normalizeUrl('https://A.com/x/?q=1#h')).toBe('https://a.com/x');
  });
  it('slugifies names and urls', () => {
    expect(slugify('Zoho CRM')).toBe('zoho-crm');
    expect(slugify('https://www.pipedrive.com/en')).toBe('pipedrive');
    expect(slugify('pipedrive.com')).toBe('pipedrive');
  });
});

describe('probe SSRF guard', () => {
  it('flags private ranges', () => {
    for (const ip of ['10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '0.0.0.0'])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('refuses localhost, metadata IPs, other schemes and other domains', async () => {
    await expect(safeGet('http://localhost:3000/')).rejects.toThrow(/blocked/);
    await expect(safeGet('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/blocked/);
    await expect(safeGet('file:///etc/passwd')).rejects.toThrow(/blocked scheme/);
    await expect(safeGet('https://evil.com/x', { suffix: 'pipedrive.com' })).rejects.toThrow(/outside/);
  });
});

describe('resolve fallback', async () => {
  const { fallback } = await import('@/lib/pipeline/resolve');
  it('derives app, domain and docs host from search hits', () => {
    const r = fallback('zoho crm', [{ url: 'https://medium.com/x' }, { url: 'https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html' }]);
    expect(r).toMatchObject({ appName: 'Zoho Crm', domain: 'zoho.com', slug: 'zoho-crm' });
    expect(fallback('pipedrive.com', [])).toMatchObject({ appName: 'Pipedrive', domain: 'pipedrive.com', slug: 'pipedrive' });
  });
});

describe('official sister domains', () => {
  it('treats dropboxapi.com as official for dropbox.com, not lookalikes', async () => {
    const { publisherOf } = await import('@/lib/pipeline/discover');
    expect(publisherOf('https://docs.dropboxapi.com/oauth', { domain: 'dropbox.com' })).toBe('official');
    expect(publisherOf('https://dropbox-fans.com/x', { domain: 'dropbox.com' })).not.toBe('official');
    expect(publisherOf('https://dropboxforum.example.net/x', { domain: 'dropbox.com' })).not.toBe('official');
  });
});
