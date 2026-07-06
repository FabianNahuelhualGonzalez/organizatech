import assert from "node:assert/strict";

import { buildProfileViewModel } from "@/lib/profile/profile-view-model";

{
  const profile = buildProfileViewModel({
    displayName: "Fabian Elias Nahuelhual",
    email: "FABIAN@EMAIL.COM",
    dataSource: "supabase",
  });

  assert.equal(profile.displayName, "Fabian Elias Nahuelhual");
  assert.equal(profile.email, "fabian@email.com");
  assert.equal(profile.secondaryLabel, "fabian@email.com");
  assert.equal(profile.accountLabel, "Cuenta conectada");
  assert.equal(profile.avatarInitial, "F");
  assert.equal(profile.isConnectedAccount, true);
}

{
  const profile = buildProfileViewModel({
    displayName: "",
    email: "entrenador@organizatech.app",
    dataSource: "supabase",
  });

  assert.equal(profile.displayName, "entrenador");
  assert.equal(profile.secondaryLabel, "entrenador@organizatech.app");
  assert.equal(profile.avatarInitial, "E");
}

{
  const profile = buildProfileViewModel({
    displayName: null,
    email: null,
    dataSource: "local",
  });

  assert.equal(profile.displayName, "Usuario Organizatech");
  assert.equal(profile.secondaryLabel, "Cuenta local");
  assert.equal(profile.accountLabel, "Cuenta local");
  assert.equal(profile.avatarInitial, null);
  assert.equal(profile.isConnectedAccount, false);
}

{
  const profile = buildProfileViewModel({
    displayName: "   Carla Andrea   ",
    email: null,
    dataSource: "local",
  });

  assert.equal(profile.displayName, "Carla Andrea");
  assert.equal(profile.avatarInitial, "C");
}

{
  const profile = buildProfileViewModel({
    displayName: "Fabian",
    email: "fabian@email.com",
    dataSource: "supabase",
    avatarUrl: "https://example.com/avatar.webp",
    avatarPath: "user-id/avatar.webp",
  });

  assert.equal(profile.avatarUrl, "https://example.com/avatar.webp");
  assert.equal(profile.avatarPath, "user-id/avatar.webp");
}
