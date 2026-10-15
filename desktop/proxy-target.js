/* The /_proxy target rule, in one place for the desktop shell.

   https anywhere, http only on a host that is provably private.

   Why the exception exists (issue #5): the https rule is there so an API key
   never crosses the network in clear. A loopback target never crosses the
   network: Ollama, LM Studio and llama.cpp all serve plain http on
   127.0.0.1, and demanding https there refused exactly the local-first setup
   this client is built around. Everything that is not private still has to
   be https.

   Why the exception is wider than loopback (Tailscale): a self-hosted model
   box is routinely reached over a tailnet, where the target is plain http on
   a 100.64.0.0/10 (CGNAT) address or on a MagicDNS name like `box`. Refusing
   those broke the very setup this operator runs, while the property the
   https rule protects (no API key in clear over a public network) is
   untouched by any of them. So three shapes are admitted beyond loopback:

     - CGNAT literals, 100.64.0.0/10, where Tailscale hands out v4 addresses
     - IPv6 unique-local, fc00::/7, the v6 equivalent
     - names in an explicitly private namespace, by suffix: .ts.net (Tailscale
       MagicDNS), .local, .lan, .home, .internal

   A bare label with no dot (`box`) is deliberately NOT admitted; see the
   note above PRIVATE_SUFFIXES for the two reasons. The qualified form,
   `box.tailnet-name.ts.net`, is the one to use.

   None of these is a public name, so `evil.com` and every other public host
   is still refused, which is the property the https rule was protecting.

   The same rule lives in scripts/serve.py and
   android/app/src/main/java/com/ryza/chat/AssetServer.java; config/layers.json
   (proxyContract) pins the three together so one cannot drift.

   It sits in its own file rather than inline in main.js so a regression can
   exercise it without booting Electron, and desktop/package.json lists it
   explicitly, which scripts/proxy_target_regression.js checks, because a
   missing entry there means a require() failure in the packaged shell only. */
'use strict';

/* Namespaces that are private by definition. A public name can never end in
   one of these, so adding them does not widen the rule for the public
   internet. `.ts.net` is Tailscale's MagicDNS domain; the rest are the
   conventional local ones. */
const PRIVATE_SUFFIXES = /\.(ts\.net|local|lan|home|internal)$/;

/* Why there is no "bare label" rule here (a single name with no dot, the
   shape a tailnet box answers to as `box`).

   It is tempting, and it is what an earlier version of this file did. Two
   things rule it out. First, a bare label is resolved through the local
   resolver's search domain, so on a network that hands out an
   attacker-controlled one, `box` becomes `box.attacker.example` and the API
   key leaves in clear: exactly the outcome the https rule exists to prevent,
   and one no amount of care at the call site can undo. Second, it is
   reachable from URLs nobody typed, because WHATWG URL reads an empty
   authority as a host: `new URL('http:///nohost').hostname` is `nohost`, so
   a bare-label rule turned a previously refused input into an allowed one.
   A regression caught that, which is the only reason it is not still here.

   The usable form is the qualified name, `box.tailnet-name.ts.net`, which
   the suffix rule below admits and which does not depend on a search domain
   at all. */

function isPrivateIpv4(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
  if (m[1] === '127') return true;
  /* 100.64.0.0/10 spans 100.64.x.x through 100.127.x.x. The upper bound
     matters: 100.128.0.1 is a public address and must not be admitted by a
     sloppy `100.` prefix test. */
  return Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
}

function isPrivateHttpHost(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '::1') return true;
  if (isPrivateIpv4(h)) return true;
  /* fc00::/7 unique-local. The leading byte is 0xfc or 0xfd, and WHATWG URL
     has already normalised the text by the time this runs. */
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  return PRIVATE_SUFFIXES.test(h);
}

function isLoopbackHost(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  /* A strict dotted quad: a prefix test on '127.' would also wave through
     `127.0.0.1.evil.com`, which is a public name. new URL() has already
     canonicalised forms like `127.1` by the time this is called. */
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
  return m[1] === '127';
}

function proxyTargetAllowed(target) {
  let u;
  try { u = new URL(String(target || '')); } catch (e) { return false; }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && isPrivateHttpHost(u.hostname);
}

module.exports = { isLoopbackHost, isPrivateHttpHost, proxyTargetAllowed };
