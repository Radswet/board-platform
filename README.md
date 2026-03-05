# Mi Tablero

Dashboard personal de accesos rápidos. Sin instalación, sin build step — HTML/CSS/JS puro con Supabase como backend.

## Features

- **Auth** — login y registro con Supabase Auth, con toggle para ver contraseña
- **Tiles de links** — abre URLs con un clic, con ícono, color y descripción
- **Notas** — tiles sin URL para guardar texto rápido
- **Grupos** — agrupa tiles por categoría, filtra con tabs, renombrables inline y eliminables (solo la etiqueta, no las cards)
- **Canvas libre** — arrastra y posiciona cada tile donde quieras (desktop)
- **Búsqueda** en tiempo real
- **Sync en tiempo real** entre usuarios (Supabase Realtime)
- **Favicon automático** — detecta y aplica el ícono del sitio al pegar una URL
- **Color picker** — paleta de sugerencias + picker libre del sistema
- **Estado vacío** — guía visual para agregar el primer acceso
- **Confirmación al eliminar** — popup de confirmación antes de borrar
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
    └── setup.sql
```

## Setup

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ejecuta `db/setup.sql` en el SQL Editor de Supabase
3. Copia `config.example.js` como `config.js` y pega tu URL y anon key
4. Abre `index.html` en un servidor local o despliega en GitHub Pages

## Deploy (GitHub Pages)

El repo incluye `.github/workflows/deploy.yml` que despliega automáticamente al hacer push a `main`.

## Pendiente

- [ ] **Múltiples tableros** — cada usuario puede tener tableros separados (trabajo, personal, proyectos). Requiere tabla `boards` en Supabase y asociar `links.board_id`
- [ ] **Vista lista** — alternativa al canvas para ver tiles en grid ordenado
- [ ] **Reordenar en móvil** — en desktop hay drag & drop, en móvil no hay forma de reordenar
- [ ] **Export / Import** — backup y restauración de links en JSON
