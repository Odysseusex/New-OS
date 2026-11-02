import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: the WhatsApp webhook is signed over the exact bytes Meta sent.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:3000"],
    credentials: true,
    // The web app reads the server's clock from it (a device with a wrong clock
    // otherwise asks for a «Сегодня» that has not started yet).
    exposedHeaders: ["Date"],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
