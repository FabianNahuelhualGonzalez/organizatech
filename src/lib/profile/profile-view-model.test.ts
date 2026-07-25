import assert from "node:assert/strict";

import {
  buildProfileViewModel,
  buildProfileViewModelFromSources,
  type ProfileViewModelSourcesInput,
} from "@/lib/profile/profile-view-model";

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

function testProfileSourcesPreferPersonalDataAndCurrentAvatar() {
  const profile = buildProfileViewModelFromSources({
    personalData: {
      displayName: "Perfil Supabase",
      email: "PROFILE@EMAIL.COM",
      avatarPath: "profile/avatar",
    },
    sessionDisplayName: "Nombre de sesión",
    sessionEmail: "session@email.com",
    dataSource: "local",
    canEditPersonalData: true,
    avatar: {
      avatarPath: "current/avatar",
      avatarUrl: "https://signed.example/avatar",
    },
  });

  assert.equal(profile.displayName, "Perfil Supabase");
  assert.equal(profile.email, "profile@email.com");
  assert.equal(profile.avatarPath, "current/avatar");
  assert.equal(profile.avatarUrl, "https://signed.example/avatar");
  assert.equal(profile.isConnectedAccount, true);
}

function testProfileSourcesUseSessionWhenPersonalDataIsNull() {
  const profile = buildProfileViewModelFromSources({
    personalData: null,
    sessionDisplayName: "Cuenta local",
    sessionEmail: "LOCAL@EMAIL.COM",
    dataSource: "local",
    canEditPersonalData: false,
    avatar: {
      avatarPath: null,
      avatarUrl: null,
    },
  });

  assert.equal(profile.displayName, "Cuenta local");
  assert.equal(profile.email, "local@email.com");
  assert.equal(profile.accountLabel, "Cuenta local");
  assert.equal(profile.isConnectedAccount, false);
}

function testProfileSourcesUseSessionForNullAndUndefinedFields() {
  const fromNullFields = buildProfileViewModelFromSources({
    personalData: {
      displayName: null,
      email: null,
      avatarPath: null,
    },
    sessionDisplayName: "Nombre de sesión",
    sessionEmail: "SESSION@EMAIL.COM",
    dataSource: "supabase",
    canEditPersonalData: true,
    avatar: {
      avatarPath: null,
      avatarUrl: null,
    },
  });
  const fromUndefinedFields = buildProfileViewModelFromSources({
    personalData: {},
    sessionDisplayName: "Nombre de sesión",
    sessionEmail: "SESSION@EMAIL.COM",
    dataSource: "supabase",
    canEditPersonalData: true,
    avatar: {
      avatarPath: null,
      avatarUrl: null,
    },
  });

  assert.deepEqual(fromNullFields, fromUndefinedFields);
  assert.equal(fromNullFields.displayName, "Nombre de sesión");
  assert.equal(fromNullFields.email, "session@email.com");
}

function testProfileSourcesPreserveEmptyStringPrecedence() {
  const profile = buildProfileViewModelFromSources({
    personalData: {
      displayName: "",
      email: "",
      avatarPath: "persisted/avatar",
    },
    sessionDisplayName: "Nombre de sesión",
    sessionEmail: "session@email.com",
    dataSource: "local",
    canEditPersonalData: false,
    avatar: {
      avatarPath: "",
      avatarUrl: "",
    },
  });

  assert.equal(profile.displayName, "Usuario Organizatech");
  assert.equal(profile.email, null);
  assert.equal(profile.avatarPath, null);
  assert.equal(profile.avatarUrl, null);
}

function testProfileSourcesFallbackWhenAllSourcesAreUndefined() {
  const profile = buildProfileViewModelFromSources({
    personalData: undefined,
    sessionDisplayName: undefined,
    sessionEmail: undefined,
    dataSource: "local",
    canEditPersonalData: false,
    avatar: {
      avatarPath: null,
      avatarUrl: null,
    },
  });

  assert.equal(profile.displayName, "Usuario Organizatech");
  assert.equal(profile.email, null);
  assert.equal(profile.avatarInitial, null);
}

function testProfileSourceResolutionIsDeterministicAndIdentityIsolated() {
  const sourceA: ProfileViewModelSourcesInput = {
    personalData: {
      displayName: "Usuario A",
      email: "a@organizatech.app",
      avatarPath: "user-a/avatar",
    },
    sessionDisplayName: "Sesión A",
    sessionEmail: "session-a@organizatech.app",
    dataSource: "supabase",
    canEditPersonalData: true,
    avatar: {
      avatarPath: "user-a/avatar",
      avatarUrl: "https://signed.example/user-a",
    },
  };
  const sourceABefore = structuredClone(sourceA);
  const firstA = buildProfileViewModelFromSources(sourceA);
  const secondA = buildProfileViewModelFromSources(sourceA);

  assert.deepEqual(firstA, secondA);
  assert.notEqual(firstA, secondA);
  assert.deepEqual(sourceA, sourceABefore);

  const profileB = buildProfileViewModelFromSources({
    personalData: {
      displayName: "Usuario B",
      email: "b@organizatech.app",
      avatarPath: "user-b/avatar",
    },
    sessionDisplayName: "Sesión B",
    sessionEmail: "session-b@organizatech.app",
    dataSource: "supabase",
    canEditPersonalData: true,
    avatar: {
      avatarPath: "user-b/avatar",
      avatarUrl: "https://signed.example/user-b",
    },
  });

  assert.equal(firstA.displayName, "Usuario A");
  assert.equal(firstA.avatarPath, "user-a/avatar");
  assert.equal(profileB.displayName, "Usuario B");
  assert.equal(profileB.avatarPath, "user-b/avatar");
  assert.notDeepEqual(firstA, profileB);
}

testProfileSourcesPreferPersonalDataAndCurrentAvatar();
testProfileSourcesUseSessionWhenPersonalDataIsNull();
testProfileSourcesUseSessionForNullAndUndefinedFields();
testProfileSourcesPreserveEmptyStringPrecedence();
testProfileSourcesFallbackWhenAllSourcesAreUndefined();
testProfileSourceResolutionIsDeterministicAndIdentityIsolated();
