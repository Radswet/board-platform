# Mi Tablero

Dashboard personal de accesos rápidos. Sin instalación, sin build step — HTML/CSS/JS puro con Supabase como backend.

## Features

- **Múltiples tableros** — cada usuario tiene sus propios tableros, privados por defecto
- **Invitaciones por email** — invita personas a un tablero con rol Editor o Solo ver
- **Permisos por rol** — Dueño (control total), Editor (agregar/editar/eliminar), Solo ver
- **Auth** — login y registro con Supabase Auth, con toggle para ver contraseña
- **Tiles de links** — abre URLs con un clic, con ícono, color y descripción
- **Notas** — tiles sin URL para guardar texto rápido
- **Grupos** — agrupa tiles por categoría, filtra con tabs, renombrables y eliminables
- **Canvas libre** — arrastra y posiciona cada tile donde quieras (desktop)
- **Búsqueda** en tiempo real
- **Sync en tiempo real** entre usuarios (Supabase Realtime)
- **Favicon automático** — detecta y aplica el ícono del sitio al pegar una URL
- **Color picker** — paleta de sugerencias + picker libre del sistema
- **Estado vacío** — guía visual para agregar el primer acceso
- **Confirmación al eliminar** — popup/doble clic para confirmar borrado
- **Shortcut** `Cmd+K` / `Ctrl+K` para agregar rápido
- **Responsive** — grid de 2 columnas en móvil
- **Límite de 5 usuarios** (configurable en `db/setup.sql`)

## Estructura

```
├── index.html
├── README.md
├── config.js           ← credenciales (no se sube al repo)
├── config.example.js   ← plantilla
├── src/
│   ├── app.js
│   └── styles.css
└── db/
    ├── setup.sql               ← instalación fresca
    └── migration_boards.sql    ← migración si ya tenías la DB
```

## Setup (instalación fresca)

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ejecuta `db/setup.sql` en el SQL Editor de Supabase
3. Copia `config.example.js` como `config.js` y pega tu URL y anon key
4. Abre `index.html` en un servidor local o despliega en GitHub Pages

## Setup (migración desde versión anterior)

Si ya tenías la DB configurada con el `setup.sql` anterior, ejecuta solo:
```
db/migration_boards.sql
```
La app migrará tus links existentes al primer tablero automáticamente.

## Deploy (GitHub Pages)

El repo incluye `.github/workflows/deploy.yml` que despliega automáticamente al hacer push a `main`.

## Pendiente

- [ ] **Vista lista** — alternativa al canvas para ver tiles en grid ordenado
- [ ] **Reordenar en móvil** — en desktop hay drag & drop, en móvil no hay forma de reordenar
- [ ] **Export / Import** — backup y restauración de links en JSON
