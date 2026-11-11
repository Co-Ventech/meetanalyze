const dns = require('node:dns');

/**
 * MeetLyst DNS Resilience Utility
 * 
 * Guards against the well-known macOS Darwin getaddrinfo bug (ENOTFOUND / EAI_NONAME / errno -3008)
 * which occurs during simultaneous AAAA/IPv6 lookups or local DNS caching issues on macOS.
 *
 * Provides a 3-tier fallback when system getaddrinfo fails:
 * 1. Direct c-ares resolve4 (bypasses OS getaddrinfo)
 * 2. Reliable public DNS resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1)
 * 3. Verified static IPs for AssemblyAI endpoints with full TLS/SNI support
 */

try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {}

// Fallback resolver using Google and Cloudflare public DNS
const fallbackResolver = new dns.Resolver();
try {
  fallbackResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  console.warn('[DNS] Could not initialize fallback public DNS servers:', e);
}

// Known static fallback IPs for AssemblyAI endpoints in case of severe local DNS outages
const STATIC_ASSEMBLYAI_IPS = {
  'llm-gateway.assemblyai.com': ['54.148.130.68', '44.254.190.3', '34.216.161.250'],
  'streaming.assemblyai.com': ['13.63.59.56', '13.48.244.216', '13.61.136.103'],
  'streaming.us.assemblyai.com': ['13.63.59.56', '13.48.244.216'],
  'streaming.eu.assemblyai.com': ['108.128.179.85'],
  'llm-gateway.eu.assemblyai.com': ['108.128.179.85'],
  'api.assemblyai.com': ['54.148.130.68', '44.254.190.3'],
};

if (!dns.__meetlyst_patched) {
  dns.__meetlyst_patched = true;
  const originalLookup = dns.lookup;

  dns.lookup = function (hostname, options, callback) {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    }

    // Attempt standard OS getaddrinfo first
    originalLookup.call(dns, hostname, opts, (err, address, family) => {
      if (!err && address) {
        return cb(null, address, family);
      }

      // If OS getaddrinfo failed with ENOTFOUND or network error:
      if (hostname && typeof hostname === 'string') {
        // Fallback 1: Direct c-ares resolve4 (bypasses OS getaddrinfo)
        dns.resolve4(hostname, (resErr, addresses) => {
          if (!resErr && addresses && addresses.length > 0) {
            if (opts && opts.all) {
              return cb(null, addresses.map(addr => ({ address: addr, family: 4 })));
            }
            return cb(null, addresses[0], 4);
          }

          // Fallback 2: Public DNS (Google 8.8.8.8 / Cloudflare 1.1.1.1)
          fallbackResolver.resolve4(hostname, (pubErr, pubAddresses) => {
            if (!pubErr && pubAddresses && pubAddresses.length > 0) {
              if (opts && opts.all) {
                return cb(null, pubAddresses.map(addr => ({ address: addr, family: 4 })));
              }
              return cb(null, pubAddresses[0], 4);
            }

            // Fallback 3: Static IP cache for AssemblyAI hosts
            const staticIps = STATIC_ASSEMBLYAI_IPS[hostname];
            if (staticIps && staticIps.length > 0) {
              if (opts && opts.all) {
                return cb(null, staticIps.map(addr => ({ address: addr, family: 4 })));
              }
              return cb(null, staticIps[0], 4);
            }

            // Return original error if all fallbacks fail
            return cb(err, address, family);
          });
        });
        return;
      }

      return cb(err, address, family);
    });
  };
}

module.exports = { dns };

