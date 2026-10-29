import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIPv4, parseIPv6, parseNetwork, formatIPv4, expandIPv6, compressIPv6, describe, split, subnetCidrs,
  locate, classify, reverseZones, bitGroups, embeddedIPv4,
} from '../site/lib/subnet.js';

const d = (s) => describe(parseNetwork(s));
const v4 = (n) => formatIPv4(n);

test('ipv4 parsing and errors', () => {
  assert.equal(parseIPv4('192.168.1.10'), 0xc0a8010an);
  assert.equal(formatIPv4(parseIPv4('255.255.255.255')), '255.255.255.255');
  assert.throws(() => parseIPv4('1.2.3'), /four numbers/);
  assert.throws(() => parseIPv4('1.2.3.256'), /out of range/);
  assert.throws(() => parseIPv4('010.0.0.1'), /leading zero/);
  assert.throws(() => parseIPv4('1.2.3.x'), /isn’t a number/);
});

test('ipv6 parsing: compression, embedded IPv4 and errors', () => {
  assert.equal(parseIPv6('::'), 0n);
  assert.equal(parseIPv6('::1'), 1n);
  assert.equal(expandIPv6(parseIPv6('2001:DB8::8:800:200C:417A')), '2001:0db8:0000:0000:0008:0800:200c:417a');
  assert.equal(parseIPv6('::ffff:192.0.2.1'), parseIPv6('::ffff:c000:201'));
  assert.equal(parseIPv6('1:2:3:4:5:6:7:8'), parseIPv6('1:2:3:4:5:6:7:8'));
  assert.throws(() => parseIPv6('1::2::3'), /more than once/);
  assert.throws(() => parseIPv6('1:2:3'), /3 groups/);
  assert.throws(() => parseIPv6('12345::'), /1–4 hex digits/);
  assert.throws(() => parseIPv6('1:2:3:4:5:6:7::8'), /too many groups/);
  assert.throws(() => parseIPv6('1.2.3.4::'), /end/);
  assert.throws(() => parseIPv6('fe80::g'), /characters/);
});

test('ipv6 RFC 5952 canonical text', () => {
  const c = (s) => compressIPv6(parseIPv6(s));
  assert.equal(c('2001:0db8:0000:0000:0000:0000:0002:0001'), '2001:db8::2:1');
  assert.equal(c('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1'); // a single zero group isn't compressed
  assert.equal(c('2001:0:0:1:0:0:0:1'), '2001:0:0:1::1'); // longest run wins
  assert.equal(c('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1'); // first on a tie
  assert.equal(c('0:0:0:0:0:0:0:0'), '::');
  assert.equal(c('fe80:0:0:0:0:0:0:0'), 'fe80::');
  assert.equal(c('::ffff:c000:201'), '::ffff:192.0.2.1');
});

test('network input forms', () => {
  assert.equal(parseNetwork('192.168.1.10/24').prefix, 24);
  assert.equal(parseNetwork(' 192.168.1.10 / 24 ').prefix, 24);
  assert.equal(parseNetwork('192.168.1.10 255.255.252.0').prefix, 22);
  assert.equal(parseNetwork('192.168.1.10/255.255.255.128').prefix, 25);
  const wild = parseNetwork('10.1.0.0 0.0.255.255');
  assert.equal(wild.prefix, 16);
  assert.match(wild.notes[0], /wildcard/);
  const bare = parseNetwork('10.0.0.1');
  assert.equal(bare.prefix, 32);
  assert.match(bare.notes[0], /single address/);
  const zoned = parseNetwork('fe80::1%eth0/64');
  assert.equal(zoned.prefix, 64);
  assert.match(zoned.notes[0], /Zone “%eth0”/);
  assert.equal(parseNetwork('[2001:db8::1]/48').prefix, 48);
  assert.equal(parseNetwork(''), null);
  assert.throws(() => parseNetwork('10.0.0.0/33'), /maximum is \/32/);
  assert.throws(() => parseNetwork('::/129'), /maximum is \/128/);
  assert.throws(() => parseNetwork('10.0.0.0 255.0.255.0'), /isn’t a valid netmask/);
  assert.throws(() => parseNetwork('10.0.0.0/abc'), /isn’t a prefix length/);
});

test('ipv4 /24 details', () => {
  const x = d('192.168.1.130/24');
  assert.equal(x.cidr, '192.168.1.0/24');
  assert.equal(v4(x.mask), '255.255.255.0');
  assert.equal(v4(x.wildcard), '0.0.0.255');
  assert.equal(v4(x.first), '192.168.1.1');
  assert.equal(v4(x.lastUsable), '192.168.1.254');
  assert.equal(v4(x.broadcast), '192.168.1.255');
  assert.equal(x.size, 256n);
  assert.equal(x.usable, 254n);
  assert.equal(x.class, 'C');
  assert.equal(x.type.name, 'Private');
  assert.equal(x.hostBitsSet, true);
  assert.equal(d('192.168.1.0/24').hostBitsSet, false);
});

test('ipv4 edge prefixes: /0, /31, /32', () => {
  const p31 = d('10.0.0.1/31');
  assert.equal(p31.usable, 2n);
  assert.equal(p31.broadcast, null);
  assert.equal(v4(p31.first), '10.0.0.0');
  assert.equal(v4(p31.lastUsable), '10.0.0.1');
  const p32 = d('10.0.0.7/32');
  assert.equal(p32.usable, 1n);
  assert.equal(v4(p32.first), '10.0.0.7');
  const all = d('0.0.0.0/0');
  assert.equal(all.size, 4294967296n);
  assert.equal(v4(all.broadcast), '255.255.255.255');
  assert.equal(all.type.name, 'Mixed');
});

test('ipv6 details', () => {
  const x = d('2001:db8:abcd:12::1/48');
  assert.equal(x.cidr, '2001:db8:abcd::/48');
  assert.equal(compressIPv6(x.last), '2001:db8:abcd:ffff:ffff:ffff:ffff:ffff');
  assert.equal(x.subnets64, 65536n);
  assert.equal(x.size, 1n << 80n);
  assert.equal(x.type.name, 'Documentation');
  assert.equal(d('fd12:3456:789a:1::/64').type.name, 'Unique local (ULA)');
  assert.equal(d('2606:4700::/32').type.name, 'Global unicast');
  assert.equal(d('fe80::1/64').type.name, 'Link-local');
  assert.equal(d('::/0').type.name, 'Mixed');
  assert.equal(d('fe80::/64').subnets64, undefined);
});

test('special-purpose classification picks the most specific range', () => {
  const c = (s) => { const n = parseNetwork(s); return classify(n.version, n.addr, n.prefix).name; };
  assert.equal(c('100.100.1.1'), 'Shared address space (CGNAT)');
  assert.equal(c('172.17.0.1'), 'Private');
  assert.equal(c('172.32.0.1'), 'Public');
  assert.equal(c('8.8.8.8'), 'Public');
  assert.equal(c('169.254.169.254'), 'Link-local');
  assert.equal(c('239.255.255.250'), 'Multicast');
  assert.equal(c('2001:db8::1'), 'Documentation');
  assert.equal(c('2001:0:4136::1'), 'Teredo');
  assert.equal(c('ff02::fb'), 'Multicast');
  assert.equal(c('172.0.0.0/8'), 'Mixed'); // contains 172.16/12
});

test('reverse DNS zones', () => {
  const z = (s) => { const n = parseNetwork(s); return reverseZones(n.version, n.addr & ~((1n << BigInt(n.bits - n.prefix)) - 1n), n.prefix); };
  assert.deepEqual(z('192.168.1.0/24').zones, ['1.168.192.in-addr.arpa']);
  assert.deepEqual(z('10.0.0.0/8').zones, ['10.in-addr.arpa']);
  const p22 = z('192.168.4.0/22');
  assert.equal(p22.count, 4n);
  assert.deepEqual(p22.zones, ['4.168.192.in-addr.arpa', '7.168.192.in-addr.arpa']);
  const p26 = z('192.168.1.64/26');
  assert.equal(p26.classless, true);
  assert.deepEqual(p26.zones, ['1.168.192.in-addr.arpa']);
  assert.deepEqual(z('2001:db8::/32').zones, ['8.b.d.0.1.0.0.2.ip6.arpa']);
  assert.equal(z('2001:db8::/30').count, 4n);
});

test('splitting into subnets', () => {
  const s = split(d('192.168.1.0/24'), 26);
  assert.equal(s.count, 4n);
  assert.deepEqual(s.items.map((i) => i.cidr), ['192.168.1.0/26', '192.168.1.64/26', '192.168.1.128/26', '192.168.1.192/26']);
  assert.equal(v4(s.items[3].broadcast), '192.168.1.255');
  const big = split(d('10.0.0.0/8'), 24, 256);
  assert.equal(big.count, 65536n);
  assert.equal(big.items.length, 256);
  assert.equal(big.items[255].cidr, '10.0.255.0/24');
  const v6 = split(d('2001:db8::/48'), 64, 3);
  assert.deepEqual(v6.items.map((i) => i.cidr), ['2001:db8::/64', '2001:db8:0:1::/64', '2001:db8:0:2::/64']);
  assert.equal(v6.count, 65536n);
  assert.equal([...subnetCidrs(d('10.0.0.0/30'), 32)].join(' '), '10.0.0.0/32 10.0.0.1/32 10.0.0.2/32 10.0.0.3/32');
  assert.throws(() => split(d('10.0.0.0/24'), 24), /between \/25 and \/32/);
});

test('locating addresses and blocks relative to a network', () => {
  const net = d('192.168.1.0/24');
  assert.equal(locate(net, '192.168.1.77').relation, 'inside');
  assert.equal(locate(net, '192.168.1.77').role, 'usable host address');
  assert.match(locate(net, '192.168.1.0').role, /network address/);
  assert.match(locate(net, '192.168.1.255').role, /broadcast/);
  assert.equal(locate(net, '192.168.2.1').relation, 'outside');
  assert.equal(locate(net, '192.168.1.128/25').relation, 'inside');
  assert.equal(locate(net, '192.168.0.0/16').relation, 'contains');
  assert.equal(locate(net, '::1').relation, 'other-version');
  assert.equal(locate(net, ' '), null);
  assert.throws(() => locate(net, '999.1.1.1'), /out of range/);
});

test('bit groups and embedded IPv4', () => {
  assert.deepEqual(bitGroups(parseIPv4('192.168.1.0'), 32), ['11000000', '10101000', '00000001', '00000000']);
  assert.equal(bitGroups(1n, 128).length, 8);
  assert.deepEqual(embeddedIPv4(parseIPv6('64:ff9b::c000:221')), { kind: 'NAT64', v4: '192.0.2.33' });
  assert.deepEqual(embeddedIPv4(parseIPv6('2002:c000:204::1')), { kind: '6to4', v4: '192.0.2.4' });
  assert.equal(embeddedIPv4(parseIPv6('2001:db8::1')), null);
});
