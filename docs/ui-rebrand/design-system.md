# SPLEEN STUDIO (v2.0) — Design System Specification

## 1. Visual Identity & Aesthetic Direction

**SPLEEN STUDIO**: A calm, creative-studio developer workstation inspired by editorial dark-studio interfaces (obsidian rail `#060607`, calm graphite canvas `#101012`, raised composer and cards `#1A1A1E`, active pills `#26262B`), crisp `1px` hairline edges, generous rounded surfaces (`16px` docked panels/sheets, `22px` sculpted composer, pill tabs and primary CTAs), self-hosted `Geist` typography, and an original **Keystone Fold S** brand mark.

### Monochrome-First Discipline
- **Zero saturated red/blue chrome washes** across menus, popovers, dropdowns, command palette, chrome, primary buttons, brand app icons, splash screen, and integrated surfaces (`AI Teams`, `Discord`, `UnknownCheats`, `Settings`).
- Primary actions and selected tabs use pure **alabaster** (`#FAFAFA` with `#09090B` dark ink in dark mode; `#09090B` with `#FFFFFF` ink in light mode) so primary CTAs stand out cleanly while inactive and disabled states recede quietly.
- Every integrated surface (`TeamsPanel`, `TeamLauncher`, `DiscordPanel`, `DiscordConnectForm`, `UnknownCheatsPanel`, `WorkStatusPanel`) binds strictly to semantic CSS variables so Dark and Light modes both maintain full legibility and contrast.

---

## 2. Color Tokens (Dark Primary & Daylight Gallery Pairing)

### Core Spleen Studio Dark Palette (`spleen-dark.json` & `.dark`)

| Role | Token(s) | Hex | Contrast Note |
| --- | --- | --- | --- |
| Obsidian Sidebar / Rail | `--sidebar`, `--surface-muted` | `#060607` | Deep framing chrome around the workspace |
| Calm Graphite Canvas | `--background`, `--surface-background` | `#101012` | Distinct step lighter than the obsidian sidebar |
| Floating Menus / Popovers | `--popover`, `--surface-overlay`, `.oc-glass-popover` | `#151518` | Elevated sheet with subtle `1px` edge |
| Cards / Sculpted Composer | `--card`, `--surface-elevated` | `#1A1A1E` | Tactile raised container with hairline border |
| Hover / Active Pill | `--surface-subtle`, `--interactive-selection` | `#222227` / `#26262B` | Clean neutral hover and selected row step |
| Hairline Borders | `--border`, `--interactive-border` | `#27272B` | Structural `1px` edge (`borderHover: #3A3A40`) |
| Primary Text & Action | `--foreground`, `--primary`, `--primary-base` | `#FAFAFA` | High-contrast alabaster (`#09090B` primary button ink) |
| Secondary Text | `--muted-foreground`, `--surface-muted-foreground` | `#A1A1AA` | Readable neutral zinc secondary copy |
| Tertiary / Timestamp | `--timestamp` | `#71717A` | Metadata only (`tabular-nums`) |
| Surgical Live Status | `--status-success` | `#34D399` | Live session dots and connected badges only |
| Restrained Warning / Error | `--status-warning` / `--status-error` | `#D4A553` / `#E06C75` | Used strictly for real errors and confirmations |

### Core Spleen Studio Light Palette (`spleen-light.json`)

| Role | Token(s) | Hex |
| --- | --- | --- |
| Gallery Canvas | `--background`, `--surface-background` | `#FFFFFF` |
| Studio Sidebar / Rail | `--sidebar`, `--surface-muted` | `#F6F6F7` |
| Raised Cards / Composer | `--card`, `--surface-elevated` | `#FFFFFF` / `#F8F8FA` |
| Active Pill / Hover | `--interactive-selection` | `#ECECEF` |
| Primary Ink & Action | `--foreground`, `--primary` | `#09090B` (`#FFFFFF` button ink) |

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
