/**
 * Verifies the PDF worked example arithmetic (cents + locked rate).
 */
function discountBps(discountCents, lineValueCents) {
  return Math.floor((discountCents * 10000) / lineValueCents);
}
function lineBand(bps) {
  if (bps === 0) return "none";
  if (bps <= 300) return "sand";
  if (bps <= 500) return "red";
  return "blocked";
}
function usdCentsToSdg(usdCents, rate) {
  return Math.floor((usdCents * rate) / 100);
}

const lines = [
  { name: "SPF", qty: 4, price: 51500, disc: 4000, expectBps: 194, expectBand: "sand", expectTotal: 202000 },
  { name: "Hope5", qty: 2, price: 81000, disc: 7000, expectBps: 432, expectBand: "red", expectTotal: 155000 },
  { name: "Hope16", qty: 1, price: 207000, disc: 15000, expectBps: 724, expectBand: "blocked", expectTotal: 192000 },
];

let failed = 0;
for (const l of lines) {
  const value = l.price * l.qty;
  const total = value - l.disc;
  const bps = discountBps(l.disc, value);
  const band = lineBand(bps);
  const ok =
    bps === l.expectBps &&
    band === l.expectBand &&
    total === l.expectTotal;
  console.log(
    `${ok ? "OK" : "FAIL"} ${l.name}: value=${value} disc%=${bps} band=${band} total=${total}`,
  );
  if (!ok) failed++;
}

const without3 = 202000 + 155000;
const with3 = without3 + 192000;
const rate = 8200;
const sdgWithout = usdCentsToSdg(without3, rate);
const sdgWith = usdCentsToSdg(with3, rate);

console.log(
  `${without3 === 357000 && sdgWithout === 29274000 ? "OK" : "FAIL"} without line3: $${without3 / 100} = ${sdgWithout} SDG`,
);
console.log(
  `${with3 === 549000 && sdgWith === 45018000 ? "OK" : "FAIL"} with approval: $${with3 / 100} = ${sdgWith} SDG`,
);

if (without3 !== 357000 || sdgWithout !== 29274000) failed++;
if (with3 !== 549000 || sdgWith !== 45018000) failed++;

process.exit(failed ? 1 : 0);
