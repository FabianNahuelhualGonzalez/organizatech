import assert from "node:assert/strict";

import {
  buildDisplayName,
  buildProfilePersonalDataPayload,
  calculateAgeFromBirthDate,
  createInitialProfileInsertPayload,
  deriveNamePartsFromDisplayName,
  isProfileGender,
  resolveEnsureProfileWrite,
} from "@/lib/profile/profile-form";

const referenceDate = new Date(2026, 6, 6);

{
  assert.deepEqual(deriveNamePartsFromDisplayName("Fabian Elias Nahuelhual"), {
    firstName: "Fabian",
    lastName: "Elias Nahuelhual",
  });
  assert.deepEqual(deriveNamePartsFromDisplayName("Fabian"), {
    firstName: "Fabian",
    lastName: "",
  });
  assert.deepEqual(deriveNamePartsFromDisplayName("  Fabian   Elias   Nahuelhual  "), {
    firstName: "Fabian",
    lastName: "Elias Nahuelhual",
  });
  assert.deepEqual(deriveNamePartsFromDisplayName(null), {
    firstName: "",
    lastName: "",
  });
}

{
  assert.equal(buildDisplayName("Fabian", "Nahuelhual"), "Fabian Nahuelhual");
  assert.equal(buildDisplayName(" Fabian ", ""), "Fabian");
  assert.equal(buildDisplayName("Fabian", null), "Fabian");
}

{
  assert.equal(calculateAgeFromBirthDate(null, referenceDate), null);
  assert.equal(calculateAgeFromBirthDate("1990-07-06", referenceDate), 36);
  assert.equal(calculateAgeFromBirthDate("1990-07-07", referenceDate), 35);
  assert.equal(calculateAgeFromBirthDate("fecha", referenceDate), null);
}

{
  assert.equal(buildProfilePersonalDataPayload({ firstName: "", gender: "male" }, referenceDate).ok, false);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "   ", gender: "male" }, referenceDate).ok, false);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", gender: "male" }, referenceDate).ok, true);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "a".repeat(81), gender: "male" }, referenceDate).ok, false);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", lastName: "a".repeat(121), gender: "male" }, referenceDate).ok, false);
}

{
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", birthDate: null, gender: "male" }, referenceDate).ok, true);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", birthDate: "2016-07-06", gender: "male" }, referenceDate).ok, true);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", birthDate: "2026-07-07", gender: "male" }, referenceDate).ok, false);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", birthDate: "2026-02-31", gender: "male" }, referenceDate).ok, false);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", birthDate: "2017-07-06", gender: "male" }, referenceDate).ok, false);
  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", birthDate: "1925-07-06", gender: "male" }, referenceDate).ok, false);
}

{
  assert.equal(isProfileGender("male"), true);
  assert.equal(isProfileGender("female"), true);
  assert.equal(isProfileGender("non_binary"), true);
  assert.equal(isProfileGender("prefer_not_to_say"), true);
  assert.equal(isProfileGender("not_specified"), true);
  assert.equal(isProfileGender("otro"), false);

  assert.equal(buildProfilePersonalDataPayload({ firstName: "Fabian", gender: "otro" }, referenceDate).ok, false);
}

{
  const result = buildProfilePersonalDataPayload({
    firstName: "  Fabian  ",
    lastName: "  Elias   Nahuelhual ",
    birthDate: "1990-07-06",
    gender: null,
  }, referenceDate);

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, {
    first_name: "Fabian",
    last_name: "Elias Nahuelhual",
    birth_date: "1990-07-06",
    gender: "not_specified",
    display_name: "Fabian Elias Nahuelhual",
  });

  const maleResult = buildProfilePersonalDataPayload({
    firstName: "Fabian",
    gender: "male",
  }, referenceDate);

  assert.equal(maleResult.ok, true);
  assert.equal(maleResult.payload?.gender, "male");
}

{
  const payload = createInitialProfileInsertPayload({
    userId: "user-1",
    email: "FABIAN@EMAIL.COM",
  });

  assert.deepEqual(payload, {
    id: "user-1",
    email: "fabian@email.com",
    display_name: "fabian",
    gender: "not_specified",
  });

  assert.equal(createInitialProfileInsertPayload({ userId: "user-2", email: "", displayName: "Fabian QA" }).display_name, "Fabian QA");
}

{
  const decision = resolveEnsureProfileWrite({
    existing: { id: "user-1", email: "old@email.com" },
    userId: "user-1",
    email: "new@email.com",
  });

  assert.deepEqual(decision, { type: "update-email", email: "new@email.com" });
}

{
  const decision = resolveEnsureProfileWrite({
    existing: { id: "user-1", email: "fabian@email.com" },
    userId: "user-1",
    email: "fabian@email.com",
  });

  assert.deepEqual(decision, { type: "noop" });
}

{
  const decision = resolveEnsureProfileWrite({
    existing: null,
    userId: "user-1",
    email: "fabian@email.com",
  });

  assert.equal(decision.type, "insert");
  if (decision.type === "insert") {
    assert.equal(decision.payload.display_name, "fabian");
    assert.equal(decision.payload.gender, "not_specified");
  }
}
