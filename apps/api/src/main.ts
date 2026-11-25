import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  // On the server every login token, PIN digest and notification key hangs on JWT_SECRET. Without
  // it the code would fall back to a value written in the repository — anyone could sign a token.
  if (process.env.RENDER && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "dev-secret-change-me")) {
    throw new Error("JWT_SECRET is not set on the server — refusing to start");
  }
  // rawBody: the WhatsApp webhook is signed over the exact bytes Meta sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors({
    // The ERP's own address (WEB_ORIGIN) plus the bakery's public domain, where
    // the customer app (ar-amir.com/app) lives.
    origin: [...(process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:3000"]), "https://ar-amir.com", "https://www.ar-amir.com"],
    credentials: true,
    // The web app reads the server's clock from it (a device with a wrong clock
    // otherwise asks for a «Сегодня» that has not started yet).
    exposedHeaders: ["Date"],
  });
  // Behind Render's proxy: the caller's address (sign-in attempt limits) is in X-Forwarded-For.
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  // The API answers data only: it is never framed, never guessed as another type, and browsers
  // are told to use HTTPS for it from now on.
  app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  // A product photo (resized in the browser) is sent as base64 JSON: above the 100 KB default.
  app.useBodyParser("json", { limit: "1mb" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
