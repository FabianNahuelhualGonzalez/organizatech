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
    avatarUpdatedAt: avatarPath ? "2026-08-04T12:00:00.000Z" : null,
  };
}

function avatar(userId: string): ProfileAvatarState {
  return {
    avatarPath: `${userId}/avatar`,
    avatarUrl: `https://signed.invalid/${userId}`,
    avatarUpdatedAt: "2026-08-04T12:00:00.000Z",
  };
}

function versionedAvatar(
  userId: string,
  version: string,
  avatarPath = `${userId}/avatar`,
): ProfileAvatarState {
  return {
    avatarPath,
    avatarUrl: `https://signed.invalid/${userId}?version=${version}`,
    avatarUpdatedAt: `2026-08-0${version}T12:00:00.000Z`,
  };
}

function emptyAvatar(): ProfileAvatarState {
  return {
    avatarPath: null,
    avatarUrl: null,
    avatarUpdatedAt: null,
  };
}

function harness(
  source: ProfileDataSource,
  options: {
    now?: number;
    preloadAvatarImage?: (avatarUrl: string | null) => Promise<boolean>;
  } = {},
) {
  let epoch = createSessionDataEpoch({ userId: USER_A, scope: SCOPE_A });
  let currentNow = options.now ?? 100_000;
  const controller = createProfileController({
    identity: {
      captureRequestToken: () => captureSessionDataRequestToken(epoch),
      isRequestTokenCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
    },
    source,
    now: () => currentNow,
    preloadAvatarImage: options.preloadAvatarImage,
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
    advanceTime(milliseconds: number) {
      currentNow += milliseconds;
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

test("menú abierto tras bootstrap consume avatar precargado sin nuevos repository reads", async () => {
  let profileReads = 0;
  let avatarReads = 0;
  const preloadedUrls: Array<string | null> = [];
  const { controller } = harness(immediateSource({
    readProfile: async (userId) => {
      profileReads += 1;
      return profile(userId, "A", `${userId}/avatar`);
    },
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatar(userId);
    },
  }), {
    preloadAvatarImage: async (avatarUrl) => {
      preloadedUrls.push(avatarUrl);
      return true;
    },
  });

  await controller.bootstrap();
  const menuAvatar = controller.getSnapshot().profileAvatar;

  assert.equal(profileReads, 1);
  assert.equal(avatarReads, 1);
  assert.deepEqual(preloadedUrls, [`https://signed.invalid/${USER_A}`]);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
  assert.equal(menuAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);
});

test("metadatos v1 -> v2 dentro de ventana fresca renuevan path y URL sin lookup extra", async () => {
  const v1 = versionedAvatar(USER_A, "1");
  const v2 = versionedAvatar(USER_A, "2", `${USER_A}/avatar-v2`);
  let avatarReads = 0;
  let profileReads = 0;
  const { controller } = harness(immediateSource({
    readProfile: async () => {
      profileReads += 1;
      return {
        ...profile(USER_A, "A", v1.avatarPath),
        avatarUpdatedAt: v1.avatarUpdatedAt,
      };
    },
    readAvatar: async () => {
      avatarReads += 1;
      return avatarReads === 1 ? v1 : v2;
    },
    saveProfile: async () => ({
      ...profile(USER_A, "A", v2.avatarPath),
      avatarUpdatedAt: v2.avatarUpdatedAt,
    }),
  }), { preloadAvatarImage: async () => true });

  await controller.bootstrap();
  await controller.saveProfile({ firstName: "A" });
  assert.equal((await controller.foreground())?.avatarUrl, v2.avatarUrl);
  assert.equal(profileReads, 1);
  assert.equal(avatarReads, 2);
});

test("mismo path con avatarUpdatedAt distinto invalida hit fresco y renueva signed URL", async () => {
  const v1 = versionedAvatar(USER_A, "1");
  const v2 = versionedAvatar(USER_A, "2");
  let avatarReads = 0;
  const { controller } = harness(immediateSource({
    readProfile: async () => ({
      ...profile(USER_A, "A", v1.avatarPath),
      avatarUpdatedAt: v1.avatarUpdatedAt,
    }),
    readAvatar: async () => {
      avatarReads += 1;
      return avatarReads === 1 ? v1 : v2;
    },
    saveProfile: async () => ({
      ...profile(USER_A, "A", v2.avatarPath),
      avatarUpdatedAt: v2.avatarUpdatedAt,
    }),
  }), { preloadAvatarImage: async () => true });

  await controller.bootstrap();
  await controller.saveProfile({ firstName: "A" });
  assert.equal((await controller.foreground())?.avatarUrl, v2.avatarUrl);
  assert.equal(avatarReads, 2);
});

test("la URL nueva no se publica antes de completar preload/decode exitoso", async () => {
  const preload = deferred<boolean>();
  const v1 = versionedAvatar(USER_A, "1");
  const { controller } = harness(immediateSource({
    readAvatar: async () => v1,
  }), { preloadAvatarImage: () => preload.promise });

  const pending = controller.refreshAvatar({ force: true, avatarPath: v1.avatarPath });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);
  preload.resolve(true);
  assert.equal((await pending)?.avatarUrl, v1.avatarUrl);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, v1.avatarUrl);
});

test("preload fallido conserva avatar anterior válido y no publica URL v2", async () => {
  const v1 = versionedAvatar(USER_A, "1");
  const v2 = versionedAvatar(USER_A, "2");
  let avatarReads = 0;
  let preloadAttempts = 0;
  const { controller } = harness(immediateSource({
    readProfile: async () => ({
      ...profile(USER_A, "A", v1.avatarPath),
      avatarUpdatedAt: v1.avatarUpdatedAt,
    }),
    readAvatar: async () => {
      avatarReads += 1;
      return avatarReads === 1 ? v1 : v2;
    },
    saveProfile: async () => ({
      ...profile(USER_A, "A", v2.avatarPath),
      avatarUpdatedAt: v2.avatarUpdatedAt,
    }),
  }), {
    preloadAvatarImage: async () => {
      preloadAttempts += 1;
      return preloadAttempts === 1;
    },
  });

  await controller.bootstrap();
  await controller.saveProfile({ firstName: "A" });
  assert.equal(await controller.foreground(), null);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, v1.avatarUrl);
  assert.match(controller.getSnapshot().profileAvatarError, /foto de perfil/);
});

test("rechazo de preload sin avatar anterior mantiene estado vacío y error controlado", async () => {
  const v1 = versionedAvatar(USER_A, "1");
  const { controller } = harness(immediateSource({
    readAvatar: async () => v1,
  }), {
    preloadAvatarImage: async () => {
      throw new Error("decode failed");
    },
  });

  assert.equal(
    await controller.refreshAvatar({ force: true, avatarPath: v1.avatarPath }),
    null,
  );
  assert.deepEqual(controller.getSnapshot().profileAvatar, emptyAvatar());
  assert.match(controller.getSnapshot().profileAvatarError, /foto de perfil/);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
});

test("eventos foreground simultáneos comparten una sola operación y una sola precarga", async () => {
  const profileLookup = deferred<ProfilePersonalData>();
  const avatarRead = deferred<ProfileAvatarState>();
  let profileReads = 0;
  let avatarReads = 0;
  let preloads = 0;
  const { controller } = harness(immediateSource({
    readProfile: () => {
      profileReads += 1;
      return profileLookup.promise;
    },
    readAvatar: () => {
      avatarReads += 1;
      return avatarRead.promise;
    },
  }), {
    preloadAvatarImage: async () => {
      preloads += 1;
      return true;
    },
  });

  const focus = controller.foreground();
  const pageshow = controller.foreground();
  const visibilitychange = controller.foreground();
  const online = controller.foreground();
  assert.equal(profileReads, 1);

  profileLookup.resolve(profile(USER_A, "A", `${USER_A}/avatar`));
  await Promise.resolve();
  assert.equal(avatarReads, 1);
  avatarRead.resolve(avatar(USER_A));
  await Promise.all([focus, pageshow, visibilitychange, online]);
  assert.equal(preloads, 1);
});

test("foreground vencido revalida sin borrar avatar ni publicar loading visible", async () => {
  const refreshedAvatar = deferred<ProfileAvatarState>();
  let avatarReads = 0;
  const { controller, advanceTime } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarReads += 1;
      if (avatarReads === 1) return avatar(userId);
      return refreshedAvatar.promise;
    },
  }));

  await controller.bootstrap();
  advanceTime(46_000);
  const pending = controller.foreground();
  assert.equal(avatarReads, 2);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_A}`);

  refreshedAvatar.resolve({
    ...avatar(USER_A),
    avatarUrl: `https://signed.invalid/${USER_A}?version=2`,
  });
  await pending;
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
  assert.match(controller.getSnapshot().profileAvatar.avatarUrl ?? "", /version=2/);
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

test("upload invalida reads anteriores y también los iniciados mientras el write vigente domina", async () => {
  const reads = [deferred<ProfileAvatarState>(), deferred<ProfileAvatarState>()];
  const upload = deferred<ProfileAvatarState>();
  let readIndex = 0;
  const { controller } = harness(immediateSource({
    readAvatar: () => reads[readIndex++].promise,
    uploadAvatar: () => upload.promise,
  }), { preloadAvatarImage: async () => true });

  const beforeUpload = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  const pendingUpload = controller.uploadAvatar({} as File);
  reads[0].resolve(versionedAvatar(USER_A, "1"));
  assert.equal(await beforeUpload, null);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);

  const duringUpload = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  const uploaded = versionedAvatar(USER_A, "2");
  upload.resolve(uploaded);
  assert.equal(await pendingUpload, true);
  reads[1].resolve(versionedAvatar(USER_A, "1"));
  assert.equal(await duringUpload, null);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, uploaded.avatarUrl);
});

test("upload invalida memoria anterior, bloquea foreground redundante y precarga la URL nueva", async () => {
  const upload = deferred<ProfileAvatarState>();
  let avatarReads = 0;
  const preloadedUrls: Array<string | null> = [];
  const { controller } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatar(userId);
    },
    uploadAvatar: () => upload.promise,
  }), {
    preloadAvatarImage: async (avatarUrl) => {
      preloadedUrls.push(avatarUrl);
      return true;
    },
  });

  await controller.bootstrap();
  const pendingUpload = controller.uploadAvatar({} as File);
  assert.equal((await controller.foreground())?.avatarUrl, `https://signed.invalid/${USER_A}`);
  assert.equal(avatarReads, 1);

  const uploadedAvatar = {
    ...avatar(USER_A),
    avatarUrl: `https://signed.invalid/${USER_A}?upload=2`,
  };
  upload.resolve(uploadedAvatar);
  assert.equal(await pendingUpload, true);
  assert.deepEqual(preloadedUrls, [
    `https://signed.invalid/${USER_A}`,
    `https://signed.invalid/${USER_A}?upload=2`,
  ]);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, uploadedAvatar.avatarUrl);
  await controller.foreground();
  assert.equal(avatarReads, 1);
});

test("upload fallido no reutiliza la entrada anterior y permite reconstruirla por foreground", async () => {
  let avatarReads = 0;
  const { controller } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatar(userId);
    },
    uploadAvatar: async () => {
      throw new Error("upload failed");
    },
  }));

  await controller.bootstrap();
  await assert.rejects(controller.uploadAvatar({} as File), /upload failed/);
  await controller.foreground();
  assert.equal(avatarReads, 2);
});

test("preload fallido del upload no publica ni versiona la URL nueva", async () => {
  const v1 = versionedAvatar(USER_A, "1");
  const v2 = versionedAvatar(USER_A, "2");
  let preloadAttempts = 0;
  const { controller } = harness(immediateSource({
    readProfile: async () => ({
      ...profile(USER_A, "A", v1.avatarPath),
      avatarUpdatedAt: v1.avatarUpdatedAt,
    }),
    readAvatar: async () => v1,
    uploadAvatar: async () => v2,
  }), {
    preloadAvatarImage: async () => {
      preloadAttempts += 1;
      return preloadAttempts === 1;
    },
  });

  await controller.bootstrap();
  await assert.rejects(controller.uploadAvatar({} as File), /No pudimos guardar la foto/);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, v1.avatarUrl);
  assert.equal(controller.getSnapshot().profilePersonalData?.avatarUpdatedAt, v1.avatarUpdatedAt);
  assert.match(controller.getSnapshot().profileAvatarError, /foto de perfil/);
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
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);
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

test("retry de error de imagen salta memoria fresca y foreground se une sin read duplicado", async () => {
  const retryRead = deferred<ProfileAvatarState>();
  let avatarReads = 0;
  const { controller } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarReads += 1;
      if (avatarReads === 1) return avatar(userId);
      return retryRead.promise;
    },
  }));

  await controller.bootstrap();
  const imageErrorRetry = controller.refreshAvatar({
    force: true,
    allowProfileLookup: true,
    publishProfileLookup: false,
    foreground: true,
    publishLoading: false,
  });
  const simultaneousForeground = controller.foreground();
  assert.equal(avatarReads, 2);
  assert.equal(controller.getSnapshot().profileAvatarLoading, false);

  retryRead.resolve({
    ...avatar(USER_A),
    avatarUrl: `https://signed.invalid/${USER_A}?retry=2`,
  });
  await Promise.all([imageErrorRetry, simultaneousForeground]);
  assert.equal(avatarReads, 2);
  assert.match(controller.getSnapshot().profileAvatar.avatarUrl ?? "", /retry=2/);
});

test("eliminación remota invalida la entrada de memoria y no revive la signed URL anterior", async () => {
  let avatarReads = 0;
  const { controller } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatarReads === 1 ? avatar(userId) : emptyAvatar();
    },
  }));

  await controller.bootstrap();
  assert.deepEqual(
    await controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` }),
    emptyAvatar(),
  );
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);
  assert.deepEqual(await controller.foreground(), emptyAvatar());
  assert.equal(avatarReads, 3);
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

test("respuesta A que espera precarga no publica ni cachea después de cambiar a B", async () => {
  const preloadA = deferred<boolean>();
  let avatarReads = 0;
  const { controller, switchToB } = harness(immediateSource({
    readAvatar: async (userId) => {
      avatarReads += 1;
      return avatar(userId);
    },
  }), {
    preloadAvatarImage: (avatarUrl) => avatarUrl?.includes(USER_A)
      ? preloadA.promise
      : Promise.resolve(true),
  });

  const requestA = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  await Promise.resolve();
  switchToB();
  preloadA.resolve(true);
  assert.equal(await requestA, null);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, null);

  await controller.refreshAvatar({ force: true, avatarPath: `${USER_B}/avatar` });
  assert.equal(avatarReads, 2);
  assert.equal(controller.getSnapshot().profileAvatar.avatarUrl, `https://signed.invalid/${USER_B}`);
});

test("dispose durante precarga invalida la operación pendiente y no publica", async () => {
  const preload = deferred<boolean>();
  const { controller } = harness(immediateSource(), {
    preloadAvatarImage: () => preload.promise,
  });

  const pending = controller.refreshAvatar({ force: true, avatarPath: `${USER_A}/avatar` });
  await Promise.resolve();
  controller.dispose();
  preload.resolve(true);
  assert.equal(await pending, null);
  assert.deepEqual(controller.getSnapshot().profileAvatar, emptyAvatar());
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
