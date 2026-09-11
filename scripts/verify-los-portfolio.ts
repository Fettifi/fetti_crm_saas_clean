// Guard for lib/losPortfolio.ts. Every assertion below is written so it FAILS if the rule it
// protects is removed — the point is not that the module works, it is that the refusals refuse.
import {
  emptyPortfolio, addProperty, updateProperty, dropProperty, setPrimary,
  rollup, purposeClass, primaryProperty, activeProperties, isFail, fromUwPortfolio,
  type FilePortfolio, type FileProperty,
} from "../lib/losPortfolio";

let failures = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { console.log(`   PASS  ${name}`); return; }
  failures++; console.log(`   FAIL  ${name}${extra ? "  — " + extra : ""}`);
};
const NOW = "2026-09-11T00:00:00.000Z";
let n = 0;
const uid = () => `id-${++n}`;

const add = (p: FilePortfolio, o: Partial<FileProperty> & { address: string }) => {
  const r = addProperty(p, o, uid(), NOW);
  if (isFail(r)) throw new Error("unexpected add failure: " + r.error);
  return r.portfolio;
};

console.log("\n── lib/losPortfolio guard ──────────────────────────────────\n");

// 1. A prospect must NEVER be counted as exposure. This is the rule that stops a portfolio file
//    inflating company volume, a shopping-sheet LTV and a pre-approval letter.
{
  let p = emptyPortfolio("f1", "Bryant", NOW);
  p = add(p, { address: "615-617 N Temple Ave", price: 195000, status: "under_contract", contract_price: 195000, occupancy: "Investment" });
  p = add(p, { address: "646-648 N Temple Ave", price: 195000, status: "under_contract", contract_price: 195000, occupancy: "Investment" });
  p = add(p, { address: "1820 Waugh St", price: 500000, status: "identified", occupancy: "Investment" });
  const r = rollup(p);
  ok("committed_value sums ONLY committed properties", r.committed_value === 390000, `got ${r.committed_value}`);
  ok("an identified property is reported apart, not blended", r.identified_value === 500000, `got ${r.identified_value}`);
  ok("no field exists that silently blends the two",
     !Object.keys(r).some((k) => /^(total|portfolio)_value$/.test(k)), Object.keys(r).join(","));
  ok("counts split committed vs identified", r.committed_count === 2 && r.identified_count === 1);
}

// 2. Reg Z § 1026.3(a): one extension of credit has ONE purpose. A mixed set must REFUSE, not guess.
{
  let p = emptyPortfolio("f2", "Mixed", NOW);
  p = add(p, { address: "1 Investment Way", occupancy: "Investment" });
  ok("all-investment reads business-purpose", purposeClass(p).cls === "business");
  p = add(p, { address: "2 Home Street", occupancy: "Primary residence" });
  ok("MIXED occupancy refuses rather than guessing", purposeClass(p).cls === "mixed_unresolved", purposeClass(p).cls);
  ok("the refusal explains itself", /one purpose under Reg Z/i.test(purposeClass(p).reason));
  let q = emptyPortfolio("f3", "Consumer", NOW);
  q = add(q, { address: "3 Home Street", occupancy: "Primary residence" });
  ok("all-residence reads consumer", purposeClass(q).cls === "consumer");
  ok("no occupancy at all reads unknown, not business", purposeClass(emptyPortfolio("f4", "Empty", NOW)).cls === "unknown");
}

// 3. Dropping is a tombstone with a reason, never a silent delete.
{
  let p = emptyPortfolio("f5", "Drop", NOW);
  p = add(p, { address: "1 First St" });
  p = add(p, { address: "2 Second St" });
  const noReason = dropProperty(p, p.properties[0].id, "   ", NOW);
  ok("dropping without a reason is refused", isFail(noReason), JSON.stringify(noReason).slice(0, 80));
  const dropped = dropProperty(p, p.properties[0].id, "seller withdrew", NOW);
  if (isFail(dropped)) throw new Error(dropped.error);
  ok("the dropped property is retained, not removed", dropped.properties.length === 2);
  ok("it leaves the active set", activeProperties(dropped).length === 1);
  ok("the reason is kept on the record", dropped.properties[0].dropped_reason === "seller withdrew");
  ok("primary re-points off a dropped property", primaryProperty(dropped)?.address === "2 Second St");
  ok("a dropped property cannot be made primary", isFail(setPrimary(dropped, dropped.properties[0].id, NOW)));
}

// 4. Identity is stable. The underwriter keys rows by array position; anything built on that
//    re-points to a different parcel on the next upload.
{
  let p = emptyPortfolio("f6", "Ids", NOW);
  p = add(p, { address: "1 Alpha St", status: "under_contract" });
  p = add(p, { address: "2 Beta St" });
  const beta = p.properties[1].id;
  const after = dropProperty(p, p.properties[0].id, "fell out", NOW);
  if (isFail(after)) throw new Error(after.error);
  const stillBeta = after.properties.find((x) => x.id === beta);
  ok("an id still resolves to the SAME address after a drop", stillBeta?.address === "2 Beta St", stillBeta?.address);
  const imported = fromUwPortfolio(
    { id: "uw1", name: "Sheet", rows: [{ id: "p0", address: "9 Gamma St" } as never, { id: "p1", address: "10 Delta St" } as never] },
    { loanFileId: "f6", newId: () => uid(), now: NOW });
  ok("imported rows are re-keyed off the underwriter's positional ids",
     imported.properties.every((x) => x.id !== "p0" && x.id !== "p1"), imported.properties.map((x) => x.id).join(","));
  ok("provenance of the import is recorded", imported.source?.id === "uw1");
}

// 5. Input refusals.
{
  let p = emptyPortfolio("f7", "Input", NOW);
  p = add(p, { address: "1 Only Rd" });
  ok("a blank address is refused", isFail(addProperty(p, { address: "  " }, uid(), NOW)));
  ok("a duplicate address is refused", isFail(addProperty(p, { address: "1  only   rd" }, uid(), NOW)));
  ok("status=dropped via update is refused (use the drop action)",
     isFail(updateProperty(p, p.properties[0].id, { status: "dropped" }, NOW)));
  ok("an unknown property id is refused", isFail(updateProperty(p, "nope", { price: 1 }, NOW)));
}

// 6. An import must be FAITHFUL. A property added without its taxes/rehab/ARV looks complete on
//    screen and is useless to underwritePortfolio(), which is the whole reason for carrying them.
{
  let p = emptyPortfolio("f8", "Fidelity", NOW);
  p = add(p, { address: "1 Full St", price: 100000, rent_monthly: 1200, taxes_annual: 2400,
               insurance_annual: 900, rehab_budget: 35000, arv: 180000, back_tax_status: "owed",
               back_tax_amount: 1500, hoa_monthly: 50 });
  const x = p.properties[0];
  ok("taxes_annual survives the add", x.taxes_annual === 2400, String(x.taxes_annual));
  ok("insurance_annual survives", x.insurance_annual === 900, String(x.insurance_annual));
  ok("rehab_budget survives", x.rehab_budget === 35000, String(x.rehab_budget));
  ok("arv survives", x.arv === 180000, String(x.arv));
  ok("hoa_monthly survives", x.hoa_monthly === 50, String(x.hoa_monthly));
  ok("back_tax_status/amount survive", x.back_tax_status === "owed" && x.back_tax_amount === 1500);
  ok("a bogus back_tax_status falls back to unknown",
     (() => { const q = add(emptyPortfolio("f9","B",NOW), { address: "2 Bad St", back_tax_status: "nonsense" as never }); return q.properties[0].back_tax_status === "unknown"; })());
}

console.log(`\n${failures === 0 ? "   all guards passed" : `   ${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
