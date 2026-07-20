// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AddonContext, AddonEnableFunction } from '@wealthfolio/addon-sdk';
import { SyncPage } from './ui/SyncPage';

// The host owns a single React root per addon and mounts the route `component`
// itself (`createElement(Component, { location })`) with no access to the addon
// context. Capture it at enable time so the route wrapper can hand it down.
// (Do NOT call createRoot yourself — the host manages the lifecycle.)
let addonCtx: AddonContext | undefined;

// Route component. The sidebar entry + route are declared in manifest.json
// (`contributes.routes` + `contributes.links`) — this is the mechanism the
// installed `@wealthfolio/addon-sdk` (3.6.2) actually consumes: routes are
// "host-renderable before the addon boots" and links place them in a host
// slot (`AddonContributedRoute`/`AddonContributedLink` in
// `node_modules/@wealthfolio/addon-sdk/dist/src/manifest.d.ts`). There is no
// separate imperative `ctx.sidebar.addItem()` call needed for a route
// already declared in `contributes.links.sidebar` — that API exists for
// addons that want to add sidebar entries not backed by a durable route
// (unused here). `ctx.router.add()` still runs at addon-enable time to
// register the actual component for the route id the manifest declared;
// the route `id` below MUST match `contributes.routes[].id` in manifest.json.
// The QueryClientProvider shares one cache across route navigations.
const AddonRoute = () => (
  <QueryClientProvider client={addonCtx!.api.query.getClient() as QueryClient}>
    <SyncPage ctx={addonCtx!} />
  </QueryClientProvider>
);

const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;

  ctx.router.add({
    id: 'wealthfolio-ynab-sync',
    component: AddonRoute,
    path: '/addons/wealthfolio-ynab-sync',
  });

  // The host owns the React root and un-mounts it on disable, and there is
  // no cancellation token threaded through `ctx.api.network.request` /
  // `SyncEngine.sync()` for an in-flight sync to hook into — so the only
  // cleanup this addon can honestly do is drop its reference to `ctx` (any
  // in-flight promise chain still resolves, but its `setState` calls target
  // an unmounted component and React discards them; nothing writes to
  // storage/secrets/activities after disable that wasn't already committed
  // before the callback ran).
  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
