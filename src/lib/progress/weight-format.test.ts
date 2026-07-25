import assert from "node:assert/strict";

import { formatKg, formatKgNullable } from "@/lib/progress/weight-format";

assert.equal(formatKgNullable(null), "—");
assert.equal(formatKgNullable(undefined), "—");
assert.equal(formatKgNullable(Number.NaN), "—");
assert.equal(formatKgNullable(Number.POSITIVE_INFINITY), "—");
assert.equal(formatKgNullable(0), "0 kg");
assert.equal(formatKgNullable(12.5), "12,5 kg");
assert.equal(formatKgNullable(12.345), formatKg(12.345), "reutiliza la regla canonica de formatKg");

console.log("weight-format tests passed");
