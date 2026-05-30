# Lolzteam Launcher

Десктопный лаунчер для покупателей на [lzt.market](https://lzt.market) - вход в купленные аккаунты в один клик.

Поддерживает **Steam**, **Telegram** и вход по cookie через браузер.

## Установка

Скачайте установщик со страницы [Releases](https://github.com/iamextasy/Lolzteam-Launcher/releases) и запустите.

> Windows SmartScreen может предупредить о неизвестном издателе (сборка не подписана цифровым сертификатом).
> Нажмите **Подробнее → Выполнить в любом случае**, чтобы продолжить.

## Сборка из исходников

Требуется [Node.js](https://nodejs.org) ≥ 20.18 и [pnpm](https://pnpm.io) 10.

```bash
pnpm install
pnpm dev      # запуск в режиме разработки
pnpm dist     # сборка установщика для Windows (папка release/)
```

## Стек

Electron 33 · React 19 · TypeScript · electron-vite · TanStack Query · Zustand · pnpm workspaces

## Безопасность

Лаунчер работает с конфиденциальными данными аккаунтов. Как они защищены — см. [SECURITY.md](SECURITY.md).

## Лицензия

[MIT](LICENSE)
