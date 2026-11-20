// One-time cleanup for ticket 82: remove every enrolled TOTP factor so no
// account is left half-enrolled after the second factor left the staff
// stack. Run against the deployed project's environment (the same variables
// the app itself uses) after it has been redeployed:
//
//   npx tsx scripts/remove-enrolled-factors.ts
//
// Factors are deleted through the Supabase Auth admin API, so the script
// refuses to run unless the configured keys identify the project. Auth
// sessions are left alone: existing aal1 sessions stay valid across the
// deploy by design. Idempotent — a second run finds nothing to delete.
import { createClient } from "@supabase/supabase-js";
import { supabaseConfiguration } from "../src/auth/supabase-provider";

const configuration = supabaseConfiguration();
const admin = createClient(configuration.url, configuration.secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

let removed = 0;
let users = 0;
for (let page = 1; ; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  for (const user of data.users) {
    users += 1;
    const listed = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    if (listed.error) throw listed.error;
    for (const factor of listed.data.factors) {
      if (factor.factor_type !== "totp") continue;
      const removedFactor = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
      if (removedFactor.error) throw removedFactor.error;
      console.log(`removed factor ${factor.id} (status ${factor.status}) from user ${user.id}`);
      removed += 1;
    }
  }
  if (data.users.length < 100) break;
}
console.log(`scanned ${users} auth users; removed ${removed} TOTP factor(s)`);
if (removed === 0) console.log("nothing to delete — cleanup already complete");
