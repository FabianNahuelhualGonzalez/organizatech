import assert from "node:assert/strict";
import test from "node:test";

import { createProfileController, type ProfileDataSource } from "./profile-controller";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
} from "@/lib/session/session-data-epoch";
import type { ProfilePersonalData } from "@/lib/profile/profile-repository";
import type { ProfileAvatarState } from "@/lib/profile/profile-avatar";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCOPE_A = `supabase:${USER_A}`;
const SCOPE_B = `supabase:${USER_B}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function profile(userId: string, displayName: string, avatarPath: string | null = null): ProfilePersonalData {
  return {
    id: userId,
    displayName,
    email: `${displayName.toLowerCase()}@example.com`,
    firstName: displayName,
    lastName: null,
    birthDate: null,
    gender: "not_specified",
    phoneNumber: null,
    avatarPath,
    avatarUpdatedAt: null,
  };
}

function avatar(userId: string): ProfileAvatarState {
  return {
    avatarPath: `${userId}/avatar`,
    avatarUrl: `https://signed.invalid/${userId}`,
    avatarUpdatedAt: "2026-08-04T12:00:00.000Z",
  };
}

function emptyAvatar(): ProfileAvatarState {
  return {
    avatarPath: null,
    avatarUrl: null,
    avatarUpdatedAt: null,
  };
}

function harness(source: ProfileDataSource) {
  let epoch = createSessionDataEpoch({ userId: USER_A, scope: SCOPE_A });
  const controller = createProfileController({
    identity: {
      captureRequestToken: () => captureSessionDataRequestToken(epoch),
      isRequestTokenCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
    },
    source,
    now: () => 100_000,
  });
  controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: true });
  return {
    controller,
    signOut() {
      epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null });
      controller.invalidateIdentity();
    },
    reloginA(prepared = true) {
      epoch = advanceSessionDataEpoch(epoch, { userId: USER_A, scope: SCOPE_A });
      controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: prepared });
    },
    advanceSameUserGeneration(prepared = true) {
      epoch = advanceSessionDataEpoch(epoch, { userId: USER_A, scope: SCOPE_A }, { force: true });
      controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: prepared });
    },
    switchToB(prepared = true) {
      epoch = advanceSessionDataEpoch(epoch, { userId: USER_B, scope: SCOPE_B });
      controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: prepared });
    },
  };
}

function immediateSource(overrides: Partial<ProfileDataSource> = {}): ProfileDataSource {
  return {
    readProfile: async (userId) => profile(userId, userId === USER_A ? "A" : "B", `${userId}/avatar`),
    readAvatar: async (userId) => avatar(userId),
    saveProfile: async (_input, userId) => profile(userId, userId === USER_A ? "A saved" : "B saved"),
    uploadAvatar: async (_file, userId) => avatar(userId),
    ...overrides,
  };
}

test("read A -> SIGNED_OUT -> B no publica ni apaga loading B", async () => {
  const reads = [deferred<ProfilePersonalData>(), deferred<ProfilePersonalData>()];
  const avatars = [deferred<ProfileAvatarState>()];
  let readIndex = 0;
  const { controller, signOut, switchToB } = harness(immediateSource({
    readProfile: () => reads[readIndex++].promise,
    readAvatar: () => avatars[0].promise,
  }));

  const requestA = controller.refreshProfile();
  signOut();
  switchToB();
  const requestB = controller.refreshProfile();
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, true);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);

  reads[0].resolve(profile(USER_A, "A"));
  await requestA;
  assert.equal(controller.getSnapshot().profilePersonalData, null);
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, true);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);

  reads[1].resolve(profile(USER_B, "B", `${USER_B}/avatar`));
  avatars[0].resolve(avatar(USER_B));
  await requestB;
  assert.equal(controller.getSnapshot().profilePersonalData?.id, USER_B);
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, false);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("dos reads de la misma identidad aplican latest-request-wins y stale finally no publica", async () => {
  const reads = [deferred<ProfilePersonalData>(), deferred<ProfilePersonalData>()];
  let readIndex = 0;
  const { controller } = harness(immediateSource({
    readProfile: () => reads[readIndex++].promise,
    readAvatar: async () => ({ avatarPath: null, avatarUrl: null, avatarUpdatedAt: null }),
  }));
  const first = controller.refreshProfile();
  const second = controller.refreshProfile();
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, true);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);
  reads[0].resolve(profile(USER_A, "Antiguo"));
  await first;
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, true);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);
  reads[1].resolve(profile(USER_A, "Último"));
  await second;
  assert.equal(controller.getSnapshot().profilePersonalData?.displayName, "Último");
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, false);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("bootstrap con avatar existente publica la URL derivada y el reset vigente", async () => {
  let profileReads = 0;
  let avatarReads = 0;
  const { controller } = harness(immediateSource({
    readProfile: async (userId) => {
      profileReads += 1;
      return profile(userId, "A", `${userId}/avatar`);
    },
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatar(userId);
    },
  }));

  assert.equal((await controller.bootstrap())?.id, USER_A);
  assert.equal(profileReads, 1);
  assert.equal(avatarReads, 1);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarResetKey, 2);
});

test("bootstrap no cachea un avatar fallido y el siguiente intento puede recuperarlo", async () => {
  let avatarAttempts = 0;
  const { controller } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarAttempts += 1;
      if (avatarAttempts === 1) throw new Error("signed URL unavailable");
      return avatar(userId);
    },
  }));

  assert.equal((await controller.bootstrap())?.id, USER_A);
  assert.equal(avatarAttempts, 1);
  assert.match(controller.getSnapshot().profileAvatarError, /foto de perfil/);
  assert.equal((await controller.bootstrap())?.id, USER_A);
  assert.equal(avatarAttempts, 2);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarError, "");
});

test("dos reads de avatar: vacío antiguo no pisa URL nueva y stale finally no apaga loading", async () => {
  const avatarReads = [deferred<ProfileAvatarState>(), deferred<ProfileAvatarState>()];
  let readIndex = 0;
  const { controller } = harness(immediateSource({
    readAvatar: () => avatarReads[readIndex++].promise,
  }));

  const first = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  const second = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  avatarReads[0].resolve(emptyAvatar());
  assert.equal(await first, null);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);

  avatarReads[1].resolve(avatar(USER_A));
  await second;
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("bootstrap y entrada a Profile concurrentes dejan sólo la publicación vigente", async () => {
  const profileReads = [deferred<ProfilePersonalData>(), deferred<ProfilePersonalData>()];
  const avatarRead = deferred<ProfileAvatarState>();
  let profileReadIndex = 0;
  let publishedAvatarUrls = 0;
  let lastPublishedAvatarUrl: string | null = null;
  const { controller } = harness(immediateSource({
    readProfile: () => profileReads[profileReadIndex++].promise,
    readAvatar: () => avatarRead.promise,
  }));
  const unsubscribe = controller.subscribe((snapshot) => {
    if (
      snapshot.profileAvatar.avatarUrl &&
      snapshot.profileAvatar.avatarUrl !== lastPublishedAvatarUrl
    ) publishedAvatarUrls += 1;
    lastPublishedAvatarUrl = snapshot.profileAvatar.avatarUrl;
  });

  const bootstrap = controller.bootstrap();
  const profileEntry = controller.refreshProfile();
  profileReads[1].resolve(profile(USER_A, "Vigente", `${USER_A}/avatar`));
  await Promise.resolve();
  avatarRead.resolve(avatar(USER_A));
  await profileEntry;
  profileReads[0].resolve(profile(USER_A, "Antiguo", null));
  await bootstrap;
  unsubscribe();

  assert.equal(publishedAvatarUrls, 1);
  assert.equal(controller.getSnapshot().profilePersonalData?.displayName, "Vigente");
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
});

test("refreshProfile publica ambos loading antes del primer await y mantiene avatar durante su read", async () => {
  const profileRead = deferred<ProfilePersonalData>();
  const avatarRead = deferred<ProfileAvatarState>();
  const { controller } = harness(immediateSource({
    readProfile: () => profileRead.promise,
    readAvatar: () => avatarRead.promise,
  }));

  const pending = controller.refreshProfile();
  assert.deepEqual(
    {
      profile: controller.getSnapshot().profilePersonalDataLoading,
      avatar: controller.getSnapshot().profileAvatarLoading,
    },
    { profile: true, avatar: true },
  );

  profileRead.resolve(profile(USER_A, "A", `${USER_A}/avatar`));
  await Promise.resolve();
  assert.equal(controller.getSnapshot().profilePersonalData?.id, USER_A);
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, true);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);

  avatarRead.resolve(avatar(USER_A));
  await pending;
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, false);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("fallo del primer read finaliza ambos loading sin estado infinito", async () => {
  const profileRead = deferred<ProfilePersonalData>();
  const { controller } = harness(immediateSource({ readProfile: () => profileRead.promise }));
  const pending = controller.refreshProfile();
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, true);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);

  profileRead.reject(new Error("No pudimos cargar tu perfil."));
  assert.equal(await pending, null);
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, false);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
  assert.equal(controller.getSnapshot().profilePersonalDataError, "No pudimos cargar tu perfil.");
  assert.equal(controller.getSnapshot().profileAvatarError, "");
});

test("refreshAvatar directo sólo activa el loading de avatar", async () => {
  const avatarRead = deferred<ProfileAvatarState>();
  const { controller } = harness(immediateSource({ readAvatar: () => avatarRead.promise }));
  const pending = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  assert.equal(controller.getSnapshot().profilePersonalDataLoading, false);
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);
  avatarRead.resolve(avatar(USER_A));
  await pending;
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("save captura owner, usa allowlist y no publica después de A -> B", async () => {
  const write = deferred<ProfilePersonalData>();
  let capturedInput: unknown;
  const { controller, switchToB } = harness(immediateSource({
    saveProfile: async (input) => {
      capturedInput = input;
      return write.promise;
    },
  }));
  const rawInput = {
    firstName: "Ana",
    lastName: "A",
    birthDate: null,
    gender: "female",
    phoneNumber: null,
    user_id: USER_B,
    owner_id: USER_B,
  } as never;
  const pending = controller.saveProfile(rawInput);
  assert.deepEqual(Object.keys(capturedInput as object).sort(), [
    "birthDate",
    "firstName",
    "gender",
    "lastName",
    "phoneNumber",
  ]);
  switchToB();
  write.resolve(profile(USER_A, "Ana A"));
  assert.equal(await pending, null);
  assert.equal(controller.getSnapshot().profilePersonalData, null);
});

test("upload A -> B no publica avatar, URL, reset key ni error bajo B", async () => {
  const upload = deferred<ProfileAvatarState>();
  const { controller, switchToB } = harness(immediateSource({ uploadAvatar: () => upload.promise }));
  const pending = controller.uploadAvatar({} as File);
  switchToB();
  const snapshotB = controller.getSnapshot();
  upload.resolve(avatar(USER_A));
  assert.equal(await pending, false);
  assert.deepEqual(controller.getSnapshot(), snapshotB);
});

test("foreground same-identity refresca avatar sin publicar profile lookup ni resetear formulario local", async () => {
  let profileReads = 0;
  const { controller } = harness(immediateSource({
    readProfile: async () => {
      profileReads += 1;
      return profile(USER_A, "No publicar", `${USER_A}/avatar`);
    },
  }));
  await controller.foreground();
  assert.equal(profileReads, 1);
  assert.equal(controller.getSnapshot().profilePersonalData, null);
  assert.equal(controller.getSnapshot().profileAvatar.avatarPath, `${USER_A}/avatar`);
});

test("foreground anterior al upload no puede borrar la URL recién publicada", async () => {
  const lookup = deferred<ProfilePersonalData>();
  const { controller } = harness(immediateSource({
    readProfile: () => lookup.promise,
  }));

  const foreground = controller.foreground();
  assert.equal(controller.getSnapshot().profileAvatarLoading, true);
  assert.equal(await controller.uploadAvatar({} as File), true);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);

  lookup.resolve(profile(USER_A, "Respuesta antigua", null));
  assert.equal(await foreground, null);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarError, "");
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("error real al firmar URL es controlado y un retry posterior publica avatar", async () => {
  let attempts = 0;
  const { controller } = harness(immediateSource({
    readAvatar: async (userId) => {
      attempts += 1;
      if (attempts === 1) throw new Error("signed URL unavailable");
      return avatar(userId);
    },
  }));

  assert.equal(
    await controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` }),
    null,
  );
  assert.match(controller.getSnapshot().profileAvatarError, /foto de perfil/);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);

  assert.equal((await controller.foreground())?.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarError, "");
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("TOKEN_REFRESHED del mismo owner conserva operación vigente", async () => {
  const write = deferred<ProfilePersonalData>();
  const { controller } = harness(immediateSource({ saveProfile: () => write.promise }));
  const pending = controller.saveProfile({ firstName: "Ana" });
  controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: true });
  write.resolve(profile(USER_A, "Ana"));
  assert.equal((await pending)?.displayName, "Ana");
});

test("TOKEN_REFRESHED del mismo usuario conserva read de avatar vigente", async () => {
  const avatarRead = deferred<ProfileAvatarState>();
  const { controller } = harness(immediateSource({ readAvatar: () => avatarRead.promise }));
  const pending = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: true });
  avatarRead.resolve(avatar(USER_A));
  assert.equal((await pending)?.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("nueva generación del mismo usuario reinicia bootstrap y vuelve a leer avatar", async () => {
  let profileReads = 0;
  let avatarReads = 0;
  const { controller, advanceSameUserGeneration } = harness(immediateSource({
    readProfile: async (userId) => {
      profileReads += 1;
      return profile(userId, "A", `${userId}/avatar`);
    },
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatar(userId);
    },
  }));

  await controller.bootstrap();
  advanceSameUserGeneration();
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);
  await controller.bootstrap();
  assert.equal(profileReads, 2);
  assert.equal(avatarReads, 2);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
});

test("Profile espera preparación de TrainingData y no duplica ensureProfile", async () => {
  let reads = 0;
  const source = immediateSource({
    readProfile: async (userId) => {
      reads += 1;
      return profile(userId, "Preparado", null);
    },
  });
  const { controller } = harness(source);
  controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: false });
  assert.equal(await controller.refreshProfile(), null);
  assert.equal(reads, 0);
  controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: true });
  await controller.bootstrap();
  assert.equal(reads, 1);
});

test("upload permitido durante prerequisite pendiente se reconstruye tras logout/login asentado", async () => {
  let remoteAvatar = emptyAvatar();
  let profileReads = 0;
  let avatarReads = 0;
  const { controller, signOut, reloginA } = harness(immediateSource({
    readProfile: async (userId) => {
      profileReads += 1;
      return profile(userId, "A", remoteAvatar.avatarPath);
    },
    readAvatar: async () => {
      avatarReads += 1;
      return remoteAvatar;
    },
    uploadAvatar: async (_file, userId) => {
      remoteAvatar = avatar(userId);
      return remoteAvatar;
    },
  }));
  controller.replaceIdentityScope({ enabled: true, dataMode: "supabase", trainingDataPrepared: false });

  assert.equal(await controller.bootstrap(), null);
  assert.equal(await controller.uploadAvatar({} as File), true);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
  signOut();
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);
  reloginA(true);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);

  await controller.bootstrap();
  assert.equal(profileReads, 1);
  assert.equal(avatarReads, 1);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
});

test("logout/login explícito del mismo usuario comienza limpio y reconstruye estado remoto", async () => {
  let reads = 0;
  const { controller, signOut, reloginA } = harness(immediateSource({
    readAvatar: async (userId) => {
      reads += 1;
      return {
        ...avatar(userId),
        avatarUrl: `https://signed.invalid/${userId}?generation=${reads}`,
      };
    },
  }));

  await controller.bootstrap();
  assert.match(controller.getSnapshot().profileAvatar.avatarUrl ?? "", /generation=1/);
  signOut();
  assert.deepEqual(controller.getSnapshot().profileAvatar, emptyAvatar());
  reloginA();
  assert.deepEqual(controller.getSnapshot().profileAvatar, emptyAvatar());
  await controller.bootstrap();
  assert.match(controller.getSnapshot().profileAvatar.avatarUrl ?? "", /generation=2/);
});

test("signed URL queda derivada y nunca entra al perfil canónico", async () => {
  const { controller } = harness(immediateSource());
  await controller.refreshProfile();
  await controller.uploadAvatar({} as File);
  const current = controller.getSnapshot();
  assert.equal("avatarUrl" in (current.profilePersonalData ?? {}), false);
  assert.match(current.profileAvatar.avatarUrl ?? "", /^https:\/\/signed\.invalid\//);
});
