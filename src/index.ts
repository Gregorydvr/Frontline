// The Worker. It builds the real dependencies and hands every request to the
// app in app.ts.

import { createApp } from './app';
import { systemClock } from './clock';

const app = createApp(() => ({ clock: systemClock }));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
