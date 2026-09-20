# Coach — integración local de infraestructura auditada

> Registro histórico del lote aislado previo al montaje productivo del 16-09-2026.
> El estado vigente se documenta en `integration-contract.md` y `progress.md`.

Estado: transferencia explícita revisada, coordinada dentro del alcance Coach autorizado; sin commit, push, montaje productivo ni ejecución SQL remota. No copiar carpetas completas ni importar código desde otro worktree en runtime. Cada archivo nuevo se incorpora mediante parche revisado y se verifica contra su hash de origen; los cinco archivos compartidos se combinan semánticamente sin sobreescribir registros ajenos.

Base común: `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`. Destino exclusivo: worktree `organizatech-coach-dashboard-01`, branch `codex/coach-dashboard-01`. Stash protegido `7e618d67efb4290082a4f6be258c1f75640856c8` intacto. Fuentes congeladas y ownership devuelto; revisión independiente read-only de colisiones/imports por coach_domain_closure antes de transferir.

Clasificación principal: **Sin cambio visible**. Declaración secundaria: **Contiene infraestructura visual aislada y no montada**. Sigue pendiente la fase separada de conexión visual; no se toca composition root, rutas, globals ni pantallas productivas.

## Gates de origen

- UI95: 134 focales, suite completa/typecheck/lint/build/diff y Claude delta PASS; contenido `b74234c1f6e8bbbbbd2222eed4984457e0b9fce4649099044a0fd21fddc0234e`.
- DOMAIN13: 77 focales, gates completos y Claude parser delta PASS; contenido `2e8b125729f43cb6135d55108b564954d581567d04135d48aafe684023ed4e99`.
- DATA15: 23 focales, gates completos,64 SQL locales y auditorías Claude PASS; contenido `d3a29186d9b7bb2fef2b69a073c0dfecfecec28b737843e5cf60e0cd3459f238`.
- ROOT controller5 conserva sus15 focales y auditoría independiente PASS. Su código no se reemplaza.

Estos resultados no se heredan como PASS integrado: se requieren nuevos gates y auditoría del conjunto. No equivalen a QA manual ni a migración aplicada en QA.

## Cinco archivos compartidos: fusión explícita

1. `package.json`: conservar scripts previos, sumar los cuatro scripts de UI/model/data al script del controller existente y registrar cada test una sola vez; no cambiar dependencias ni lock.
2. `src/features/active-workout/active-workout-visual-integration-contract.test.ts`: actualizar únicamente el hash de package final, conservando las demás assertions.
3. `src/features/training-plan/training-plan-visual-integration-contract.test.ts`: registrar consumidor aislado canónico `src/ui/coach-overlays/coach-overlay.tsx`.
4. `src/features/user-portal-shell/user-portal-shell-integration.contract.test.ts`: la misma adición exacta de consumidor.
5. `src/features/coach-portal/coach-portal-integration-contract.ts`: registrar sólo la migración privada de preferencias auditada; no ampliar excepciones genéricas.

## Inventario exacto de114 archivos nuevos

### UI — 91 archivos

Origen: `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-ui-01`.

| Archivo | SHA-256 |
| --- | --- |
| `src/features/coach-clients/components/README.md` | `306a8f4b8766ba3ce1c858270b2e61e0af8f43bf4aa0360e399757d653242bcf` |
| `src/features/coach-clients/components/coach-add-client-render.test.ts` | `07742a6f0f6bb92da4d621bb46ceba4da8cad94ed5483421301eb0cb79749ad2` |
| `src/features/coach-clients/components/coach-add-client-sheet.module.css` | `36fe4333d158b2d5ca6565824108f2a31084b63bf48654ff0fd84d555657734d` |
| `src/features/coach-clients/components/coach-add-client-sheet.tsx` | `224acd6fc96ee864ad69bee98fa5b67cd2ef657f873a66e1e46e83824cc36094` |
| `src/features/coach-clients/components/coach-add-client-view.ts` | `0e69106bf80734a24199d7259ebaded365ba7e54864e0f27392b368f01b7254f` |
| `src/features/coach-clients/components/coach-client-code-button.module.css` | `979f0f9b2de88d033c8b17b6c621b72ddc9150b1dad254fbbb1d03487a42a027` |
| `src/features/coach-clients/components/coach-client-code-button.tsx` | `0862b0662be6851e553afd30a3542f0e92bfc17018551c69cba649e2d46c65f8` |
| `src/features/coach-clients/components/coach-client-code-card.module.css` | `9e97d72e88cde2cb7a2d5b36968e10971d7b67b1bf4ec27ec6694c5d38ebfe90` |
| `src/features/coach-clients/components/coach-client-code-card.tsx` | `d760cfc2dc8a18ed07d93e0a5e50f062d0adab4b220ffb6ac6d94396d2601d9e` |
| `src/features/coach-clients/components/coach-client-detail-content.tsx` | `5af68193624850cac4c6c396e5edb78cff25a7a6473a80557d3cc488ddc31400` |
| `src/features/coach-clients/components/coach-client-detail-render.test.ts` | `5b9e2423ab0e8d317e48a13d1ee42b0e3fecadc8e2fe19ea0806d05207980f4c` |
| `src/features/coach-clients/components/coach-client-detail-sheet.module.css` | `baa3aaf3119bc5db20bf9e731a3a5b974148c7ee89cc122d87d904b719b53a4b` |
| `src/features/coach-clients/components/coach-client-detail-sheet.tsx` | `5196d1cfefda694302a54c8027da2e282a2f4148ee775c95d92d8b0b7766c350` |
| `src/features/coach-clients/components/coach-client-detail-view.ts` | `9f7245bceaaf8b2793f847488e89e7b020cc36b2cdffe83479282afff9736074` |
| `src/features/coach-clients/components/coach-client-invitation-steps.module.css` | `93c0bb66cd8863f77ebcf6f3039b0d6be774b404b6ce334bb5142a6653601aad` |
| `src/features/coach-clients/components/coach-client-invitation-steps.tsx` | `9bfd87f3b92ce13faafb911547e2dc6e5dec4df393a91f185e2169461fba8365` |
| `src/features/coach-clients/components/coach-client-invite-email-step.module.css` | `93305b656c3cc80cd3f47dbc0a33bfa4422e738ee8a9c157c8ed15adb2799fc3` |
| `src/features/coach-clients/components/coach-client-invite-email-step.tsx` | `015ee5db1cb8d9720f5d5e46ffda6cea12051c3d3391b16ffad9dad994398f59` |
| `src/features/coach-clients/components/coach-client-invite-receipt-step.module.css` | `750ab2501a5af274140dc19c5b91f5ed9a7c0977784458f2e89892d4a300f165` |
| `src/features/coach-clients/components/coach-client-invite-receipt-step.tsx` | `ad51fc99f439296f01e43fa5a7667ca5680cc464b541e974210a6a937d0a0e2f` |
| `src/features/coach-clients/components/coach-client-row.module.css` | `0e00399e2435dd2fadc3b7f05ddf3d9c6c52c9ac54d341a3c8d55fb6a57e3901` |
| `src/features/coach-clients/components/coach-client-row.tsx` | `a2db317b88a649f6418f52e020d1051f7a2531ebf4e5621f17d16b50c87d6db7` |
| `src/features/coach-clients/components/coach-client-tab-navigation.ts` | `3c45afe75f6c3d1491b1c5fdbe1b620d7bd322f9d8f83da7c9eb21aed948056f` |
| `src/features/coach-clients/components/coach-client-unlink-confirmation.module.css` | `a9193e9881710b75ccf43d6cfbac47231c3e1fe84afda475c943e3913d749ecb` |
| `src/features/coach-clients/components/coach-client-unlink-confirmation.tsx` | `04b946e8c4474596abf3dbe4dabb50040aa1c02b84663592c23ba312d5ed2d33` |
| `src/features/coach-clients/components/coach-clients-contract.test.ts` | `c8462dc0d9d75bdd9365661b39a6c95c6ac140c5f733aa3e3c037f1dc0868994` |
| `src/features/coach-clients/components/coach-clients-empty.module.css` | `93bfc45ca28226ab62124efbed8c48777812da0e1d096e2316dd2ba3aa3e26fa` |
| `src/features/coach-clients/components/coach-clients-empty.tsx` | `0b61326ec5cc4d06e37bf08841196ef5c65d2efbbf2f9162b516235ae11225f1` |
| `src/features/coach-clients/components/coach-clients-header.module.css` | `df688dd0438bbcb07ce7333a933e8b767e6cb0a88a6eaa768b9f78c979514200` |
| `src/features/coach-clients/components/coach-clients-header.tsx` | `ffabae593d48b80a640ad2f4d3286914167feb8ac9ef9ccdf59f072e60cf7b39` |
| `src/features/coach-clients/components/coach-clients-list.module.css` | `8a1349376df7767b7eff6ba52c30495c0f54819031812b80675d2fca56f95621` |
| `src/features/coach-clients/components/coach-clients-list.tsx` | `a07e6b68770f15b677b020b6efca52dea526422d10c33aa57797949a0c150283` |
| `src/features/coach-clients/components/coach-clients-render.test.ts` | `0367004faaa4a507d3affff95497951729175fdae68646b828734c90def1ee60` |
| `src/features/coach-clients/components/coach-clients-search.module.css` | `2da27b4af8f2adbf25fad48988b3ab83e5a216c96a820a38ee829276f5795265` |
| `src/features/coach-clients/components/coach-clients-search.tsx` | `b3e51200284c720ec6f1470a83dd23454ebc5c10ae2cc8fa3634ffae6beeaac2` |
| `src/features/coach-clients/components/coach-clients-tabs.module.css` | `bc0c72e98d4c6567ef652a15d8235ddf6b0b267c96f4bf6f440a6db755a6844b` |
| `src/features/coach-clients/components/coach-clients-tabs.tsx` | `e97544981ed521b24c36252ae0d9996dc7106976408125edf0ff2991919f1d4a` |
| `src/features/coach-clients/components/coach-clients-view.ts` | `5abaf06c160e377914190e67077152b371656867c32a260f0a2c8a563891a26e` |
| `src/features/coach-clients/components/coach-clients.module.css` | `bbe71e1e52641825f0a1cb4c649f10bfe0d333d41b3f037df9c689dbf08adfff` |
| `src/features/coach-clients/components/coach-clients.test-tsconfig.json` | `755251f7c9c2dab43461ee0c3b3a57ac0d2442b0804f20c809980ae38ca9a6c9` |
| `src/features/coach-clients/components/coach-clients.tsx` | `b034b7d59693bcd719499728f5e1654e8a3ab4f2fdf9bce7a47d05fb8c322220` |
| `src/features/coach-dashboard/components/README.md` | `baa60f5f390d7ff29ffd50aa6ba7b1f09d2048b8785b7146201fd5aad526e7e0` |
| `src/features/coach-dashboard/components/coach-alerts-card.module.css` | `942df24a157051dd1a94e67491731a3fb67ed14d062fed2f0fc6ee0a595f1d4d` |
| `src/features/coach-dashboard/components/coach-alerts-card.tsx` | `b47b92d03c4caa669d99ad1126342034c986925d858e0612e47909af40402bdd` |
| `src/features/coach-dashboard/components/coach-chart-geometry.ts` | `452565a7316fccc5ce7b17fc7e5b80df37fc4cd7c5ab94dc4da62bf0f9ab7538` |
| `src/features/coach-dashboard/components/coach-chat-coming-soon-sheet.module.css` | `9c9e0074f6cd607befe8b404a1e2ea400ae9bda9639a291a14b86223a167edc0` |
| `src/features/coach-dashboard/components/coach-chat-coming-soon-sheet.tsx` | `daf1b10451a384933036d590c3af57e873f0b99ddf7f5c5dfb24e90c83db2426` |
| `src/features/coach-dashboard/components/coach-dashboard-card.module.css` | `fa78ef7e1250cd08bbd3c9a2170c478643dbf956e80f46b1a4b19644e89d6f36` |
| `src/features/coach-dashboard/components/coach-dashboard-contract.test.ts` | `9701e46622d8875be931a8c8aa0bd4024b2f098fa7651b2effbba03e5953e6e1` |
| `src/features/coach-dashboard/components/coach-dashboard-render.test.ts` | `9cff645f34f7f005512a89e4c0e63ccbdff96c8e65e1e7c3adfbbfb9e5fa668e` |
| `src/features/coach-dashboard/components/coach-dashboard-sheet-focus.test.ts` | `e489a651d503dd16b2dfc0e90067b9f1012700d3301322fb0ebf4cf229d0825e` |
| `src/features/coach-dashboard/components/coach-dashboard-sheet-view.ts` | `06a4192f9298539299c426cf250f35bd8e3ad8d8ea28e44c8d749b3e5ee0926d` |
| `src/features/coach-dashboard/components/coach-dashboard-sheet.tsx` | `03def42491c09a3ead059469212ef08498d56918c2dc6773c15fb08af6acdaab` |
| `src/features/coach-dashboard/components/coach-dashboard-sheets-render.test.ts` | `d0b79c91fe8a40bdfcfe984a4e91cee09c880bdb67ef224c368488bc3361e567` |
| `src/features/coach-dashboard/components/coach-dashboard-view.ts` | `099a3b98a8c4cb150615207a50fca9d329a630c0a68c39968487eca7a6938c88` |
| `src/features/coach-dashboard/components/coach-dashboard.module.css` | `3856a1b9f3804c2da8acea83d3b468e25f9f07b2b37dc0646b4e2f68c34b1591` |
| `src/features/coach-dashboard/components/coach-dashboard.test-tsconfig.json` | `fb042ec2b7c8d0c560f87bd0ae2b68a69ee37383c613364de3860000d2b351de` |
| `src/features/coach-dashboard/components/coach-dashboard.tsx` | `7f6cd22ff702e44fdee6afe33a35e9570accd3c78747f00eeb568494498fd936` |
| `src/features/coach-dashboard/components/coach-fee-presets.ts` | `4dc7d767fc2eb5c632ffb885829a1d01022550e770b143bdec447570d2914ed4` |
| `src/features/coach-dashboard/components/coach-fee-sheet.module.css` | `6c5280ea668b172f4965b5b5b098623431b13d199d611496b7082f114bc3965b` |
| `src/features/coach-dashboard/components/coach-fee-sheet.tsx` | `697067712305985c991d2d10fc408de29aaf1bac721a92ed4b1b8b04944030e1` |
| `src/features/coach-dashboard/components/coach-income-card.module.css` | `52f31de2e8408db8979839f51fe3cf1e2cbece041fa3d4b568f23c9c99962b01` |
| `src/features/coach-dashboard/components/coach-income-card.tsx` | `5fe70a21da4206a4d356ef6e052d5368d23f6999113eba7fe0dde8bae46eb644` |
| `src/features/coach-dashboard/components/coach-month-detail.tsx` | `94a3712e9b7b9a351ee1527d529cc7e460b00c810cdf8efe875af02df459ae08` |
| `src/features/coach-dashboard/components/coach-monthly-chart.module.css` | `7755279d11f2a66de967bb9ecaff2f19a30b2e75d79993256020cdab0ed66c44` |
| `src/features/coach-dashboard/components/coach-monthly-chart.tsx` | `6d67bf217d9bae6a43f9aaffe8f4a6fd889b3c513727cb973a4469359edf31ef` |
| `src/features/coach-dashboard/components/coach-portfolio-grid.module.css` | `2ea0b6f1364bb84dab05f78d36db6a979a39164b63083176d8aa20678c0acbf7` |
| `src/features/coach-dashboard/components/coach-portfolio-grid.tsx` | `75023358876285dfbf4c1408e3c9f27c9b0d4ca5aa29348cbc84241b6e4c76ba` |
| `src/features/coach-dashboard/components/coach-quick-actions.module.css` | `5f22a4d5f4856320217ab8633bd1bb0fa08afa9a645119546de68b7e1100cf22` |
| `src/features/coach-dashboard/components/coach-quick-actions.tsx` | `2539fc301900855779c0a7213532d7a6f7657352bfe623e319bbfd6398858fe7` |
| `src/features/coach-dashboard/components/coach-renewal-dates-modal.module.css` | `e587973be3c5c4c4b320c7602df51b7fc82a9e6f9d2072d92133ec29da620c8e` |
| `src/features/coach-dashboard/components/coach-renewal-dates-modal.tsx` | `07c4a0a81152ebeb63d01eb887d8723c6b60fbd44555dd91071ad0bd59482f23` |
| `src/features/coach-dashboard/components/coach-renewal-detail-content.tsx` | `e7830d1bd162cdaf3e81d61b7fccbe273df6ee6be9e750022dd94f5842613445` |
| `src/features/coach-dashboard/components/coach-renewal-detail-render.test.ts` | `f30e59e93e40188df76f000ed5f500fe16eba6f87bc367f40c1f5d3c107be980` |
| `src/features/coach-dashboard/components/coach-renewal-detail-sheet.module.css` | `99a7cce6095837f80a94020bcb279a94d8c49118e0c0ccc97301cc45b911535e` |
| `src/features/coach-dashboard/components/coach-renewal-detail-sheet.tsx` | `17093ba97a02830f52d44741c89a8c8b9e2329f05fd9e485d610c7c77f7b4cea` |
| `src/features/coach-dashboard/components/coach-renewal-detail-view.ts` | `54e44a23734d2d31fef89bfb75aa58cae249e6b4eda1be515817619123c9c608` |
| `src/features/coach-dashboard/components/coach-renewal-row.tsx` | `a3b34ce1be1c8b58cc37ab0d9395adbcb0075d1bf3aa8fa9903a785c2f9abaf1` |
| `src/features/coach-dashboard/components/coach-renewal-state-choices.module.css` | `7f11528141eddeec2cad8739118fbaaf8aac1b68d297ffddbc1a6e0c08d3feaa` |
| `src/features/coach-dashboard/components/coach-renewal-state-choices.tsx` | `a06df322be7f5a9dd13e71c3600286787070e63a29a9ca6971c608c55ae829f7` |
| `src/features/coach-dashboard/components/coach-renewal-state-options.ts` | `15c214b4fe665e2438725f64fdb93f69db34157fb0803bf0dd20e05d4dcf0b80` |
| `src/features/coach-dashboard/components/coach-renewals-card.module.css` | `65ec011a7620bcf97a39a78378533824f4e068da11be5ef2222dd2c35489ada4` |
| `src/features/coach-dashboard/components/coach-renewals-card.tsx` | `1b694a14349f9e498199fb6533527622612a277937e6817153b8377acaa8554c` |
| `src/features/coach-dashboard/components/coach-welcome.module.css` | `8bbc805ceb190b1c5dbd960c6fffa5098150df46efb2eeaa0a0b9f38a3260a6a` |
| `src/features/coach-dashboard/components/coach-welcome.tsx` | `4edd1ce38a326582aba2c3ff1b018b82cf8e12d503c744080bd60cc733e9b024` |
| `src/ui/coach-overlays/README.md` | `5549f35651f414cb416b2ac7e84d84f490b7751ff87f344b56ac19a92957d703` |
| `src/ui/coach-overlays/coach-overlay-contract.test.ts` | `a0cacc80026a3cddb6c8b5dfab920d611bbeac521c10b54ce1328a5bebe79749` |
| `src/ui/coach-overlays/coach-overlay-view.ts` | `b18caa9500d435de0258f408919e82ffdddc1c5d50a3f512de42adcabd849f4d` |
| `src/ui/coach-overlays/coach-overlay.module.css` | `25ac9b53e5e43db8db862e7c67c29def62510238123827b1ee78f2fab0e3dda7` |
| `src/ui/coach-overlays/coach-overlay.tsx` | `a9051bd26099acd6fa996af3e02a6e369342a156338e76b79cba9e1f4fdb4e01` |
| `src/ui/coach-overlays/use-coach-overlay-background.ts` | `6792e4f3bc253d07b46afaa99587d3bbefc7492c3de31877b0db3631a13c2607` |

### DOMAIN — 11 archivos

Origen: `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-domain-01`.

| Archivo | SHA-256 |
| --- | --- |
| `src/features/coach-clients/model/coach-client-invitation.test.ts` | `a66a511cbac1e0dce620e9c2784a99c8b0693cc14d0f64bb6ac7632e1d420cc9` |
| `src/features/coach-clients/model/coach-client-invitation.ts` | `fca481249b9c0ab57b9e2f80dd137d130458d006eea08dda1e69f2ab63d06fce` |
| `src/features/coach-clients/model/coach-client-portfolio.test.ts` | `878ecf7b5a18185247a5d1f334f666f252b32aa54468191f264cca64913d77db` |
| `src/features/coach-clients/model/coach-client-portfolio.ts` | `0bbc09dcc2da92095a57fd9ee1a3e32843c8a23869c83119af1148aaf511a693` |
| `src/features/coach-clients/model/coach-client.ts` | `523d23e86fcb01320c887b1ce82e063271c23746abb361f78a906eb9644bf39a` |
| `src/features/coach-clients/model/coach-invitation-policy.test.ts` | `568fe8af0647b76ab773a78fda745c9b745793444878be1f19f75c95567d4a07` |
| `src/features/coach-clients/model/coach-invitation-policy.ts` | `4e1985c7fa9b4fdd06feb77bfa5b7844172346034b0ff9ffb78a90ce4b79ceb3` |
| `src/features/coach-dashboard/model/coach-dashboard-money.test.ts` | `ed3b6b4e550a2c4ea517afb27031f8db5f12124947b3797710d0185f8215a950` |
| `src/features/coach-dashboard/model/coach-dashboard-money.ts` | `128b1cd81f3b653d2ba0b584e4058f8c4570f505760e03d15428c29bb1ccb61e` |
| `src/features/coach-dashboard/model/coach-renewal-draft.test.ts` | `de909f5c12fca18ed336fc80551dfe1556421447f3c92e119e1d78b28d94d25a` |
| `src/features/coach-dashboard/model/coach-renewal-draft.ts` | `568b15c739826a3a68b3e5e406fea67e2c1194f0e18cdaed68ff168f9c6d9062` |

### DATA — 12 archivos

Origen: `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-data-01`.

| Archivo | SHA-256 |
| --- | --- |
| `src/features/coach-dashboard/data/README.md` | `a1e75c8868bd5dbfef92a89cc2ba671c98983a9c4ba923ab6f34fa04fe2a99b8` |
| `src/features/coach-dashboard/data/coach-preferences-contract.ts` | `a82e4ff1b6f02c7b88b25f9debcf88373c294537d3fe129e69d739059f7759b4` |
| `src/features/coach-dashboard/data/coach-preferences-deadline.ts` | `6c23520eb8bef3921739036230e4235efac340d32bc4e22241404fae18b797be` |
| `src/features/coach-dashboard/data/coach-preferences-migration.test.ts` | `cddb831494c96ade5eaac394e7ab867733b67b85d6b162a040d0e455bf00eb3a` |
| `src/features/coach-dashboard/data/coach-preferences-operation.ts` | `dde793ad24fe283f8787c87e17c7b58710d79375e6319d6ea07034a7359ba32a` |
| `src/features/coach-dashboard/data/coach-preferences-repository.test.ts` | `e9aaee4ce3563acc25a93840443c4a56db3f6916a2edb8bd64f7147daabd3753` |
| `src/features/coach-dashboard/data/coach-preferences-repository.ts` | `8019473c7ee95308d82543070db7f20fca95eff3827370fcaf1c09fe559c46bf` |
| `src/features/coach-dashboard/data/supabase-coach-preferences-repository.test.ts` | `529f46d88103679f61d6751142897981c335105867e288306d4b34a60a2dfdeb` |
| `src/features/coach-dashboard/data/supabase-coach-preferences-repository.ts` | `6d14ab5cf833fea7675538d88b87664c55be3f1850394fc8e3e335447a29e492` |
| `supabase/migrations/20260908201518_coach_dashboard_private_preferences.sql` | `1dcba62528dac569acaa18d84437cd3a965d5ebd4274f9cfef1d1d20f2ba2cee` |
| `supabase/tests/support/coach_preferences_local_bootstrap.sql` | `fb0fda4b31c36f051935330fa570be1048ea5d67bde8f0bf85273a8ea9eef77b` |
| `supabase/tests/support/run_coach_preferences_postgres.mjs` | `da6aa87c208013c9781d1fba3dea44fb43ee06b62799ed25aa8f797da274be07` |

## Verificación y límites de cierre

Transferencia y fusión realizadas por el coordinador:114 archivos de fuente y
destino verificados byte a byte, sin tocar los orígenes ni los archivos propios
de ROOT. No hay imports nuevos desde composition root, rutas, Coach portal o
User portal productivos. Los cinco cambios tracked son exactamente los previstos.

Se añade composición local `integration/coach-preferences-runtime.ts` con nueve
tests: parser/controller/repository/SDK reales, HTTP y Auth sintéticos (nunca BD
remota). Cancelación, entrada incompleta, cero explícito, respuesta CAS40001,
respuesta inválida, incertidumbre HTTP, identidad cambiada y resultado tardío.
Estos casos no reemplazan las64 assertions SQL locales del lote DATA.

Gates del conjunto ejecutados: npm test completo PASS (sesión91804, exit0),
typecheck/lint/build/diff PASS (sesión12488, exit0); logs
`/tmp/organizatech-coach-integrated-{npm-test,typecheck,lint,build}.log`.
Focales Coach:134UI +77dominio +23data +15controller +9integración =258PASS.
Inventario de tests:210 en src y9 en supabase,219 referencias únicas y219 archivos,
sin faltantes, duplicados ni referencias inexistentes.
Hash package final `ddcf130f7c2fc5b6a7ebf07e313dce446474d2793a5e8610fe11f08b2131ac93`;
lock intacto `3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5`.
Auditoría independiente Claude de esta integración aislada: PASS, sin bloqueantes.
Evidencia `/tmp/organizatech-coach-integrated-claude-audit.json`, sesión3013 cerrada
con salida cero. No equivale a auditoría final del producto ni del backend aún
pendiente. H1 menor cerrado: comentarios y mensajes de los dos contratos de foco
incluyen CoachOverlay aislado; sus listas exactas y assertions no se modificaron.
Ambos contratos repetidos PASS después del ajuste textual, sesión18310 salida cero;
logs `/tmp/organizatech-coach-overlay-label-{training,user}-test.log`. Los tres
comentarios opcionales H2/H3/H4 quedan como recomendaciones de cobertura/runtime
para la siguiente fase, no como vulnerabilidades ni bloqueantes confirmados.

- Verificar los114 hashes después de transferir y que los tres orígenes siguen intactos.
- Typecheck/lint, suites focales y completa, build, diff y ausencia de imports productivos nuevos.
- Probar integración real repository/controller/parser con transporte sintético local; nunca fixtures en producto.
- Reauditoría independiente posterior al gate técnico. No etiquetar completo el backend de invitaciones, vínculos, consentimiento, métricas o correo que aún falta.
- La SQL transferida es un archivo local ya auditado; no ejecutar contra QA/PROD ni configurar credenciales. Perfil Alumno sigue aplazado.
