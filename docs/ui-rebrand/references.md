# Visual & Technical References

## 1. Visual Inspiration Studied

### Primary Inspiration: Shopify Editions Spring '26
- **Source**: `https://recent.design/i/r4jmjhc-shopify-editions-spring-26` (cross-referenced via web search documentation)
- **What we adopted (principles, not layout or marketing copy)**:
  - Architectural dark canvas depth using stacked near-black obsidian planes rather than milky gray-slate boxes.
  - Restraint in chromatic accent usage: typography and metallic/matte object lighting carry hierarchy instead of painting every button or card with saturated color.
  - Sculptural centerpiece focal object (`SpleenMonolith3D`) reserved strictly for low-frequency brand moments (Welcome & About), keeping active coding/chat/terminal views razor-clean and uninterrupted.
- **What we rejected**:
  - Purple/blue glowing hills, scroll-hijacked full-screen shaders, continuous post-processing loops, and marketing-page hero banners inside a daily developer workstation.

### Typography Reference: Vercel Geist & Geist Mono
- **Source**: `https://vercel.com/font` -> packaged offline via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`
- **Why adopted**: High x-height, crisp tabular numerals (`tabular-nums`), neutral geometric technical proportion tailored to dense desktop menus, tool outputs, and code diffs without depending on external runtime CDNs.

### Desktop Workstation Pattern Benchmarks
- Dark-first monochrome chrome inspired by precision developer tooling: crisp `1px` structural borders, dark `#0D1012`/`#111416` menus that sit slightly darker/tighter than elevated containers, clear active-item background stepping without blue/red highlights, and sub-200ms responsive transitions.

---

## 2. Project-Local Agent Skills Installed (`.agents/skills/`)

Installed cleanly into project-local `.agents/skills/` via `npx --yes skills@latest add ... --agent antigravity --copy -y` (avoiding global mutations and preserving Spleen's 23 pre-existing skills):

1. `frontend-design` (`anthropics/skills`) — visual hierarchy, typography restraint, anti-template self-critique.
2. `emil-design-eng` (`emilkowalski/skills`) — frequency-based animation discipline, custom `ease-out` timing curves, tactile press feedback, popover transform origins.
3. `make-interfaces-feel-better` (`jakubkrehel/make-interfaces-feel-better`) — concentric radii, optical alignment, subtle dark-mode outlines, interruptible compositor transitions.
4. `baseline-ui` (`ibelick/ui-skills`) — component primitives consistency, `tabular-nums`, heading/body wrapping.
5. `fixing-accessibility` (`ibelick/ui-skills`) — keyboard focusability, contrast, ARIA labeling.
6. `fixing-motion-performance` (`ibelick/ui-skills`) — compositor-only transforms, `IntersectionObserver` pausing for animations/canvas, zero layout thrash.
7. `improve-ui` (`ibelick/ui-skills`) — systematic UI drift review criteria.

### Tooling Notes (Honest Status)
- **Motion AI Kit (`motion-ai`)**: Checked npm metadata (`description = "Install the Motion AI Kit — installs Motion skills into your AI coding agents and configures Motion's hosted MCP servers."`). Not executed because Spleen already uses `motion ^12.23.24` locally and mutating global hosted MCP servers was unnecessary; project-local motion & performance skills (`emil-design-eng`, `fixing-motion-performance`) cover the workflow directly.
- **Spline MCP**: Checked active MCP server registry (`Roblox_Studio`, `blender`, `davinci-resolve`, `ida-mcp`, `rea`); no Spline MCP server is installed or connected. For offline desktop bundling and React 19 compatibility, Spleen uses a local offline `three` WebGL sculptural asset (`SpleenMonolith3D`) with automatic static SVG fallback.
