import { app } from "../../backend/api/app";
import type { RuntimeBindings } from "../../backend/runtime/types";

type FetcherLike = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnv = RuntimeBindings & {
  ASSETS: FetcherLike;
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
