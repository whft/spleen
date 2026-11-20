# SPLEEN / OBSIDIAN — Design System Specification

## 1. Visual Identity & Aesthetic Direction

**OBSIDIAN MONOCHROME**: A precision dark developer workstation built on true charcoal-obsidian depth (`#08090A` -> `#0B0D0F` -> `#111416` -> `#171B1D`), brushed titanium structural contrast (`#E5E8E3` / `#F1F2EF` / `#959D9C`), crisp `1px` borders, self-hosted `Geist` typography, and ultra-restrained `#C8FA62` micro-signals strictly for active live indicators and grazing 3D metallic highlights.

### Monochrome Mandate
- **Zero vermilion red (`#D9503F`)** and **zero blue (`#5865F2`, `#83A7DC`, `#2F6FB0`, navy `#0B0F14`/`#121821`/`#1A222D`)** across menus, popovers, dropdowns, context menus, command palette, chrome, primary buttons, brand app icons, splash screen, and integrated reader surfaces (`Teams`, `Discord`, `UnknownCheats`).
- Primary actions and checked states use matte **platinum-bone** (`#E5E8E3` with `#08090A` dark ink) rather than saturated brand colors.
- Menus & floating popovers are deeper, crisper obsidian (`#0D1012` / `#111416` at 98% fill) so they sit clearly apart from workspace panes without muddy blur bleed.

---

## 2. Color Tokens (Dark Primary & Monochrome Light Pairing)

### Core Obsidian Dark Palette (`spleen-dark.json` & `.dark`)

| Role | Token(s) | Hex | Contrast Note |
| --- | --- | --- | --- |
| Root Canvas | `--background`, `--surface-background` | `#08090A` | Near-black neutral obsidian (zero blue cast) |
| Sidebar / Recess | `--sidebar`, `--surface-muted` | `#0B0D0F` | Subtle depth step below canvas |
| Cards / Tool Panels | `--card`, `--surface-elevated` | `#111416` | Primary container surface |
| Floating Menus / Popovers | `--popover`, `--surface-overlay`, `.oc-glass-popover` | `#0D1012` / `#111416` | Deep opaque-obsidian (`98%`), `1px` `#282D30` ring |
| Elevated Hover / User Bubble | `--surface-subtle`, `--interactive-hover` | `#171B1D` / `#FFFFFF0D` | Tactile neutral state step |
| Pressed / Active Row | `--interactive-active`, `--interactive-selection` | `#1E2326` | Crisp neutral selection without red/blue wash |
| Hairline Borders | `--border`, `--interactive-border` | `#282D30` | Default structural edge (`borderHover: #394045`) |
| Primary Text | `--foreground`, `--surface-foreground` | `#F1F2EF` | `> 17:1` contrast against `#08090A` / `#111416` |
| Secondary Text | `--muted-foreground`, `--surface-muted-foreground` | `#959D9C` | `> 7.0:1` WCAG AA contrast against dark surfaces |
| Tertiary / Timestamp | `--timestamp` | `#6F7877` | Metadata only (`> 4.5:1` on `#08090A`) |
| Monochrome Primary Action | `--primary`, `--primary-base` | `#E5E8E3` | Hover `#F4F6F3`, Active `#CFD4CE` |
| Monochrome Primary Ink | `--primary-foreground` | `#08090A` | Explicit dark ink (`> 15:1` contrast on `#E5E8E3`) |
| Micro-Accent (Surgical) | `--spleen-accent`, `--interactive-focus` | `#C8FA62` | Tiny live dots (6px), hairline focus glow `#C8FA6244`, 3D rim glint |
| Muted Accent | `--spleen-accent-muted`, `--status-success` | `#829E4B` | Completed/connected badges (never large surfaces) |
| Restrained Info / Links | `--status-info`, `--markdown-link` | `#B8C0BE` / `#DDE3DF` | Neutral platinum links (zero blue!) |
| Restrained Warning / Error | `--status-warning` / `--status-error` | `#C9A45C` / `#C46B6B` | Used strictly for real errors & irreversible confirmation |

---

## 3. Typography System

- **UI Sans**: `"Geist Variable", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (default `DEFAULT_UI_FONT = 'geist-sans'`).
- **Code / Terminal / Monospace**: `"Geist Mono Variable", "Geist Mono", ui-monospace, "SFMono-Regular", "Menlo", monospace` (default `DEFAULT_MONO_FONT = 'geist-mono'`).
- Both packages (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`) are imported via JS (`packages/ui/src/styles/fonts.ts`) so Vite bundles `.woff2` files locally with **zero external runtime CDN requests**.
- Apply `font-variant-numeric: tabular-nums` to timestamps, token usage metrics, recovery countdowns, pagination, and message counters.

---

## 4. Radii, Elevation & Spacing

- **Border radii**: `4px` (`sm`, micro badges/keys), `6px` (`md`, compact buttons/items), `8px–9px` (`lg`, menu items, inputs, standard cards), `12px` (`xl`, popovers, context menus, dialogs — matching concentric inner/outer padding).
- **Elevation hierarchy**:
  1. Canvas (`#08090A`)
  2. Docked Sidebars/Rail (`#0B0D0F`, separated by `1px solid #1C2023`)
  3. Panels & Composer (`#111416`, subtle top inner sheen `rgb(255 255 255 / 0.04)`, `1px` ring)
  4. Floating Menus / Popovers (`#0D1012` at 98%, `1px solid #282D30`, `0 16px 36px rgba(0,0,0,0.68)`)
  5. Modals (`#0E1113`, backdrop `rgba(4,5,6,0.72)`)
- **Density**: Compact desktop rhythm (`32px–36px` control heights, `2px` gaps inside menus, generous reading line-height in transcript).

---

## 5. Motion Discipline

- **Hover feedback**: `100–150ms ease` (color/background/border only).
- **Tab / view switches**: `140–200ms cubic-bezier(0.22, 1, 0.36, 1)`.
- **Panel open/close**: `180–240ms` via compositor `transform` + `opacity`.
- **Dialogs & floating menus**: `180–220ms` enter (`scale(0.96) -> 1`, `opacity 0 -> 1`, transform-origin aware on popovers; centered on modals), `110ms` exit.
- **Tactile press**: Subtle `active:scale-[0.98]` on primary action buttons.
- **No layout animation during AI token streaming** and **`prefers-reduced-motion: reduce`** disables motion & swaps 3D canvas for static `<SpleenLogo />`.

---

## 6. Sculptural 3D Brand Identity (`SpleenMonolith3D`)

- **Engine**: Local `three` WebGL (lazy-loaded via `React.lazy()`, zero React 19 compatibility hazards, 0 bytes loaded in chat/terminal routes).
- **Geometry**: Precision-extruded 3-blade Spleen monogram with chamfered bevels: matte dark anodized obsidian outer blades + brushed titanium central blade illuminated by studio directional lights, procedural offline `PMREMGenerator` reflections, and a surgical `#C8FA62` rim glint.
- **Placement**: Strictly reserved for Welcome (`DraftWelcome.tsx`), About (`AboutLogo.tsx`), and an instant CSS-3D monolith on the startup Splash (`packages/desktop/splash/index.html`).
- **Safeguards**: `IntersectionObserver` + `document.visibilitychange` auto-pause, `dpr <= 1.75`, `webglcontextlost` recovery, complete GPU cleanup on unmount, and immediate `<SpleenLogo />` fallback when WebGL is disabled or reduced motion is preferred.
