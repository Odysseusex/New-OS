# Bakery OS

Платформа управления сетью пекарен: продажи, производство, склад, логистика,
финансы, карта города и AI-рекомендации — в едином продукте, независимом от
внешних систем (UMAG, iiko, 1С подключаются как адаптеры поверх единой модели
данных).

## Структура репозитория

```
apps/
  web/      Next.js — интерфейс (на русском)
  api/      NestJS — backend API
packages/
  shared/   Общие типы и роли, используемые web и api
```

## Стек

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, lucide-react
- **Backend:** NestJS, TypeScript, Passport/JWT
- **База данных:** PostgreSQL 16 + Prisma ORM
- **Монорепозиторий:** pnpm workspaces

## Первый запуск

### 1. Установить зависимости

```bash
pnpm install
```

### 2. Поднять PostgreSQL

Локально (уже настроен кластер `16/main` на порту 5432) либо через Docker:

```bash
docker run --name bakery-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bakery_os -p 5432:5432 -d postgres:16
```

### 3. Настроить переменные окружения

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
```

### 4. Применить миграции и засеять демо-данные

```bash
cd apps/api
npx prisma migrate dev
npx ts-node prisma/seed.ts
```

### 5. Запустить приложения (в двух терминалах)

```bash
pnpm dev:api   # http://localhost:3001/api
pnpm dev:web   # http://localhost:3000
```

### Демо-доступ

- Email: `owner@bakery.demo`
- Пароль: `password123`

## Текущий статус

Реализован фундамент платформы:

- мультиарендная модель данных (организации → регионы → точки → пользователи);
- аутентификация и роли (11 ролей, от владельца до водителя);
- каркас интерфейса на русском языке со всеми 17 модулями в навигации;
- рабочий модуль **Дашборд** с реальными данными из API;
- остальные модули отображаются как «в разработке» с описанием будущего
  функционала — это осознанное отражение реального прогресса, а не заглушки
  с fake-данными.

Следующий этап — наполнение модулей Продажи, Склад и Производство реальной
бизнес-логикой.
