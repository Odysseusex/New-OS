import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  // Public, unauthenticated, and deliberately reports which commit is
  // running. Twice now a change has looked broken in production when the
  // frontend had deployed and the API had not: the request validator strips
  // fields the running build does not know about and still answers 200, so
  // the save silently loses them. Without this there is no way to tell that
  // apart from a code bug without credentials — with it, one request answers
  // "is the server actually up to date". Render sets RENDER_GIT_COMMIT
  // itself; null locally, which is answer enough there.
  @Get("health")
  health() {
    const commit = process.env.RENDER_GIT_COMMIT ?? null;
    return {
      status: "ok",
      service: "bakery-os-api",
      commit: commit ? commit.slice(0, 7) : null,
    };
  }
}
