import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
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
  // A product photo (resized in the browser) is sent as base64 JSON: above the 100 KB default.
  app.useBodyParser("json", { limit: "1mb" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
