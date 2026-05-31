import { ADMIN_CONSOLE_BODY } from "./adminConsoleBody.js";

export function renderAdminConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Meow Admin Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/admin/styles.css" />
</head>
<body>
${ADMIN_CONSOLE_BODY}
  <script src="/admin/app.js" defer></script>
</body>
</html>`;
}
